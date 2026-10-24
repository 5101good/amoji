import type { AdapterRuntime } from '../adapter-runtime.js';
import { draftVersion, type DraftFields } from '../drafts.js';
import { expressionRef } from '../library-management.js';
import type { Pack, Preferences, Visual } from '../protocol/index.js';
import { fail, nonempty, object } from '../shared-contract.js';
import { PACK_LIMITS } from '../packs.js';
import type { HostPort } from './contracts.js';
const schemas: Record<string, string[]> = {
  createPackDraft:['refs','name'],listPackDrafts:[],getPackDraft:['draft_id'],savePackDraft:['draft_id','version','manifest'],previewPackDraft:['draft_id','version'],confirmPackDraft:['draft_id','version'],listPacks:[],getPack:['release_id'],removePack:['release_id'],
  listEntries: [], listDrafts: [], createDraft: ['locale'], getSettings: [], listRevisions: ['asset_id'],
  startRevisionDraft: ['ref', 'version'], selectRevision: ['ref', 'version'], setArchived: ['asset_id', 'version', 'archived'],
  updateSettings: ['version', 'preferences'], getDraft: ['draft_id'], saveDraft: ['draft_id', 'version', 'fields', 'upload'],
  previewDraft: ['draft_id', 'version'], confirmDraft: ['draft_id', 'version'], suggestText: ['intent', 'notes'], revisionVisual: ['ref'],
};
export function failure(error: unknown) { const e = error as { code?: string; message?: string; current?: unknown }; return { code: e?.code ?? 'amoji/failed', message: e?.message ?? '操作失败', details: e?.current === undefined ? {} : { current: e.current } }; }
export async function management(runtime: AdapterRuntime, method: string, raw: unknown): Promise<unknown> {
  const keys = schemas[method]; if (!keys) fail('INVALID_ARGUMENT', '未知管理操作');
  const args = object(raw, keys, keys.filter(key => !['upload', 'notes', 'locale', 'name'].includes(key)));
  const m = runtime.management; const c = runtime.creation;
  if (!m || !c) fail('CAPABILITY_UNAVAILABLE', '共享服务尚不支持管理');
  const version = () => draftVersion(args.version); const id = () => nonempty(args.draft_id);
  const packs = () => runtime.packDrafts ?? fail('CAPABILITY_UNAVAILABLE', '表情包能力不可用');
  const visual = async (value: { visual?: Omit<Visual, 'text_locale'> }) => {
    if (!value.visual || !runtime.readBlob) fail('MEDIA_REQUIRED', '请先上传图片');
    const data = async (blob: {sha256: string; mime: string}) => `data:${blob.mime};base64,${(await runtime.readBlob!(blob.sha256)).toString('base64')}`;
    return { primary: await data(value.visual.primary), poster: value.visual.poster ? await data(value.visual.poster) : null };
  };
  switch (method) {
    case 'createPackDraft': { const p = packs(); if (!Array.isArray(args.refs)) fail('INVALID_ARGUMENT', '需要版本列表'); return p.createPackDraft(args.refs.map(expressionRef), args.name === undefined ? undefined : nonempty(args.name)); }
    case 'listPackDrafts': return packs().listPackDrafts();
    case 'listPacks': return packs().listPacks();
    case 'getPackDraft': return packs().getPackDraft(id());
    case 'getPack': return packs().getPack(nonempty(args.release_id));
    case 'removePack': return packs().removePack(nonempty(args.release_id));
    case 'savePackDraft': return packs().savePackDraft(id(), version(), args.manifest as Pack);
    case 'previewPackDraft': return packs().previewPackDraft(id(), version());
    case 'confirmPackDraft': return packs().confirmPackDraft(id(), version());
    case 'listEntries': return m.listEntries();
    case 'listRevisions': return m.listRevisions(nonempty(args.asset_id));
    case 'getSettings': return m.getSettings();
    case 'updateSettings': return m.updateSettings(version(), args.preferences as Preferences);
    case 'setArchived': return m.setArchived(nonempty(args.asset_id), version(), args.archived as boolean);
    case 'startRevisionDraft': return m.startRevisionDraft(expressionRef(args.ref), version());
    case 'selectRevision': if (!runtime.packs) fail('CAPABILITY_UNAVAILABLE', '缺少完整包能力'); return runtime.packs.selectRevision(expressionRef(args.ref), version());
    case 'createDraft': return c.createDraft(args.locale === undefined ? undefined : nonempty(args.locale));
    case 'listDrafts': return c.listDrafts();
    case 'getDraft': return c.getDraft(id());
    case 'saveDraft': return c.saveDraft(id(), version(), args.fields as DraftFields, args.upload as string | undefined);
    case 'previewDraft': { const draft = await c.previewDraft(id(), version()); return { draft, ...await visual(draft) }; }
    case 'confirmDraft': return c.confirmDraft(id(), version());
    case 'suggestText': if (!runtime.suggestions) fail('CAPABILITY_UNAVAILABLE', '文字建议不可用'); return runtime.suggestions.suggestText(args.intent as string, args.notes as string | undefined);
    case 'revisionVisual': { const ref = expressionRef(args.ref); if (!(await m.listRevisions(ref.asset_id)).some(e => e.revision_id === ref.revision_id)) fail('REVISION_NOT_FOUND', '库中没有此版本'); const expression = await runtime.catalog.resolve(ref); return { expression, ...await visual(expression) }; }
  }
}
export async function readBounded(request: Request, limit: number): Promise<Uint8Array> {
  if (!request.body) fail('INVALID_ARGUMENT', '缺少文件');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { request.signal.throwIfAborted(); const {done, value} = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) fail('PACK_LIMIT_EXCEEDED', '文件超过允许大小'); chunks.push(value); } }
  catch (error) { await reader.cancel(error); throw error; } finally { reader.releaseLock(); }
  return new Uint8Array(Buffer.concat(chunks, size));
}
export function installPackRoutes(ctx: HostPort, runtime: AdapterRuntime, check: (sessionId: string, signal: AbortSignal) => Promise<unknown>): Array<() => Promise<void>> {
  const releases: Array<() => Promise<void>> = [];
  try { for (const action of ['import', 'export', 'release-export']) releases.push(ctx.connection.fetch.register({ path: `/api/amoji/pack-${action}`, methods: ['POST'], requestBody: 'streaming', fetch: async request => {
    try {
      const sessionId = nonempty(new URL(request.url).searchParams.get('sessionId')); await check(sessionId, request.signal);
      if (!runtime.packs) fail('CAPABILITY_UNAVAILABLE', '完整包能力不可用');
      const bytes = await readBounded(request, action === 'import' ? PACK_LIMITS.archive : 128 * 1024);
      if (action === 'import') return Response.json({ result: await runtime.packs.importPack(bytes) });
      if(action==='release-export'){
       if(!runtime.packDrafts)fail('CAPABILITY_UNAVAILABLE','表情包能力不可用');
       const args=object(JSON.parse(new TextDecoder().decode(bytes)),['release_id','without_effects']);if(typeof args.without_effects!=='boolean')fail('INVALID_ARGUMENT','需要明确的导出格式');
       const result=await runtime.packDrafts.exportRelease(nonempty(args.release_id),args.without_effects);
       return new Response(new Uint8Array(result),{headers:{'Content-Type':'application/zip','Content-Length':String(result.length),'Cache-Control':'no-store'}});
      }
      const args = object(JSON.parse(new TextDecoder().decode(bytes)), ['refs', 'name', 'locale'], ['refs', 'name']);
      if (!Array.isArray(args.refs)) fail('INVALID_ARGUMENT', '请选择导出版本');
      const result = await runtime.packs.exportPack(args.refs.map(expressionRef), nonempty(args.name), args.locale === undefined ? undefined : nonempty(args.locale));
      return new Response(new Uint8Array(result), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="expressions.amoji"', 'Content-Length': String(result.length), 'Cache-Control': 'no-store' } });
    } catch (error) { return Response.json({ error: failure(error) }, { status: 400 }); }
  } })); } catch(error) { for(const release of releases) void release(); throw error; }
  return releases;
}
