import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const tool = resolve(root, 'plugins/amoji-studio/skills/amoji-pack/scripts/amoji_pack.py');
// CI sets AMOJI_PYTHON to an interpreter with Pillow; locally fall back to python3 when it has Pillow.
const python = process.env.AMOJI_PYTHON ?? 'python3';
const hasPillow = spawnSync(python, ['-c', 'import PIL'], { encoding: 'utf8' }).status === 0;
const pillowSkip = !hasPillow && !process.env.AMOJI_PYTHON ? 'Python with Pillow is not available' : false;

const run = (args: string[], cwd: string) => spawnSync(python, [tool, ...args], { cwd, encoding: 'utf8' });

test('act registry copies match Appendix A of the RFC', () => {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/build-act-registry.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('registry keeps the protocol invariants', async () => {
  const registry = JSON.parse(await readFile(resolve(root, 'docs/specs/amoji-0.1.registry.json'), 'utf8'));
  const acts: Array<{ act: string; authority: string; forms: Record<string, { gloss: Record<string, string> }> }> = registry.acts;
  assert.equal(registry.revision, '0.1-r3');
  assert.equal(acts.length, 33);
  assert.ok(!acts.some(a => /approve|allow|yes/.test(a.act)), 'no approval act exists');
  assert.deepEqual(acts.filter(a => a.authority === 'reduce').map(a => a.act).sort(), ['core:hold', 'core:stop']);
  for (const a of acts) for (const [direction, form] of Object.entries(a.forms)) {
    assert.ok(form.gloss['zh-CN'] && form.gloss.en, `${a.act} ${direction} needs zh-CN and en glosses`);
  }
});

test('skill builds a deterministic, valid pack and rejects protocol violations', { skip: pillowSkip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'amoji-pack-'));
  try {
    assert.equal(run(['init', 'pack', '--slug', 'test-cat', '--creator', 'Tests'], dir).status, 0);
    const art = spawnSync(python, ['-c', `
from PIL import Image, ImageDraw
for name, color in (("thanks", (240, 180, 60, 255)), ("lost", (80, 140, 240, 255))):
    im = Image.new("RGBA", (640, 480), (0, 0, 0, 0))
    ImageDraw.Draw(im).ellipse((120, 40, 520, 440), fill=color)
    im.save(f"pack/images/{name}.png")
`], { cwd: dir, encoding: 'utf8' });
    assert.equal(art.status, 0, art.stderr);
    const source = JSON.parse(await readFile(join(dir, 'pack/pack.json'), 'utf8'));
    const machine = { from: 'zh-CN', method: 'machine' };
    Object.assign(source, {
      name: { 'zh-CN': '测试猫', en: 'Test Cat' },
      description: { 'zh-CN': '测试用表情包', en: 'A pack for tests' },
      expressions: [
        { slug: 'thanks', realizes: 'core:thanks', intensity: 2, image: 'images/thanks.png', text_locale: null,
          name: { 'zh-CN': '谢谢', en: 'Thanks' },
          semantics: { 'zh-CN': { meaning: '谢谢你刚才的帮助。', fallback: '[谢谢]' },
            en: { meaning: 'Thanks for the help just now.', fallback: '[thanks]', translation: machine } } },
        { slug: 'lost-me', realizes: 'core:clarify', intensity: 2, directions: ['h2a'], image: 'images/lost.png', text_locale: null,
          name: { 'zh-CN': '没看懂', en: 'Lost me' }, tags: { 'zh-CN': ['困惑'], en: ['confused'] },
          semantics: { 'zh-CN': { meaning: '我没看懂，请换一种更简单的说法。', fallback: '[没看懂]', avoid_when: ['对方正在道歉时'] },
            en: { meaning: "I didn't follow; please say it more simply.", fallback: '[lost me]', translation: machine } } },
      ],
    });
    await writeFile(join(dir, 'pack/pack.json'), JSON.stringify(source));

    const first = run(['build', 'pack', '-o', 'out/a.amoji'], dir);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(run(['build', 'pack', '-o', 'out/b.amoji'], dir).status, 0);
    assert.deepEqual(await readFile(join(dir, 'out/a.amoji')), await readFile(join(dir, 'out/b.amoji')));
    const checked = run(['check', 'out/a.amoji'], dir);
    assert.equal(checked.status, 0, checked.stderr);
    const summary = JSON.parse(checked.stdout);
    assert.deepEqual(summary.acts, ['core:clarify', 'core:thanks']);
    assert.deepEqual(summary.locales, ['zh-CN', 'en']);

    const manifest = JSON.parse(await readFile(join(dir, 'out/a.manifest.json'), 'utf8'));
    assert.equal(manifest.amoji, '0.1');
    assert.equal(manifest.pack_id, source.pack_id);
    assert.equal(manifest.expressions[1].visual.primary.width, 512);
    assert.equal(manifest.expressions[1].visual.text_locale, null);
    assert.ok(!('authority' in manifest.expressions[0]));

    const bad = structuredClone(source);
    bad.expressions[0].authority = 'reduce';
    bad.expressions[0].realizes = 'core:approve';
    delete bad.expressions[1].semantics.en.translation;
    bad.expressions[1].directions = ['h2a', 'h2a'];
    await writeFile(join(dir, 'pack/pack.json'), JSON.stringify(bad));
    const rejected = run(['build', 'pack', '-o', 'out/bad.amoji'], dir);
    assert.equal(rejected.status, 1);
    for (const expected of ["'authority' is defined only by the act registry", "'core:approve' is not a core act",
      "must declare 'translation'", 'directions: must be a non-empty unique subset']) {
      assert.ok(rejected.stderr.includes(expected), `expected "${expected}" in:\n${rejected.stderr}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
