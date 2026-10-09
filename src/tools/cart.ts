import type { McpServer } from "@modelcontextprotocol/server";

// Cart / purchase tools. These need a signed-in browser on the same machine;
// a deployment without one registers the anonymous read tree alone.
//
// These are the confirmation-gated WRITE surface: view the signed-in user's cart, add
// a deal option to it, and clear it. They front Groupon's authenticated cart ops
// (GetCart / createOrUpdateCartItem / deleteCartItem) via GrouponWebClient, which
// carries the session cookie — see src/web-client.ts + src/fetchproxy-cookie.ts.
//
// CHECKOUT IS HAND-OFF ONLY. Groupon's checkout is native Apple/Google Pay / card
// / PayPal SDKs — there is NO replayable place-order mutation. groupon_purchase
// ends at "added to cart" and returns the ready-to-pay checkout URL for the USER
// to complete payment. This tool NEVER attempts to place an order.
//
// Both writes are gated by mcp-utils' confirmWrite kit: a client
// that can show an elicitation prompt asks the user; one that cannot (claude.ai,
// Claude Desktop) gets the two-phase token flow — the first call does NOTHING and
// returns a preview plus a confirmToken, and only a repeat call with that token
// proceeds (MCP_CONFIRM_MODE governs it; see README). The token AND an
// elicitation acceptance are bound to the exact mutation payload plus the
// preview as shown (price included), rebuilt from a FRESH read on every call,
// so a deal repriced or a cart changed between the two calls is refused as
// DRAFT_CHANGED.
// groupon_purchase still issues the anonymous getDeal READ and a cart READ on
// the preview call (needed to resolve/preview the option and show any existing
// line), but never the cart mutation.
//
// resolveCartItem maps a getDeal read → the ids createOrUpdateCartItem needs.
// Verified against a live getDeal (2026-07-25): deal.uuid is the dealUuid, and
// each deal.options[] entry carries the option's `id` (optionId) and `uuid`
// (optionUuid) — for the observed deal these two were the same value, but they
// are read independently so a future divergence is handled correctly.
import { z } from "zod";
import {
  CONFIRM_FLOW_SENTENCE,
  McpToolError,
  NonEmptyString,
  PositiveInt,
  confirmTokenParam,
  confirmWrite,
  minifiedResult,
  toolAnnotations,
} from "@chrischall/mcp-utils";
import type { GrouponClient, GetDeal } from "../client.js";
import type { GrouponWebClient } from "../web-client.js";
import { stripDealId } from "./detail.js";

/** The user-facing, ready-to-pay checkout URL. There is no place-order API; the
 *  user completes payment here themselves. */
const CHECKOUT_URL = "https://www.groupon.com/checkout/cart";

/** Upper bound on one add, so a runaway quantity fails validation here rather
 *  than relying on Groupon to reject it. */
const MAX_QUANTITY = 10;


/**
 * Collect every distinct `optionId` value anywhere in a cart payload, walking
 * the whole tree (cart line-item shape is not otherwise modelled, and the
 * authenticated shape can drift). Cycle-safe. Used only to verify an add
 * landed; groupon_clear_cart enumerates what to delete with
 * {@link cartLineOptionIds}, which reads the line items alone.
 */
export function collectCartOptionIds(cart: unknown): string[] {
  const ids: string[] = [];
  const seen = new Set<object>();
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const el of node) walk(el);
      return;
    }
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (
        key.toLowerCase() === "optionid" &&
        typeof value === "string" &&
        value
      ) {
        ids.push(value);
      } else {
        walk(value);
      }
    }
  };
  walk(cart);
  return [...new Set(ids)];
}

/** Keys under which a GetCart payload may hold its line-item list. Only these
 *  top-level lists are read as line items; anything else in the payload
 *  (recommendations, upsells, saved-for-later) is ignored. */
const CART_LINE_ITEM_KEYS = ["items", "cartItems", "lineItems"] as const;

/**
 * The optionIds of the cart's LINE ITEMS, de-duplicated, in cart order.
 *
 * Unlike {@link collectCartOptionIds} this does not walk the whole payload: it
 * reads the `optionId` of each entry in the cart's top-level line-item list
 * ({@link CART_LINE_ITEM_KEYS}), so an optionId inside a recommendation or a
 * nested sub-object is never mistaken for something to delete (fleet-audit
 * #484). It fails closed: a payload with no recognisable line-item list, or a
 * line item without a string `optionId`, throws rather than reading as an
 * empty cart, because `groupon_clear_cart` would otherwise report a non-empty
 * cart as already clear.
 */
export function cartLineOptionIds(cart: unknown): string[] {
  const obj =
    cart !== null && typeof cart === "object" && !Array.isArray(cart)
      ? (cart as Record<string, unknown>)
      : {};
  const key = CART_LINE_ITEM_KEYS.find((k) => Array.isArray(obj[k]));
  if (!key) {
    throw new McpToolError(
      "Could not find the line items in your Groupon cart.",
      {
        hint: `The GetCart response shape may have drifted (expected a top-level ${CART_LINE_ITEM_KEYS.join(" / ")} list; got keys: ${Object.keys(obj).join(", ") || "(none)"}). Check the cart with groupon_view_cart and clear it on groupon.com.`,
      },
    );
  }
  const ids: string[] = [];
  for (const line of obj[key] as unknown[]) {
    const id =
      line !== null && typeof line === "object"
        ? (line as Record<string, unknown>).optionId
        : undefined;
    if (typeof id !== "string" || !id) {
      throw new McpToolError(
        "A line item in your Groupon cart has no optionId, so it cannot be removed.",
        {
          hint: "The GetCart line-item shape may have drifted (expected a string `optionId` on each line). Check the cart with groupon_view_cart and clear it on groupon.com.",
        },
      );
    }
    ids.push(id);
  }
  return [...new Set(ids)];
}

/**
 * Is a given optionId present in the cart? Primary signal is an `optionId` field
 * match; the fallback catches a cart that carries the id under a
 * differently-named field.
 *
 * The fallback compares VALUES, not the serialized document. `JSON.stringify()
 * .includes(optionId)` also matches the id as a substring of a longer id, or
 * inside a checkout URL, a tracking blob, or a "recently viewed" list — none of
 * which mean the item is in the cart. That answer reaches the caller as
 * `verified: true`, i.e. "we re-read the cart and confirmed it landed", so a
 * false positive states the opposite of the truth about a purchase.
 */
function cartContainsOptionId(cart: unknown, optionId: string): boolean {
  if (collectCartOptionIds(cart).includes(optionId)) return true;
  return cartHasValue(cart, optionId);
}

/** True when any string value anywhere in `node` equals `target` exactly. */
function cartHasValue(node: unknown, target: string): boolean {
  const seen = new Set<object>();
  const walk = (n: unknown): boolean => {
    if (typeof n === "string") return n === target;
    if (n === null || typeof n !== "object") return false;
    if (seen.has(n as object)) return false; // cyclic payloads must terminate
    seen.add(n as object);
    if (Array.isArray(n)) return n.some(walk);
    return Object.values(n as Record<string, unknown>).some(walk);
  };
  return walk(node);
}

/**
 * Total line quantity for `optionId` in a cart payload: the sum of the numeric
 * `quantity` (or `qty`) on every object that carries the id as one of its own
 * values. `undefined` when no such line exposes a numeric quantity — the
 * authenticated cart shape is not otherwise modelled. Cycle-safe.
 */
export function cartLineQuantity(cart: unknown, optionId: string): number | undefined {
  let total: number | undefined;
  const seen = new Set<object>();
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    const o = n as Record<string, unknown>;
    const qty = typeof o.quantity === "number" ? o.quantity : o.qty;
    if (typeof qty === "number" && Object.values(o).includes(optionId)) {
      total = (total ?? 0) + qty;
    }
    Object.values(o).forEach(walk);
  };
  walk(cart);
  return total;
}

/**
 * Did the add land as requested? Compares a before/after cart snapshot rather
 * than asking whether the id is present at all: an option already in the cart
 * is "present" whether or not this add changed anything, so presence alone
 * reported a no-op add as verified.
 *
 * With readable line quantities, the after-quantity must be the requested one
 * (update-to semantics) or the old one plus the request (increment semantics);
 * `createOrUpdateCartItem` is not documented either way. Without them, only a
 * line that was absent before and present after counts.
 */
function verifyAdd(
  before: unknown,
  after: unknown,
  optionId: string,
  quantity: number,
): { verified: boolean; quantityInCart: number | undefined } {
  const presentBefore = cartContainsOptionId(before, optionId);
  const presentAfter = cartContainsOptionId(after, optionId);
  const qtyAfter = presentAfter ? cartLineQuantity(after, optionId) : undefined;
  if (!presentAfter) return { verified: false, quantityInCart: qtyAfter };
  if (qtyAfter === undefined) return { verified: !presentBefore, quantityInCart: undefined };
  const qtyBefore = presentBefore ? (cartLineQuantity(before, optionId) ?? 0) : 0;
  return {
    verified: qtyAfter === quantity || qtyAfter === qtyBefore + quantity,
    quantityInCart: qtyAfter,
  };
}

/**
 * What the cart already holds for `optionId`, for the purchase preview: the
 * line quantity when readable, a marker when the line is there but its quantity
 * is not, else 0 — plus, for an existing line, a warning naming both possible
 * results of the add.
 */
function cartLineState(
  cart: unknown,
  optionId: string,
): { display: number | string; warning?: (quantity: number) => string } {
  if (!cartContainsOptionId(cart, optionId)) return { display: 0 };
  const qty = cartLineQuantity(cart, optionId);
  if (qty === undefined) {
    return {
      display: "yes (quantity not readable)",
      warning: () =>
        "This option is already in your cart. Groupon may set the line to the quantity above or add to it, so check the cart (groupon_view_cart) if the final quantity matters.",
    };
  }
  return {
    display: qty,
    warning: (quantity) =>
      `Your cart already has ${qty} of this option. Groupon may set the line to ${quantity} or add to it (${qty + quantity}); if it sets it, the line ends at ${quantity}.`,
  };
}

/** The ids + display fields resolved from a getDeal read for a cart add. */
export interface ResolvedCartItem {
  dealUuid: string;
  optionId: string;
  optionUuid: string;
  dealTitle: unknown;
  optionTitle: unknown;
  price: unknown;
  strikeThroughPrice: unknown;
  discount: unknown;
}

/**
 * Resolve the createOrUpdateCartItem ids from a getDeal payload. `deal.uuid` is
 * the dealUuid; the chosen option's `id`/`uuid` are the optionId/optionUuid.
 * `requestedOptionId` may be omitted only for a single-option deal (a
 * multi-option deal throws, listing the choices); when provided it must
 * match an option's `id` or `uuid`. Throws an actionable {@link McpToolError} on
 * a missing/sold-out option or a drifted response shape.
 */
export function resolveCartItem(
  deal: GetDeal,
  requestedOptionId?: string,
): ResolvedCartItem {
  const d = (deal ?? {}) as Record<string, unknown>;
  const dealUuid = d.uuid;
  if (typeof dealUuid !== "string" || !dealUuid) {
    throw new McpToolError("Could not resolve the deal UUID from this deal.", {
      hint: "Re-check the dealId slug, or the getDeal response shape may have drifted (expected a string `uuid`).",
    });
  }

  const options = Array.isArray(d.options)
    ? (d.options as Record<string, unknown>[])
    : [];
  if (options.length === 0) {
    throw new McpToolError("This deal has no purchasable options.", {
      hint: "Open the deal (groupon_get_deal) to confirm it is currently available.",
    });
  }

  let option: Record<string, unknown> | undefined;
  if (requestedOptionId) {
    option = options.find(
      (o) => o?.id === requestedOptionId || o?.uuid === requestedOptionId,
    );
    if (!option) {
      const available = options
        .map((o) => o?.id)
        .filter((x): x is string => typeof x === "string");
      throw new McpToolError(
        `Option "${requestedOptionId}" was not found on this deal.`,
        {
          hint: `Available option ids: ${available.join(", ") || "(none)"}.`,
        },
      );
    }
  } else if (options.length === 1) {
    option = options[0];
  } else {
    // Never guess on a multi-option deal: defaulting to options[0] put a
    // different item in the cart whenever the caller meant another option.
    const available = options
      .map((o) =>
        typeof o?.id === "string"
          ? `${o.id}${typeof o.title === "string" ? ` (${o.title})` : ""}`
          : undefined,
      )
      .filter((x): x is string => x !== undefined);
    throw new McpToolError(
      `This deal has ${options.length} options — choose an option by passing optionId.`,
      {
        hint: `Available options: ${available.join("; ") || "(none)"}. groupon_get_deal lists each option's id, title and price.`,
      },
    );
  }

  const optionId = option.id;
  const optionUuid = option.uuid;
  if (
    typeof optionId !== "string" ||
    !optionId ||
    typeof optionUuid !== "string" ||
    !optionUuid
  ) {
    throw new McpToolError(
      "Could not resolve the option id/uuid for this deal option.",
      {
        hint: "The getDeal option shape may have drifted (expected string `id` and `uuid`).",
      },
    );
  }
  if (option.isSoldOut === true) {
    throw new McpToolError("That deal option is sold out.", {
      hint: "Pick a different option (optionId) or a different deal.",
    });
  }

  return {
    dealUuid,
    optionId,
    optionUuid,
    dealTitle: d.title,
    optionTitle: option.title,
    price: option.unformattedPrice ?? option.price,
    strikeThroughPrice: option.unformattedStrikeThroughPrice,
    discount: option.discount,
  };
}

/**
 * Register the STDIO-only cart tools. Takes BOTH clients: the authenticated
 * `webClient` for the cart ops, and the anonymous read `readClient` for the
 * getDeal id-resolution that groupon_purchase needs. This module (and the whole
 * web-client / fetchproxy-cookie tree it pulls in) must NEVER be imported by
 * a read-only deployment, which registers no cart tools.
 */
export function registerCartTools(
  server: McpServer,
  webClient: GrouponWebClient,
  readClient: GrouponClient,
): void {
  server.registerTool(
    "groupon_view_cart",
    {
      description:
        "View the items currently in your signed-in Groupon cart. Requires a Groupon session " +
        "(GROUPON_SESSION_COOKIE, or the fetchproxy browser bridge signed into groupon.com).",
      annotations: toolAnnotations({
        title: "View Groupon cart",
        readOnly: true,
        openWorld: true,
      }),
      inputSchema: z.object({}),
    },
    async () => {
      const cart = await webClient.getCart();
      return minifiedResult(cart);
    },
  );

  server.registerTool(
    "groupon_purchase",
    {
      description:
        "Add a Groupon deal option to your cart, ready for checkout. Once confirmed it adds the item, re-reads " +
        "the cart to verify the line quantity, and returns the checkout URL for YOU to complete payment. It CANNOT place the order — " +
        "Groupon checkout is native Apple/Google Pay, card, or PayPal. " +
        CONFIRM_FLOW_SENTENCE,
      annotations: toolAnnotations({
        title: "Add a Groupon deal to your cart",
        readOnly: false,
        openWorld: true,
      }),
      inputSchema: z.object({
        dealId: NonEmptyString.describe(
          'Deal permalink slug (e.g. "versailles-massage-bar-1") OR a full Groupon deal URL — the last path segment is used.',
        ),
        optionId: z
          .string()
          .optional()
          .describe(
            "Which deal option to buy (an option id from groupon_get_deal). Required when the deal has more than one option; may be omitted for a single-option deal.",
          ),
        quantity: PositiveInt.max(MAX_QUANTITY)
          .default(1)
          .describe(`How many to add (1-${MAX_QUANTITY}, default 1).`),
        isGift: z
          .boolean()
          .default(false)
          .describe("Mark the line item as a gift."),
        confirmToken: confirmTokenParam,
      }),
    },
    async ({ dealId, optionId, quantity, isGift, confirmToken }, ctx) => {
      const slug = stripDealId(dealId);
      // getDeal is an anonymous READ — run on EVERY call (preview and confirmed)
      // to resolve and preview the option. The cart MUTATION only happens once
      // the gate below passes.
      const deal = await readClient.getDeal({ dealId: slug });
      const resolved = resolveCartItem(deal, optionId);
      // Read the cart BEFORE the gate too (fleet-audit #1016). Whether
      // createOrUpdateCartItem sets the line to `quantity` or adds to it is not
      // documented, so an option already in the cart could end up LOWER than it
      // was. The preview names the existing line and both outcomes, and since
      // the preview is bound into the token, a cart line that changes between
      // the two calls is refused as DRAFT_CHANGED. This same read is the
      // "before" snapshot for verification after the add.
      const before = await webClient.getCart();
      const existing = cartLineState(before, resolved.optionId);

      const preview = {
        deal: resolved.dealTitle,
        option: resolved.optionTitle,
        optionId: resolved.optionId,
        quantity,
        isGift,
        price: resolved.price,
        ...(resolved.strikeThroughPrice
          ? { strikeThroughPrice: resolved.strikeThroughPrice }
          : {}),
        ...(resolved.discount ? { discount: resolved.discount } : {}),
        alreadyInCart: existing.display,
        ...(existing.warning ? { cartWarning: existing.warning(quantity) } : {}),
        note: "Once confirmed, this is added to your Groupon cart; you then complete payment yourself at the checkout URL.",
      };
      // Exactly what addToCart sends. The price read now is bound through the
      // preview, so a deal repriced between the two calls is DRAFT_CHANGED.
      const cartItem = {
        optionId: resolved.optionId,
        dealUuid: resolved.dealUuid,
        optionUuid: resolved.optionUuid,
        quantity,
        isGift,
      };
      const gate = await confirmWrite(ctx, {
        tool: "groupon_purchase",
        action: "groupon.purchase",
        summary: `Add ${quantity} × "${resolved.optionTitle}" (${resolved.dealTitle}) to your Groupon cart`,
        message: "Review and confirm adding this deal to your Groupon cart:",
        // One signed-in session per server; there is no account to choose.
        account: undefined,
        target: slug,
        payload: cartItem,
        preview,
        confirmToken,
      });
      if (gate) return gate;

      // `before` (read above, and bound through the preview) lets verification
      // tell a real change from an option that was already there. A rejected
      // add throws (see GrouponWebClient.addToCart) rather than returning.
      await webClient.addToCart(cartItem);
      // Re-read the cart to confirm the item actually landed — an accepted
      // mutation is not proof it persisted.
      const after = await webClient.getCart();
      const { verified, quantityInCart } = verifyAdd(
        before,
        after,
        resolved.optionId,
        quantity,
      );

      let note: string;
      if (verified) {
        note =
          "Item added to your Groupon cart. Open the checkout URL and complete payment (Apple/Google Pay, card, or PayPal) yourself — this tool cannot place the order.";
      } else if (quantityInCart !== undefined) {
        note = `Groupon accepted the add-to-cart request, but the cart re-read shows quantity ${quantityInCart} for this option, not the ${quantity} requested. Open the checkout URL to check your cart before paying — this tool cannot place the order.`;
      } else {
        note =
          "Groupon accepted the add-to-cart request, but a cart re-read did not confirm the item is present with the requested quantity. Open the checkout URL to check your cart before paying — this tool cannot place the order.";
      }

      return minifiedResult({
        added: true,
        verified,
        deal: resolved.dealTitle,
        option: resolved.optionTitle,
        optionId: resolved.optionId,
        quantity,
        ...(quantityInCart !== undefined ? { quantityInCart } : {}),
        checkoutUrl: CHECKOUT_URL,
        note,
      });
    },
  );

  server.registerTool(
    "groupon_clear_cart",
    {
      description:
        "Remove ALL items from your signed-in Groupon cart. Once confirmed it removes every line item and re-reads " +
        "the cart to verify it is empty. " +
        CONFIRM_FLOW_SENTENCE,
      annotations: toolAnnotations({
        title: "Clear your Groupon cart",
        readOnly: false,
        openWorld: true,
      }),
      inputSchema: z.object({
        expectedOptionIds: z
          .array(NonEmptyString)
          .optional()
          .describe(
            "The optionIds the preview listed. When given, the clear is refused if the cart's line items are no longer exactly these (in any order).",
          ),
        confirmToken: confirmTokenParam,
      }),
    },
    async ({ expectedOptionIds, confirmToken }, ctx) => {
      const cart = await webClient.getCart();
      const optionIds = cartLineOptionIds(cart);

      if (expectedOptionIds) {
        const expected = new Set(expectedOptionIds);
        const added = optionIds.filter((id) => !expected.has(id));
        const gone = [...expected].filter((id) => !optionIds.includes(id));
        if (added.length > 0 || gone.length > 0) {
          throw new McpToolError(
            "Your Groupon cart has changed since the preview, so nothing was removed.",
            {
              hint:
                (added.length > 0 ? `Now in the cart but not expected: ${added.join(", ")}. ` : "") +
                (gone.length > 0 ? `Expected but no longer in the cart: ${gone.join(", ")}. ` : "") +
                "Run groupon_clear_cart again without a token to preview the current cart.",
            },
          );
        }
      }

      if (optionIds.length === 0) {
        return minifiedResult({
          cleared: true,
          verified: true,
          removed: 0,
          note: "Your Groupon cart is already empty.",
        });
      }

      const preview = {
        itemCount: optionIds.length,
        optionIds,
        note: "Once confirmed, every line item above is removed from your cart. Pass these optionIds back as expectedOptionIds to refuse the clear if the cart has changed.",
      };
      const gate = await confirmWrite(ctx, {
        tool: "groupon_clear_cart",
        action: "groupon.clear_cart",
        summary: `Remove all ${optionIds.length} line items from your Groupon cart`,
        message: "Review and confirm removing every item from your Groupon cart:",
        account: undefined,
        // The cart is re-read on every call (above), so a line added or
        // removed between the two calls is refused as DRAFT_CHANGED.
        target: "",
        payload: { optionIds },
        preview,
        confirmToken,
      });
      if (gate) return gate;

      const removedIds: string[] = [];
      for (const id of optionIds) {
        try {
          await webClient.deleteCartItem({ optionId: id });
        } catch (err) {
          // Lines are removed one at a time, so a failure partway through leaves
          // the earlier removals applied: say exactly which lines went and which
          // are still there rather than implying nothing changed.
          const message = err instanceof Error ? err.message : String(err);
          const stillThere = optionIds.slice(removedIds.length);
          throw new McpToolError(
            `Cleared ${removedIds.length} of ${optionIds.length} cart lines before a removal failed: ${message}`,
            {
              hint:
                (removedIds.length > 0 ? `Already removed: ${removedIds.join(", ")}. ` : "No lines were removed. ") +
                `Possibly still in the cart: ${stillThere.join(", ")}. Check groupon_view_cart before retrying.`,
              cause: err,
            },
          );
        }
        removedIds.push(id);
      }
      const after = await webClient.getCart();
      const remaining = cartLineOptionIds(after);
      const verified = remaining.length === 0;

      if (verified) {
        return minifiedResult({
          cleared: true,
          verified: true,
          removed: optionIds.length,
          note: "Your Groupon cart is now empty.",
        });
      }
      return minifiedResult({
        cleared: true,
        verified: false,
        removed: optionIds.length,
        remaining,
        note: "Groupon accepted the removals, but a re-read still shows items in the cart. Open the checkout URL to check your cart.",
      });
    },
  );
}
