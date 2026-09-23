import type { McpServer } from "@modelcontextprotocol/server";

// Cart / purchase tools. These need a signed-in browser on the same machine;
// a deployment without one registers the anonymous read tree alone.
//
// These are the confirm-gated WRITE surface: view the signed-in user's cart, add
// a deal option to it, and clear it. They front Groupon's authenticated cart ops
// (GetCart / createOrUpdateCartItem / deleteCartItem) via GrouponWebClient, which
// carries the session cookie — see src/web-client.ts + src/fetchproxy-cookie.ts.
//
// CHECKOUT IS HAND-OFF ONLY. Groupon's checkout is native Apple/Google Pay / card
// / PayPal SDKs — there is NO replayable place-order mutation. groupon_purchase
// ends at "added to cart" and returns the ready-to-pay checkout URL for the USER
// to complete payment. This tool NEVER attempts to place an order.
//
// The confirm gate mirrors the fleet's write pattern (artsonia writes.ts): a
// tool with `confirm: schemaConfirm` performs NO mutation without `confirm:true`
// — it returns a DRY-RUN preview instead. groupon_purchase still issues the
// anonymous getDeal READ during a dry run (needed to resolve/preview the option),
// but never the cart mutation.
//
// resolveCartItem maps a getDeal read → the ids createOrUpdateCartItem needs.
// Verified against a live getDeal (2026-07-25): deal.uuid is the dealUuid, and
// each deal.options[] entry carries the option's `id` (optionId) and `uuid`
// (optionUuid) — for the observed deal these two were the same value, but they
// are read independently so a future divergence is handled correctly.
import { z } from "zod";
import {
  McpToolError,
  NonEmptyString,
  PositiveInt,
  minifiedResult,
  schemaConfirm,
  toolAnnotations,
} from "@chrischall/mcp-utils";
import type { GrouponClient, GetDeal } from "../client.js";
import type { GrouponWebClient } from "../web-client.js";
import { stripDealId } from "./detail.js";

/** The user-facing, ready-to-pay checkout URL. There is no place-order API; the
 *  user completes payment here themselves. */
const CHECKOUT_URL = "https://www.groupon.com/checkout/cart";

/**
 * DRY-RUN envelope. A confirm-gated tool returns this when `confirm` is not
 * `true`: the fields it WOULD act on, plus an unmistakable "nothing was sent"
 * note. No network mutation happens on this path.
 */
function previewResult(
  action: string,
  wouldDo: Record<string, unknown>,
  caveat?: string,
) {
  return minifiedResult({
    preview: true,
    action,
    note: `DRY RUN — nothing was sent to Groupon. Re-run with confirm: true to perform this.${caveat ? ` ${caveat}` : ""}`,
    ...wouldDo,
  });
}

/**
 * Collect every distinct `optionId` value anywhere in a cart payload, walking
 * the whole tree (cart line-item shape is not otherwise modelled, and the
 * authenticated shape can drift). Cycle-safe. Used both to verify an add landed
 * and to enumerate line items for a clear.
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
        "Add a Groupon deal option to your cart, ready for checkout. WITHOUT confirm:true this is a DRY RUN — it " +
        "previews what would be added and makes NO change to your cart. WITH confirm:true it adds the item, re-reads " +
        "the cart to verify the line quantity, and returns the checkout URL for YOU to complete payment. It CANNOT place the order — " +
        "Groupon checkout is native Apple/Google Pay, card, or PayPal.",
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
        quantity: PositiveInt.default(1).describe(
          "How many to add (default 1).",
        ),
        isGift: z
          .boolean()
          .default(false)
          .describe("Mark the line item as a gift."),
        confirm: schemaConfirm,
      }),
    },
    async ({ dealId, optionId, quantity, isGift, confirm }) => {
      const slug = stripDealId(dealId);
      // getDeal is an anonymous READ — safe to run during a dry run to resolve
      // and preview the option. The cart MUTATION only happens under confirm.
      const deal = await readClient.getDeal({ dealId: slug });
      const resolved = resolveCartItem(deal, optionId);

      if (confirm !== true) {
        return previewResult(
          "purchase",
          {
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
          },
          "On confirm, this is added to your Groupon cart; you then complete payment yourself at the checkout URL.",
        );
      }

      // Snapshot the cart first, so verification can tell a real change from
      // an option that was already there. A rejected add throws (see
      // GrouponWebClient.addToCart) rather than returning.
      const before = await webClient.getCart();
      await webClient.addToCart({
        optionId: resolved.optionId,
        dealUuid: resolved.dealUuid,
        optionUuid: resolved.optionUuid,
        quantity,
        isGift,
      });
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
        "Remove ALL items from your signed-in Groupon cart. WITHOUT confirm:true this is a DRY RUN listing what would " +
        "be removed. WITH confirm:true it removes every line item and re-reads the cart to verify it is empty.",
      annotations: toolAnnotations({
        title: "Clear your Groupon cart",
        readOnly: false,
        openWorld: true,
      }),
      inputSchema: z.object({ confirm: schemaConfirm }),
    },
    async ({ confirm }) => {
      const cart = await webClient.getCart();
      const optionIds = collectCartOptionIds(cart);

      if (optionIds.length === 0) {
        return minifiedResult({
          cleared: true,
          verified: true,
          removed: 0,
          note: "Your Groupon cart is already empty.",
        });
      }

      if (confirm !== true) {
        return previewResult(
          "clear_cart",
          { itemCount: optionIds.length, optionIds },
          "On confirm, every line item above is removed from your cart.",
        );
      }

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
      const remaining = collectCartOptionIds(after);
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
