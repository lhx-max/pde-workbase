/** Same matching rules as in-app AssetTagPicker. Pure — no DOM. */

export function matchTagOptions(available: string[], query: string): { options: string[]; canCreate: boolean } {
  const needle = query.trim();
  const options = available.filter((tag) => !needle || tag.toLowerCase().includes(needle.toLowerCase()));
  const canCreate = Boolean(needle && !available.some((tag) => tag.toLowerCase() === needle.toLowerCase()));
  return { options, canCreate };
}
