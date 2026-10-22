// Raster data goes directly to the host's Markdown image renderer. Client
// owns only the transparent pointer layer; it never draws or decodes media.
export function rasterPicture($, e, s, { key, source, alt, width = 12, height = 5, enabled = false, interactive = false, pending = "" }) {
  const { Box, Markdown, Client, Text } = $.ui.resolve(e);
  if (e.surface !== "desktop" || !/^data:image\/(png|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(source || ""))
    return Text({ children: [alt], dimColor: true });
  const label = String(alt || "").replace(/[\\[\]\r\n]/g, " ");
  return Box({ position: "relative", width, height, alignItems: "center", justifyContent: "center", children: [
    Markdown({ text: `![${label}](${source})` }),
    ...(interactive ? [Box({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
      children: [Client({ key, module: "./picture-input.js", width, height,
        props: { width, height, enabled, pending } })] })] : []),
  ] });
}

// The sticker look for every Amoji surface but chat messages: Desktop draws
// Markdown images inside a framed card, so the same raster is wrapped in an
// SVG image instead. `dock` sets it on a round backdrop (the composer strip),
// `plate` on a soft rounded square (grids and details). An interactive
// sticker carries exactly rasterPicture's pointer layer and semantics.
export function stickerPicture($, e, s, { key, source, alt, width, height, pixels, enabled = false,
  dock = false, plate = false, interactive = true, pending = "" }) {
  const { Box, Svg, Client, Text } = $.ui.resolve(e);
  if (e.surface !== "desktop" || !Svg || !/^data:image\/(png|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(source || ""))
    return Text({ children: [alt], dimColor: true });
  const inset = dock ? Math.round(pixels * 0.09) : plate ? Math.round(pixels * 0.1) : 0;
  const art = pixels - 2 * inset, half = pixels / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pixels} ${pixels}">` +
    (dock ? `<circle cx="${half}" cy="${half}" r="${half - 0.5}" fill="#80808029" stroke="#80808047"/>` : "") +
    (plate ? `<rect width="${pixels}" height="${pixels}" rx="${Math.round(pixels * 0.22)}" fill="#80808017"/>` : "") +
    `<image href="${source}" x="${inset}" y="${inset}" width="${art}" height="${art}" preserveAspectRatio="xMidYMid meet"/></svg>`;
  return Box({ position: "relative", width, height, alignItems: "center", justifyContent: "center", children: [
    Svg({ source: svg, alt: String(alt || ""), width: pixels, height: pixels }),
    ...(interactive ? [Box({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
      children: [Client({ key, module: "./picture-input.js", width, height, props: { width, height, enabled, pending } })] })] : []),
  ] });
}

// CSS pixels a sticker may take in a box of cells, with a little air.
export const stickerPixels = (width, height) => Math.max(16, Math.min(width * 8, height * 18) - 4);
