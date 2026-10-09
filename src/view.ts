import { resolveView, viewParam, type View } from '@chrischall/mcp-utils';

/**
 * The rungs this server honours (`@chrischall/mcp-utils`' `view` vocabulary;
 * `chrischall/workflows` `docs/fleet-conventions.md`, "Response shape").
 *
 * A GROUNDED repo: it already had a field projection, and it was opt-in —
 * `compact: false`, so the caller had to know the slim rung existed and ask
 * for it. An efficiency that has to be requested is one that usually is not,
 * and the caller paying for it is the one least able to know.
 *
 * `compact` is the default now. Every read tool has a hand-written projection,
 * and it is NOT then media-stripped: its field choices were made WITH
 * knowledge of the API, and a blind subtractive rule over its output would let
 * an un-grounded rule overrule a grounded one — which bit viator-mcp, where
 * the projection deliberately keeps a cover image.
 *
 * No `raw` rung: `full` already returns the untouched upstream payload.
 */
export const GRP_VIEWS = ['compact', 'full'] as const;

const NOTE =
  'compact returns the slim projection; ' +
  '"full" returns Groupon\'s whole records.';

/** The `view` parameter every read tool in this server takes. */
export const viewArg = (): ReturnType<typeof viewParam> => viewParam(GRP_VIEWS, { note: NOTE });

/** Is this call asking for the slim rung? Replaces the old `compact` boolean. */
export function isCompact(view: string | undefined): boolean {
  const rung: View = resolveView(view, GRP_VIEWS);
  return rung === 'compact';
}
