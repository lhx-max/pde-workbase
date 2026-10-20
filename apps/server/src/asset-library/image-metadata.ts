// Adapted from Bezier/Loom 319e5eee, Apache-2.0. Local image decoding only.
import sharp from 'sharp';
import type { PersonalAssetVersion } from '@bezier/contracts';

export async function extractAssetImageMetadata(bytes: Buffer): Promise<NonNullable<PersonalAssetVersion['imageMetadata']>> {
  try {
    const source = sharp(bytes, { limitInputPixels: 40_000_000, animated: false });
    const meta = await source.metadata();
    const swapped = [5,6,7,8].includes(meta.orientation || 1);
    const { data } = await source.rotate().resize(64,64,{fit:'inside',withoutEnlargement:true}).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const bins = new Map<string, { rgb: number[]; count: number }>();
    let total = 0;
    for(let i=0;i<data.length;i+=4) {
      if(data[i+3]! < 128) continue;
      const rgb=[data[i]!,data[i+1]!,data[i+2]!];
      const key=rgb.map(v=>Math.floor(v/32)).join(',');
      const bin=bins.get(key)||{rgb:[0,0,0],count:0};
      rgb.forEach((v,j)=>bin.rgb[j]!+=v); bin.count++; total++; bins.set(key,bin);
    }
    const colors=[...bins.values()].sort((a,b)=>b.count-a.count).slice(0,8).map(bin=>({hex:'#'+bin.rgb.map(v=>Math.round(v/bin.count).toString(16).padStart(2,'0')).join(''),weight:bin.count/total}));
    return { width: swapped?meta.height:meta.width, height:swapped?meta.width:meta.height, format:meta.format, colors, status:'ready' };
  } catch { return {colors:[],status:'unsupported'}; }
}
