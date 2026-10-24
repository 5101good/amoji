import { applyGuidance } from './guidance.js';
import { state, load, loadGalleryWindow, open, send, call, invalidate, perform, navigate, loadCards, answer, quickReply, retryUnsent } from "./controller.js";
import { L, errorText, refOf, uiLocale, view } from "./transport.js";
import { pane } from "./views.js";
import { controls } from "./controls.js";
import { deliveryText, messageSegments, messageView } from "./message-view.js";
import { stickerPicture, stickerPixels } from "./raster-picture.js";
import { ACCENT, SURFACE } from "./ui-kit.js";
import { MARK_TILE_SVG, DIVIDER_SVG } from "./brand.js";
import { bandItems, BAND_LIMIT } from "./band.js";
import { decisionStrip } from "./decisions.js";

const turns = new Map();
let definitions;
async function toolDefinitions($) {
  definitions ??= call($, (await state($)).context, "tools", {}).catch(error => { definitions = undefined; throw error; });
  return definitions;
}
export function register(on) {
  on("prompt.submit", async ($,e,next)=>applyGuidance($,e,next)).catch(async ($,e,next)=>{
    // Native UI callbacks run outside a hook; Mods reports their own submission
    // as re-entry. applyGuidance still requires the exact in-flight user send.
    if(next.error.kind === "re-entry")return applyGuidance($,e,next);
    if(next.called)throw new Error("AMOJI_GUIDANCE_OUTCOME_UNKNOWN");
    return {drop:"Amoji guidance could not be attached. Review the guidance settings and retry."};
  });
  on("session.end",async($,e,next)=>{
    const s=await state($);s.activeGuidance=[];s.guidanceTouched=true;s.guidanceReceipt=null;
    return next(e);
  });
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "amoji",
      description: "Open Amoji expressions / 打开 AI 原生表情",
      immediate: true,
    });
    // Tool definitions come from the shared core so every host offers the same 0.1 acts.
    try {
      for (const tool of await toolDefinitions($)) await $.tool.register({ ...tool, isDeferred: false });
    } catch { /* The core is unavailable: plain text remains a complete reply. */ }
    return next(e);
  });
  on("turn.start", async ($, e, next) => {
    if (e.agentId) return next(e);
    const id = await $.session.id();
    const ordinal = await $.session.turns();
    const s = await state($);
    if (s.delivery?.text === e.text && s.delivery.phase !== "error")
      s.delivery.turnId = e.turnId;
    turns.set(id, {
      turnId: e.turnId,
      ...(Number.isSafeInteger(ordinal) && ordinal > 0
        ? { turnOrdinal: ordinal }
        : {}),
    });
    return next(e);
  });
  on("turn.complete", async ($, e, next) => {
    if (!e.agentId) {
      const id = await $.session.id();
      if (turns.get(id)?.turnId === e.turnId) turns.delete(id);
      const s = await state($);
      if (s.delivery?.turnId === e.turnId) {
        s.delivery = null;
        invalidate($);
      }
      void loadCards($, s);
    }
    return next(e);
  });
  on("command.run", { command: "amoji" }, async ($) => {
    await open($);
    return { text: "" };
  });
  on("ui.scroll", { component: "Pane", requestId: "amoji" }, async ($, e, next) => {
    const result = await next(e);
    invalidate($);
    return result;
  });
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.surface !== "desktop" && e.surface !== "terminal") return next(e);
    if (e.props.hasSurvey || e.props.view?.agentId) return next(e);
    const { Box, Text, Svg } = $.ui.resolve(e);
    const s = await state($);
    s.viewAgentId = e.props.view?.agentId;
    const Button = controls($, e, s);
    // The strip loads after the band first draws: the composer never waits on
    // the local service, and a failed read simply leaves the button alone.
    if (e.surface === "desktop" && !s.bandItems && !s.bandRequest) {
      s.bandRequest = call($, s.context, "browse", { query: "", category: "all", offset: 0, limit: BAND_LIMIT, library: false, archived: false })
        .then(collection => { s.bandItems = collection.items; s.bandTotal = collection.total; invalidate($); })
        .catch(() => { s.bandItems = []; })
        .finally(() => { s.bandRequest = null; });
    }
    if (!s.cards && !s.cardsRequest) s.cardsRequest = loadCards($, s).finally(() => { s.cardsRequest = null; });
    s.bandTargets = new Map();
    const items = bandItems(s);
    const d = s.delivery;
    const tone = !d ? null : d.phase === "error" ? "error" : d.phase === "waiting" ? "success" : ACCENT;
    const strip = e.surface === "desktop" && !d && !s.bandFault && items.length > 0;
    const row = Box({
      flexDirection: "row", alignItems: "center", gap: 1, width: "100%", position: "relative",
      flexWrap: strip ? "nowrap" : "wrap",
      children: [
        e.surface === "desktop"
          ? Box({ key: "amoji-entry", flexShrink: 0, hover: { backgroundColor: SURFACE }, children: [Button({
              key: "amoji-open", plain: true, onPress: () => open($),
              lead: Svg({ source: MARK_TILE_SVG, alt: "Amoji", width: 26, height: 26 }),
              children: [Text({ children: ["Amoji"], ...(s.rich ? { weight: "semibold" } : { bold: true }) })],
            })] })
          : Button({ key: "amoji-open", label: L(s, "☺ 表情", "☺ Expressions"), onPress: () => open($) }),
        // A dock of recent stickers on round backdrops; hovering one reveals,
        // at the row's end, the name and the fixed meaning Claude would read.
        ...(strip ? [
          Box({ flexShrink: 0, children: [Svg({ source: DIVIDER_SVG, alt: "|", width: 8, height: 20 })] }),
          // Nothing before the meaning slot may shrink: a revealed meaning
          // must take only the slot's own room, never nudge the stickers.
          Box({ flexDirection: "row", alignItems: "center", gap: 1, flexShrink: 0, children: items.map(item => {
            const x = item.expression;
            const key = `band:${s.pictureEpoch || 0}:${x.asset_id}:${x.revision_id}`;
            const enabled = !s.busy && !s.viewAgentId;
            if (enabled) s.bandTargets.set(key, item);
            // Desktop lights a hover group only when the hover changes a style:
            // a background too faint to see keeps the round dock unchanged.
            return Box({ key: "band-tile:" + x.asset_id, hover: { scope: "amoji-band:" + x.asset_id, backgroundColor: "#80808003" }, children: [
              stickerPicture($, e, s, { key, source: item.preview, alt: view(s, x).name, width: 4, height: 2, pixels: 32, enabled, dock: true }),
            ] });
          }) }),
          (s.bandTotal || 0) > items.length && Box({ flexShrink: 0, children: [Text({ children: [`+${s.bandTotal - items.length}`], dimColor: true,
            ...(s.rich ? { mono: true, size: "caption" } : {}) })] }),
          // Fixed height and only the room left on the row: revealing a
          // meaning never reflows the stickers under the pointer.
          Box({ flexGrow: 1, flexShrink: 1, width: 0, minWidth: 0, height: 2, marginLeft: 1, justifyContent: "flex-end",
            flexDirection: "row", alignItems: "center", overflow: "hidden", children: items.map(item => Box({
            display: "none", hover: { scope: "amoji-band:" + item.expression.asset_id, display: "flex" },
            flexDirection: "row", gap: 1, alignItems: "center", minWidth: 0, flexShrink: 1, children: [
              Box({ flexShrink: 0, children: [Text({ children: [view(s, item.expression).name], ...(s.rich ? { weight: "medium", size: "footnote" } : { bold: true }) })] }),
              Box({ flexShrink: 1, minWidth: 0, children: [Text({ children: [view(s, item.expression).meaning], dimColor: true, wrap: "truncate-end", ...(s.rich ? { size: "footnote" } : {}) })] }),
            ] })) }),
        ].filter(Boolean) : []),
        ...(d ? [Box({ flexDirection: "row", gap: 1, alignItems: "center", children: [
          Text({ children: [d.phase === "waiting" || d.phase === "error" ? "●" : "◌"], color: tone }),
          Text({ children: [deliveryText(s)], wrap: "truncate-end", ...(d.phase === "error" ? { color: "error" } : { dimColor: true }) }),
        ] })] : []),
      ],
    });
    const waiting = decisionStrip($, e, s, Button);
    return waiting.length ? Box({ flexDirection: "column", gap: 1, width: "100%", children: [...waiting, row] }) : row;
  });
  on("ui.render", { component: "Pane" }, async ($, e, next) => {
    if (
      e.requestId !== "amoji" ||
      (e.surface !== "desktop" && e.surface !== "terminal")
    )
      return next(e);
    const s = await state($);
    s.viewAgentId = e.props.view?.agentId;
    if (s.viewAgentId) {
      s.pictureTargets?.clear();
      const { Text } = $.ui.resolve(e);
      return Text({ children: [L(s, "回到主对话后即可发送表情", "Return to the main conversation to send expressions")], dimColor: true });
    }
    if (!s.preferences && !s.error) {
      try {
        await load($, s);
      } catch (error) {
        s.error = errorText(s, error);
      }
    }
    const { Text } = $.ui.resolve(e);
    try { await loadGalleryWindow($, s, e); }
    catch (error) { s.error = errorText(s, error); }
    if (e.surface === "desktop") {
      if (s.pictureCollection !== s.collection) {
        s.pictureCollection = s.collection;
        s.pictureEpoch = (s.pictureEpoch || 0) + 1;
      }
      s.pictureTargets = new Map();
    }
    const makePicture = (item) => {
      if (!item.preview || e.surface !== "desktop")
        return Text({
          children: [view(s, item.expression).fallback],
          dimColor: true,
        });
      const key = `picture:${s.pictureEpoch}:${item.expression.asset_id}:${item.expression.revision_id}`;
      const clickable = (s.tab === "picker" || s.tab === "library") && !s.pictureFault;
      const enabled = clickable && !s.busy && !s.pictureClosed;
      if (enabled) s.pictureTargets.set(key, item);
      if (s.pictureFault) return Text({ children: [view(s, item.expression).name], dimColor: true });
      return stickerPicture($, e, s, { key, source: item.preview, alt: view(s, item.expression).name,
        width: 9, height: 4, pixels: stickerPixels(9, 4), plate: true, enabled,
        pending: s.tab === "picker" ? L(s, "发送中…", "Sending…") : "" });
    };
    try {
      return pane($, e, s, makePicture);
    } catch (error) {
      // A view that cannot draw must not leave the host's empty placeholder:
      // say so, and keep the way back to the picker that /amoji also resets.
      const { Box } = $.ui.resolve(e);
      const Button = controls($, e, s);
      return Box({ flexDirection: "column", gap: 1, children: [
        Text({ children: [L(s, "这一页暂时无法显示。", "This page cannot be shown right now.")], color: "error" }),
        Text({ children: [String(error?.message || error).slice(0, 200)], dimColor: true, wrap: "wrap" }),
        Button({ key: "render-recover", label: L(s, "‹ 返回表情", "‹ Back to expressions"), onPress: () => perform($, s, async () => {
          s.marketRelease = null; await navigate($, s, "picker");
        }) }),
      ] });
    }
  });
  on("ui.message", async ($, e, next) => {
    if (e.surface === "desktop" && e.module === "hooks/control-input.js" &&
        (e.component === "AbovePrompt" || (e.component === "Pane" && e.requestId === "amoji"))) {
      const s = await state($);
      const action = s.controls?.[e.component]?.get(e.element);
      if (action && e.data?.action === "press" && !s.busy && !s.viewAgentId) await action();
      return {};
    }
    if (e.surface === "desktop" && e.component === "AbovePrompt" && e.module === "hooks/picture-input.js") {
      const s = await state($);
      const item = s.bandTargets?.get(e.element);
      // As in the pane, only a target this band drew decides what is sent.
      if (e.data?.action === "send" && item && !s.busy && !s.viewAgentId && !s.delivery) await send($, s, item.expression);
      return {};
    }
    if (e.surface !== "desktop" || e.component !== "Pane" ||
        e.requestId !== "amoji" || e.module !== "hooks/picture-input.js")
      return next(e);
    const s = await state($);
    const item = s.pictureTargets?.get(e.element);
    if (e.data?.action !== "send" || !item || s.busy || s.pictureClosed || s.viewAgentId ||
        (s.tab !== "picker" && s.tab !== "library") || s.detail || s.transfer ||
        s.pictureCollection !== s.collection) return {};
    // Only the current rendered target decides the expression. Client data
    // cannot replace its identity, semantics, or destination conversation.
    if (s.tab === "picker") await send($, s, item.expression);
    else await perform($, s, async () => {
      if (s.selecting) {
        const id = item.expression.asset_id;
        if (s.selected[id]) delete s.selected[id];
        else s.selected[id] = refOf(item.expression);
      } else { s.detail = item; s.revisions = null; }
    });
    return {};
  });
  on("ui.fault", async ($, e, next) => {
    if (e.surface === "desktop" && e.module === "hooks/control-input.js") {
      const s = await state($);
      if (!s.controls?.[e.component]?.has(e.element)) return next(e);
      s.controlFault = true;
      s.controls = {};
      invalidate($);
    }
    if (e.surface === "desktop" && e.component === "AbovePrompt" && e.module === "hooks/picture-input.js") {
      const s = await state($);
      if (!s.bandTargets?.has(e.element)) return next(e);
      s.bandFault = true;
      s.bandTargets.clear();
      invalidate($);
    }
    if (e.surface === "desktop" && e.component === "Pane" &&
        e.requestId === "amoji" && e.module === "hooks/picture-input.js") {
      const s = await state($);
      if (!s.pictureTargets?.has(e.element)) return next(e);
      s.pictureFault = true;
      s.pictureTargets?.clear();
      invalidate($);
    }
    return next(e);
  });
  for (const component of ["UserMessage", "AssistantMessage"])
    on("ui.render", { component }, async ($, e, next) => {
      if (
        (e.surface !== "desktop" && e.surface !== "terminal") ||
        !e.props.text.includes("[[amoji:")
      )
        return next(e);
      const s = await state($);
      const direction =
        component === "UserMessage" ? "human_to_ai" : "ai_to_human";
      const key = direction + ":" + uiLocale(s) + ":" + e.props.text;
      let segments;
      try {
        segments = await messageSegments(s, key, () => call($, s.context, "render", {
          direction, text: e.props.text, locale: uiLocale(s),
        }));
      } catch { return next(e); }
      if (!segments.some(segment => segment.kind === "expression")) return next(e);
      return messageView($, e, s, segments, component === "UserMessage");
    });
  for (const name of ["express", "search", "resolve"])
    on("tool.call", { tool: "mcp__amoji__" + name }, async ($, e) => {
      const s = await state($);
      const turn = turns.get(s.context.sessionId);
      if (e.agentId || !turn)
        return {
          deny: "Amoji requires the active main-conversation turn. Use plain text.",
        };
      try {
        const definition = (await toolDefinitions($)).find(tool => tool.name === name);
        const input = Object.fromEntries(Object.keys(definition?.inputSchema.properties ?? {}).filter(key => e[key] !== undefined).map(key => [key, e[key]]));
        const result = await call($, { ...s.context, ...turn }, "tool", { name, input, locale: uiLocale(s) });
        if (name === "express") void loadCards($, s);
        return { result: JSON.stringify(result) };
      } catch (error) {
        return { deny: errorText(s, error) };
      }
    });
}
