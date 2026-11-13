import { M3U_ICON_PATH } from '../components/Logo';

// Tight bounding box of M3U_ICON_PATH is x:[0, 577.2] y:[0, 204.47] within the source logo's
// 1155x205 viewBox (it's exactly the left half — the "m3u" glyph). Padded a bit on each side.
const VIEW_BOX = '-12 -12 601.2 228.47';

/** Builds a data: URI for an SVG favicon containing just the "m3u" glyph, in `color`. */
export function buildFaviconDataUri(color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW_BOX}">` +
    `<g transform="matrix(1,0,0,1,-382.8,-1723.762143)">` +
    `<g transform="matrix(1,0,0,1,0,1286)">` +
    `<g transform="matrix(2.306954,0,0,2.306954,-1254.676259,-705.755396)">` +
    `<path fill="${color}" d="${M3U_ICON_PATH}"/>` +
    `</g></g></g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Swaps the document's favicon for the "m3u" glyph in `color`. App.tsx passes the palette's
 * primary colour, so the tab icon matches the logo in the top bar.
 */
export function updateFavicon(color: string): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = buildFaviconDataUri(color);
}
