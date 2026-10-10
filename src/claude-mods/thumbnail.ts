import sharp from 'sharp';

/** Native Mods has a 100k-character tree budget. Six cards must fit together. */
export async function thumbnailSvg(bytes: Uint8Array): Promise<string> {
  for (const edge of [96,72,48,32]) {
    const png = await sharp(bytes,{limitInputPixels:2048*2048}).rotate().resize(edge,edge,{fit:'inside',withoutEnlargement:true}).png({palette:true,colours:64,compressionLevel:9}).toBuffer();
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><image width="96" height="96" href="data:image/png;base64,${png.toString('base64')}"/></svg>`;
    if (source.length <= 8500) return source;
  }
  throw new Error('PREVIEW_UNAVAILABLE');
}
