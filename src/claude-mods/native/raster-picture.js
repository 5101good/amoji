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
