/**
 * Lowercases text and strips accents, for search matching. NFD splits a letter like Ș, Ț, Ă,
 * Â or Î into its base letter plus a combining mark, and the regex drops the marks — so typing
 * "stiri" finds "Știri", while typing the accented letter still works too.
 * Mirrored by `foldText()` in server.ts (the backend shares no code with src/).
 */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
