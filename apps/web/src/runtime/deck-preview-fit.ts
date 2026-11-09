/** Keep the deck's design viewport intact; fit it rather than reflow its text. */
export function deckPreviewFit(
  canvas: { width: number; height: number } | null,
  design: { designWidth: number; designHeight: number } | null,
  zoomScale = 1,
) {
  if (!canvas || !design) return null;
  const { width, height } = canvas;
  const { designWidth, designHeight } = design;
  if (![width, height, designWidth, designHeight, zoomScale].every(value => Number.isFinite(value) && value > 0)) return null;
  // A deck is a fixed sheet, not a responsive webpage. `100%` means “fit this
  // sheet in the available workspace”; zoom scales that same logical sheet.
  // Its iframe viewport therefore never crosses responsive breakpoints.
  const scale = Math.min(width / designWidth, height / designHeight) * zoomScale;
  return {
    width: designWidth, height: designHeight, scale,
    // Centre the sheet while it fits. Once zoom makes it larger than the
    // workspace, pin its origin so every edge remains reachable by scrolling.
    left: Math.max(0, (width - designWidth * scale) / 2),
    top: Math.max(0, (height - designHeight * scale) / 2),
  };
}
