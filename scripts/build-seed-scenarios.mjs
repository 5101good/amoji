// Repackage reviewed CC0 originals; no image generation or model calls.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { withValidatedPack, exportManifest } from '../dist/src/packs.js';
const root = new URL('../assets/scenario-packs/', import.meta.url);
const created_at = '2026-10-11T00:00:00Z';
const id = text => { const h = createHash('sha256').update(`amoji-seed-v1:${text}`).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`; };
const rights = { license: 'CC0-1.0', creator: 'Amoji contributors', source: 'assets/base-library/provenance.json; assets/scenario-packs/README.md' };
const action = (slug, effect_summary, body) => ({ action_id: id(slug), action_revision_id: id(`${slug}:revision`), locale: 'zh-CN', effect_summary, rights, ...body });
const explain = action('explain', '换一种简单说法 / Explain more simply', { kind: 'instruction', scope: 'turn', conflict_group: 'explanation', instruction: '本回合请用简单语言重新解释当前问题，指出尚需澄清之处；不要假装已经理解未提供的信息。 / For this turn, explain the current problem in plain language and identify what needs clarification. Do not pretend missing information is known.' });
const example = action('example', '先给具体示例 / Give a concrete example first', { kind: 'instruction', scope: 'turn', conflict_group: 'response-organization', instruction: '本回合先给一个与当前问题相关的具体例子，明确它只是示例，再简短解释。 / For this turn, start with a concrete example relevant to the current question, label it as an example, then explain briefly.' });
const evidence = action('evidence', '说明证据与未知 / State evidence and unknowns', { kind: 'instruction', scope: 'turn', conflict_group: 'completion-report', instruction: '本回合区分已经核实的事实、尚未知的事项和可执行的下一步；没有实际验证时明确说未验证，不把计划当完成。 / For this turn, separate verified facts, unknowns and an actionable next step. Explicitly say unverified when no check was performed; a plan is not completion.' });
const answer = action('answer-first', '当前会话先结论后依据 / Answer first in this conversation', { kind: 'hook', scope: 'conversation', conflict_group: 'response-organization', template: 'response-organization@1', config: { layout: 'answer-first' } });
const check = action('completion-check', '当前会话完成时说明依据和未知 / Completion evidence and unknowns in this conversation', { kind: 'hook', scope: 'conversation', conflict_group: 'completion-report', template: 'completion-self-check@1', config: { evidence: 'required', unknowns: 'explicit' } });
const definitions = [
  { slug: 'make-it-clear', name: '把话说明白 / Make it clear', names: ['没看懂', '说具体些', '举个例子', '需要你确认'], scenario: ['澄清', '解释', 'clarification', 'explanation'], actions: [explain, example, answer], bindings: { '没看懂': [explain], '说具体些': [explain], '举个例子': [example] }, examples: ['示例 / Example: 人→AI / Human→AI：「没看懂」表达尚未理解；可选换一种简单说法。 “I do not understand” asks for clarity; simpler explanation is optional.', '示例 / Example: AI→人 / AI→Human：「需要你确认」把具体选择交还给人，不替人批准。 “Please confirm” returns a concrete decision to the person; it does not approve for them.'] },
  { slug: 'work-well-together', name: '一起把事做好 / Work well together', names: ['卡在哪里', '正在核对', '我来处理'], scenario: ['进度', '证据', '交接', 'progress', 'evidence', 'handoff'], actions: [evidence, check], bindings: { '卡在哪里': [evidence] }, examples: ['示例 / Example: 人→AI / Human→AI：「卡在哪里」询问阻碍，可选要求说明证据与未知。 “What is blocking progress?” asks about obstacles; evidence and unknowns are optional guidance.', '示例 / Example: AI→人 / AI→Human：「正在核对」表示检查正在进行，不表示已经验证通过；「我来处理」只接手已授权工作。 “Checking” means work in progress, not a passed check; “I will handle it” covers only authorized work.'] },
  { slug: 'collaborate-comfortably', name: '轻松一点合作 / Collaborate comfortably', names: ['辛苦了', '不客气', '暂时没把握'], scenario: ['感谢', '支持', '不确定', 'thanks', 'support', 'uncertainty'], actions: [], bindings: {}, examples: ['示例 / Example: 人→AI / Human→AI：「辛苦了」认可投入，可以只表达感谢。 “Thanks for the effort” acknowledges effort without requesting an action.', '示例 / Example: AI→人 / AI→Human：「不客气」自然回应感谢；「暂时没把握」坦诚不确定，不替代必要的查证。 “You are welcome” responds to thanks; “Unsure for now” admits uncertainty without replacing needed verification.'] },
];
await mkdir(root, { recursive: true });
await withValidatedPack(await readFile(new URL('../assets/base-library/base.amoji', import.meta.url)), async source => {
  for (const d of definitions) {
    const expressions = ['classic', 'office'].flatMap(style => d.names.map(name => {
      const e = source.manifest.expressions.find(e => e.name === name && e.tags?.includes(`amoji:appearance:${style}`));
      if (!e || e.rights.license !== 'CC0-1.0') throw new Error(`Missing reviewed CC0 expression: ${style}/${name}`);
      return e;
    }));
    const defaults = expressions.map(({ asset_id, revision_id }) => ({ asset_id, revision_id }));
    const manifest = { kind: 'amoji.pack', schema_version: '0.2', pack_id: id(d.slug), release_id: id(`${d.slug}:release:2`), version: 2, name: d.name, created_at, scenario: d.scenario, expressions, defaults, actions: d.actions, bindings: expressions.flatMap(e => d.bindings[e.name] ? [{ expression: { asset_id: e.asset_id, revision_id: e.revision_id }, actions: d.bindings[e.name].map(({ action_id, action_revision_id }) => ({ action_id, action_revision_id })) }] : []), rights, styles: ['classic', 'office'], description: '原始固定语义语言为中文；双语说明不改写语义。动作可选，仅是提示，不保证模型遵从。一次提示用于关联回合，会话规则可随时关闭；关闭不删除历史。新会话不继承规则，AI 发送表情不会启用绑定动作。 / Original fixed semantics are Chinese; bilingual descriptions do not rewrite them. Optional actions are guidance, not enforcement. One-time guidance applies to its linked turn; conversation rules can be disabled without erasing history. New conversations do not inherit rules; AI-sent expressions never activate bindings.', examples: d.examples };
    const full = await exportManifest(manifest, source.readBlob);
    const legacy = await exportManifest({ kind: 'amoji.pack', schema_version: '0.1', pack_id: id(`${d.slug}:expressions`), name: d.name, created_at, expressions, defaults }, source.readBlob);
    for (const bytes of [full, legacy]) await withValidatedPack(bytes, async () => {}, 'market');
    await writeFile(new URL(`${d.slug}.manifest.json`, root), JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(new URL(`${d.slug}.amoji`, root), full);
    await writeFile(new URL(`${d.slug}.expressions.amoji`, root), legacy);
    console.log(`${d.slug}: ${expressions.length} expressions, ${d.actions.length} optional actions, ${full.length}/${legacy.length} bytes (0.2/0.1)`);
  }
});
