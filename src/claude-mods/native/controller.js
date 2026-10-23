import { loadGuidance } from './guidance.js';
import { refreshMarket, refreshPublisher } from './market.js';
import { bridge, refOf, L, errorText, uiLocale, view } from "./transport.js";
import { rememberMessage } from "./message-view.js";
import { galleryWindow, WINDOW_LIMIT, BUFFER_LIMIT } from "./gallery.js";
import { supportsRichText } from "./ui-kit.js";
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
      category: "all",
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
  const current = sessions.get(id);
  current.languageRead ??= $.settings.read().then(async settings => {
    current.language = await languageOf($, settings);
  }).catch(() => {});
  current.richRead ??= Promise.resolve().then(() => $.session.version()).then(info => {
    current.rich = supportsRichText(info?.version);
  }).catch(() => { current.rich = false; });
  await Promise.all([current.languageRead, current.richRead]);
  return current;
}
// Claude Code's `language` setting decides when present. Without it, the
// system's languages do: the locale variables, then macOS's preferred list.
// Desktop's own interface language is not visible to Mods.
const pickLanguage = value => /^(zh|chinese|中文)/i.test(value) ? "zh" : /^(en|english)/i.test(value) ? "en" : null;
let systemLanguage;
export async function languageOf($, settings) {
  const chosen = String(settings?.language || "").trim();
  if (chosen) return /^(en\b|english)/i.test(chosen) ? "en" : "zh";
  systemLanguage ??= (async () => {
    // Mods lists the variables a module reads, so each name is a literal.
    const locales = await Promise.all([$.env.get("LC_ALL"), $.env.get("LC_MESSAGES"), $.env.get("LANG")]
      .map(read => read.catch(() => "")));
    for (const value of locales) {
      const found = pickLanguage(String(value || ""));
      if (found) return found;
    }
    try {
      const result = await $.process.run(["defaults", "read", "-g", "AppleLanguages"], { timeoutMs: 3000 });
      const first = /[("\s]*"?([A-Za-z-]+)/.exec(String(result.stdout || "").replace(/^\(/, ""))?.[1] || "";
      return result.exitCode === 0 ? pickLanguage(first) || "en" : "zh";
    } catch { return "zh"; }
  })();
  return systemLanguage;
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
  s.language = await languageOf($, settings);
  if (!s.preferences) s.preferences = await bridge($, s.context, "settings");
  if (
    (s.tab === "picker" || s.tab === "library") &&
    !s.collection &&
    !s.detail &&
    !s.transfer
  ) {
    s.galleryBuffer = await bridge($, s.context, "browse", {
      query: s.query,
      category: s.category,
      offset: 0,
      limit: BUFFER_LIMIT,
      library: s.tab === "library",
      archived: s.archived,
    });
    s.collection = { ...s.galleryBuffer, items: s.galleryBuffer.items.slice(0, WINDOW_LIMIT) };
  }
  if (s.tab === "guidance") await loadGuidance($,s,s.guidanceExpression);
  if (s.tab === "market" && !s.marketRows) await refreshMarket($,s);
  if (s.tab === "publish") await refreshPublisher($,s);
  if (s.tab === "create") s.currentModel = await $.session.model();
}
export async function loadGalleryWindow($, s, e) {
  if (!s.collection || s.detail || s.transfer ||
      (s.tab !== "picker" && s.tab !== "library")) return;
  const current = s.collection;
  const range = galleryWindow(e, current.total);
  const offset = current.offset || 0;
  if (offset === range.offset && current.items.length >= Math.min(range.limit, current.total - offset)) return;
  const buffer = s.galleryBuffer;
  const start = range.offset - (buffer?.offset || 0);
  const count = Math.min(range.limit, current.total - range.offset);
  if (buffer && start >= 0 && start + count <= buffer.items.length) {
    s.collection = { ...buffer, offset: range.offset, items: buffer.items.slice(start, start + count) };
    return;
  }
  const signature = `${s.tab}:${s.query}:${s.category}:${s.archived}:${range.offset}:${range.limit}`;
  if (s.windowRequest?.signature === signature) return s.windowRequest.promise;
  const pending = { signature };
  pending.promise = bridge($, s.context, "browse", {
    query: s.query, category: s.category, library: s.tab === "library", archived: s.archived,
    offset: range.offset, limit: BUFFER_LIMIT,
  }).then(collection => {
    if (s.windowRequest === pending && s.collection === current) {
      s.galleryBuffer = collection;
      s.collection = { ...collection, items: collection.items.slice(0, range.limit) };
    }
  }).finally(() => { if (s.windowRequest === pending) s.windowRequest = null; });
  s.windowRequest = pending;
  await pending.promise;
}
export async function navigate($, s, tab) {
  s.suggestionAbort?.abort();
  s.editEpoch++;
  if (s.tab === "picker" && tab !== "picker") s.pickerSearch = { query: s.query, category: s.category };
  s.tab = tab;
  s.detail = null;
  s.transfer = null;
  s.drafts = null;
  s.collection = null;
  s.query = tab === "picker" ? s.pickerSearch?.query || "" : "";
  s.category = tab === "picker" ? s.pickerSearch?.category || "all" : "all";
  s.page = 0;
  s.error = "";
  s.notice = "";
  await load($, s);
  // Navigation is called inside perform(), which redraws on completion.
  // A second invalidation would unnecessarily replace Desktop button handles.
}
export async function open($) {
  const s = await state($);
  s.error = "";
  s.tab = "picker";
  s.detail = null;
  s.transfer = null;
  s.pictureFault = false;
  s.controlFault = false;
  s.pictureClosed = false;
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
export async function send($, s, expression, epoch, action) {
  if (s.viewAgentId || (epoch !== undefined && epoch !== s.pictureEpoch)) return;
  await perform($, s, async () => {
    const delivery = { name: view(s, expression).name, phase: "preparing" };
    s.delivery = delivery;
    invalidate($);
    try {
      const requestId = `${s.context.sessionId}:${await $.clock.now()}:${++sequence}`;
      const prepared = await bridge($, s.context, "receive", {
        ref: refOf(expression),
        requestId,
        locale: uiLocale(s),
        ...(s.note?.trim() ? { note: s.note.trim() } : {}),
      });
      s.note = "";
      if (prepared.segments)
        rememberMessage(s, "human_to_ai:" + uiLocale(s) + ":" + prepared.text, prepared.segments);
      delivery.text = prepared.text;
      if(action)delivery.guidance={ref:refOf(expression),selection:action};
      delivery.phase = "submitting";
      let result;
      try {
        result = await $.prompt.submit({ text: prepared.text, asUser: true });
      } catch {
        throw new Error("SUBMIT_UNKNOWN");
      }
      if (result?.drop !== undefined) throw new Error("SUBMIT_DROPPED");
      if (result?.text !== prepared.text) throw new Error("SUBMIT_UNKNOWN");
      delivery.phase = "waiting";
      s.recent = [expression.asset_id, ...(s.recent || []).filter(id => id !== expression.asset_id)].slice(0, 6);
      // Keep the native pane open: Desktop's expanded layout does not expose
      // a reliable collapse API. Programmatic close can strand an empty tile.
    } catch (error) {
      delivery.phase = "error";
      delivery.error = errorText(s, error);
      throw error;
    } finally {
      // Keep the picker in place. Rotate identities after each attempt so
      // stale callbacks expire and local sending feedback resets on failures.
      s.pictureEpoch = (s.pictureEpoch || 0) + 1;
      s.pictureTargets?.clear();
    }
  });
}
/** Edits one amoji.preferences field (RFC §11.6); `change` returns the next preferences object. */
export async function changePreference($, s, change) {
  await perform($, s, async () => {
    const { version, ...current } = s.preferences;
    const next = change(current);
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    s.preferences = await bridge($, s.context, "updateSettings", { version, preferences: next });
    s.bandItems = null;
    s.collection = null;
    s.notice = s.tab === "picker" ? "" : L(s, "已保存", "Saved");
  });
}
export function edit(s, change) {
  s.editEpoch++;
  s.dirty = true;
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
  s.dirty = false;
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
  const fresh = await bridge($, s.context, "createDraft", { locale: uiLocale(s) });
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
export async function revise($, s, item) {
  const start = async () => {
    const draft = await bridge($, s.context, "startRevisionDraft", { ref: refOf(item.expression), version: item.version });
    s.draft = draft;
    s.step = "idea"; s.intent = ""; s.manual = false; s.dirty = false;
    s.suggestion = null; s.preview = null; s.imagePath = ""; s.copyImageHash = null;
    s.draftConflict = false; s.conflictLatest = null; s.reviewed = false;
    await navigate($, s, "create");
  };
  if (s.dirty && s.draft) {
    s.draftSwitch = start;
    await navigate($, s, "create");
  } else await start();
}
export async function newDraft($, s) {
  s.draft = await bridge($, s.context, "createDraft", { locale: uiLocale(s) });
  s.step = "idea";
  s.intent = "";
  s.suggestion = null;
  s.preview = null;
  s.imagePath = "";
  s.copyImageHash = null;
  s.dirty = false;
  s.manual = false;
  s.drafts = null;
  s.reviewed = false;
  s.draftConflict = false;
  s.conflictLatest = null;
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
      intent: s.intent, locale: s.draft.fields.original_locale,
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
      text: reply.text, locale: s.draft.fields.original_locale,
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
