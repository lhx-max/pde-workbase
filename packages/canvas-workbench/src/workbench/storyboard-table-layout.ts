/** Header plus four complete measured rows; small tables have no scrolling viewport. */
export function storyboardTableViewportHeight(rowHeights: number[], headerHeight: number): number | undefined {
  if (rowHeights.length <= 4 || rowHeights.slice(0, 4).some(height => height <= 0)) return undefined;
  return Math.ceil(headerHeight + rowHeights.slice(0, 4).reduce((sum, height) => sum + height, 0));
}
