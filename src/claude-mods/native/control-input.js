export default function ControlInput(props, surface) {
  const inside = e => e.x >= 0 && e.y >= 0 && e.x < surface.columns && e.y < surface.rows;
  const plain = e => e.button === "left" && !e.ctrl && !e.alt && !e.shift;
  surface.onPointer(e => {
    const old = surface.state;
    if (e.type === "down") surface.setState({ armed: props.enabled && plain(e) && inside(e), x: e.x, y: e.y });
    else if (e.type === "leave" || (e.type === "move" && old?.armed &&
      (!inside(e) || old.x !== e.x || old.y !== e.y || !plain(e)))) surface.setState({ armed: false });
    else if (e.type === "up") {
      surface.setState({ armed: false });
      if (props.enabled && old?.armed && plain(e) && inside(e) && old.x === e.x && old.y === e.y)
        surface.post({ action: "press" });
    }
  });
  return surface.elements.Box({ width: "100%", height: 2, children: [] });
}
