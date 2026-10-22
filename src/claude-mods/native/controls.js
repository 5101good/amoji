// Keep native focus/accessibility and appearance; pointer capture lives in a
// keyed Client so Desktop focus redraws cannot expire a Button press handle.
export function controls($, e, s) {
  const { Box, Button, Client } = $.ui.resolve(e);
  const site = e.component;
  s.controls ??= {};
  const targets = new Map();
  s.controls[site] = targets;
  const context = site === "AbovePrompt" ? "entry" :
    s.tab === "create" ? `${s.tab}:${s.step}:${s.draft?.draft_id || ""}:${s.draft?.version || 0}:${s.editEpoch}:${s.reviewed}` :
    `${s.tab}:${s.detail?.expression.asset_id || ""}:${s.detail?.version || 0}:${s.transfer || ""}:${!!s.selecting}`;
  // `lead` (a mark or icon) is drawn before the button and shares its press.
  return ({ lead, ...props }) => {
    const button = Button(props);
    const native = lead ? Box({ flexDirection: "row", alignItems: "center", gap: 0, children: [lead, button] }) : button;
    if (e.surface !== "desktop" || !Client || s.controlFault) return native;
    const key = `control:${site}:${context}:${props.key}`;
    if (!s.busy) targets.set(key, props.onPress);
    return Box({ position: "relative", children: [native,
      Box({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        children: [Client({ key, module: "./control-input.js",
          width: "100%", height: 2, props: { enabled: !s.busy } })],
      }),
    ] });
  };
}
