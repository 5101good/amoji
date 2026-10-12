// Claude Desktop presentation only. The hooks layer resolves the expression
// from the engine-provided Client key; this module never carries semantics.
export default function PictureInput(props, surface) {
  const { Box, Text } = surface.elements;
  if (!props.enabled && surface.state?.posted)
    surface.setState({ armed: false, posted: false });
  const inside = (e) => e.x >= 0 && e.y >= 0 &&
    e.x < surface.columns && e.y < surface.rows;
  const plainLeft = (e) => e.button === "left" && !e.ctrl && !e.alt && !e.shift;
  surface.onPointer((e) => {
    const old = surface.state;
    if (e.type === "down") {
      surface.setState({ armed: props.enabled && plainLeft(e) && inside(e), x: e.x, y: e.y });
    } else if (e.type === "leave" ||
      (e.type === "move" && old?.armed &&
        (!inside(e) || e.x !== old.x || e.y !== old.y || !plainLeft(e)))) {
      surface.setState({ armed: false });
    } else if (e.type === "up") {
      surface.setState({ armed: false });
      if (props.enabled && old?.armed && plainLeft(e) && inside(e) &&
          e.x === old.x && e.y === old.y) {
        surface.setState({ armed: false, posted: true });
        surface.post({ action: "send" });
      }
    }
  });
  // Explicit dimensions are required by Desktop. Percentage-height roots
  // currently measure one row, leaving most of the picture unclickable.
  return Box({ width: props.width || 9, height: props.height || 5,
    justifyContent: "flex-end", alignItems: "center",
    children: surface.state?.posted && props.enabled && props.pending !== ""
      ? [Text({ children: [props.pending || "Sending…"], color: "text", backgroundColor: "inverseText" })] : [],
  });
}
