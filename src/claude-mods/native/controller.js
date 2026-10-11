import { bridge, refOf, L, errorText } from "./transport.js";
const sessions = new Map();
let sequence = 0;
export async function state($) {
  const id = await $.session.id();
  if (!sessions.has(id))
    sessions.set(id, {
      context: { host: "claude-code", hostInstanceId: "mods", sessionId: id },
      language: "zh",
      tab: "picker",
      query: "",
      page: 0,
      archived: false,
      busy: false,
      error: "",
      notice: "",
      selected: {},
      editEpoch: 0,
      step: "idea",
      intent: "",
      model: "current",
      currentModel: "",
      imagePath: "",
      path: "",
      reviewed: false,
      advanced: false,
    });
  return sessions.get(id);
}
export function invalidate($) {
  $.ui.invalidate("ui.render");
}
export async function perform($, s, action) {
  if (s.busy) return;
  s.busy = true;
  s.error = "";
  s.notice = "";
  invalidate($);
  try {
    await action();
  } catch (error) {
    if (
      /^DRAFT_(CONFLICT|CONFIRMED)$/.test(String(error?.message)) &&
      s.tab === "create" && s.draft
    ) {
      s.draftConflict = true;
      s.conflictLatest = null;
      s.reviewed = false;
      s.preview = null;
    }
    s.error = errorText(s, error);
  } finally {
    s.busy = false;
    invalidate($);
  }
}
export async function load($, s) {
  const settings = await $.settings.read();
  const lang = String(settings.language || "");
  s.language = /^(en\b|english)/i.test(lang) ? "en" : "zh";
  if (!s.preferences) s.preferences = await bridge($, s.context, "settings");
  if (
    (s.tab === "picker" || s.tab === "library") &&
    !s.collection &&
    !s.detail &&
    !s.transfer
  )
    s.collection = await bridge($, s.context, "browse", {
      query: s.query,
      page: s.page,
      library: s.tab === "library",
      archived: s.archived,
    });
  if (s.tab === "create" && !s.draft) {
    s.draft = await bridge($, s.context, "createDraft");
    s.currentModel = await $.session.model();
  }
  if (s.tab === "create") s.currentModel = await $.session.model();
}
export async function navigate($, s, tab) {
  s.suggestionAbort?.abort();
  s.editEpoch++;
  s.tab = tab;
  s.detail = null;
  s.transfer = null;
  s.drafts = null;
  s.collection = null;
  s.query = "";
  s.page = 0;
  s.error = "";
  s.notice = "";
  await load($, s);
  invalidate($);
}
export async function open($) {
  const s = await state($);
  s.error = "";
  s.collection = null;
  s.preferences = null;
  try {
    await load($, s);
  } catch (error) {
    s.error = errorText(s, error);
  }
  await $.ui.open({
    id: "amoji",
    title: "Amoji",
    focus: true,
    closeOnEscape: true,
    columns: 52,
  });
  invalidate($);
}
export async function send($, s, expression) {
  await perform($, s, async () => {
    const requestId = `${s.context.sessionId}:${await $.clock.now()}:${++sequence}`;
    const prepared = await bridge($, s.context, "receive", {
      ref: refOf(expression),
      requestId,
    });
    let result;
    try {
      result = await $.prompt.submit({ text: prepared.text, asUser: true });
    } catch {
      throw new Error("SUBMIT_UNKNOWN");
    }
    if (result?.drop !== undefined) throw new Error("SUBMIT_DROPPED");
    if (result?.text !== prepared.text) throw new Error("SUBMIT_UNKNOWN");
    await $.ui.close({ id: "amoji" });
  });
}
export async function changePreference($, s, key, value) {
  await perform($, s, async () => {
    const { style, frequency, paused, appearance, version } = s.preferences;
    s.preferences = await bridge($, s.context, "updateSettings", {
      version,
      preferences: { style, frequency, paused, appearance, [key]: value },
    });
    s.collection = null;
    s.notice = L(s, "已保存", "Saved");
  });
}
export function edit(s, change) {
  s.editEpoch++;
  s.suggestionAbort?.abort();
  s.reviewed = false;
  s.preview = null;
  change();
}
export async function save($, s, preview = false) {
  const fields = JSON.parse(JSON.stringify(s.draft.fields));
  const id = s.draft.draft_id;
  const version = s.draft.version;
  s.draft = await bridge($, s.context, "saveDraft", {
    id,
    version,
    fields,
    ...(s.imagePath.trim() ? { imagePath: s.imagePath.trim() } : {}),
    ...(!s.imagePath.trim() && s.copyImageHash
      ? { imageHash: s.copyImageHash }
      : {}),
  });
  s.imagePath = "";
  s.copyImageHash = null;
  if (preview) {
    s.preview = await bridge($, s.context, "previewDraft", {
      id: s.draft.draft_id,
      version: s.draft.version,
    });
    s.reviewed = false;
    s.step = "review";
  } else s.notice = L(s, "草稿已保存", "Draft saved");
}
export async function forkLocalDraft($, s) {
  const fields = JSON.parse(JSON.stringify(s.draft.fields));
  const imageHash = s.copyImageHash || s.draft.visual?.primary.sha256;
  const fresh = await bridge($, s.context, "createDraft");
  // Keep the new identity immediately: a later save failure must retry this draft,
  // never overwrite the conflicting original or silently create another copy.
  s.draft = { ...fresh, fields };
  s.copyImageHash = imageHash;
  s.draftConflict = false;
  s.conflictLatest = null;
  s.step = "edit";
  s.preview = null;
  s.reviewed = false;
  await save($, s);
  s.notice = L(
    s,
    "已另存为新草稿，原草稿未修改",
    "Saved as a new draft; the original is unchanged",
  );
}
export async function suggest($, s) {
  if (s.generating || s.busy) return;
  s.generating = true;
  s.error = "";
  s.suggestion = null;
  const epoch = ++s.editEpoch;
  const draftId = s.draft.draft_id;
  const controller = new AbortController();
  s.suggestionAbort = controller;
  invalidate($);
  try {
    const request = await bridge($, s.context, "suggestionRequest", {
      intent: s.intent,
    });
    if (controller.signal.aborted) return;
    const model =
      s.model === "current"
        ? await $.session.model()
        : s.model === "custom"
          ? (s.customModel || "").trim()
          : s.model;
    if (!model) throw new Error("SUGGESTION_MODEL_REQUIRED");
    const reply = await $.model.complete(
      { ...request, model, effort: "low" },
      { signal: controller.signal },
    );
    if (
      controller.signal.aborted ||
      s.editEpoch !== epoch ||
      s.draft.draft_id !== draftId
    )
      return;
    if (!reply.isAnswered) throw new Error("SUGGESTION_FAILED");
    const fields = await bridge($, s.context, "parseSuggestion", {
      text: reply.text,
    });
    if (
      !controller.signal.aborted &&
      s.editEpoch === epoch &&
      s.draft.draft_id === draftId
    )
      s.suggestion = fields;
  } catch (error) {
    if (!controller.signal.aborted && s.editEpoch === epoch)
      s.error = errorText(s, error);
  } finally {
    if (s.suggestionAbort === controller) {
      s.generating = false;
      s.suggestionAbort = null;
    }
    invalidate($);
  }
}
export { bridge as call };
