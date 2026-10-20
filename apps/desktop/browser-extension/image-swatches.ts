/** Same 5-bit RGB bins as daemon `extractAssetImageMetadata`. Pure — no DOM. */

export interface ImageSwatch {
  hex: string;
  weight: number;
}

export function swatchesFromRgba(data: ArrayLike<number>): ImageSwatch[] {
  const bins = new Map<string, { rgb: number[]; count: number }>();
  let total = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < 128) continue;
    const rgb = [data[i]!, data[i + 1]!, data[i + 2]!];
    const key = rgb.map((value) => Math.floor(value / 32)).join(',');
    const bin = bins.get(key) || { rgb: [0, 0, 0], count: 0 };
    rgb.forEach((value, index) => { bin.rgb[index]! += value; });
    bin.count += 1;
    total += 1;
    bins.set(key, bin);
  }
  if (total === 0) return [];
  return [...bins.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 8)
    .map((bin) => ({
      hex: `#${bin.rgb.map((value) => Math.round(value / bin.count).toString(16).padStart(2, '0')).join('')}`,
      weight: bin.count / total,
    }));
}
