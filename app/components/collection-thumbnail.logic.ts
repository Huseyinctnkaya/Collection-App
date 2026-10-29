/**
 * Placeholder-tile logic for CollectionThumbnail.
 *
 * Kept apart from the component so it can be unit tested with bare
 * `node --test` — importing the component would pull in React and Polaris.
 */

// Deep enough for white text to clear WCAG AA (all are 5:1 or better),
// and spread around the wheel so adjacent rows rarely repeat a colour.
export const TILE_COLORS = [
  "#1F6F6B",
  "#2D5F8A",
  "#7A4A86",
  "#A14A3C",
  "#8A6420",
  "#3F6B35",
  "#8F3F5E",
  "#44566B",
];

/**
 * Pick a tile colour for a collection.
 *
 * djb2, so the same handle always lands on the same colour — on every render
 * and on every server. A collection that changed colour between page loads
 * would be worse than no colour at all.
 */
export function pickColor(seed: string): string {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0;
  }
  return TILE_COLORS[Math.abs(hash) % TILE_COLORS.length];
}

/** First letter or digit of the title, so "50c" shows "5" rather than nothing. */
export function initial(title: string): string {
  const match = title.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toUpperCase() : "?";
}
