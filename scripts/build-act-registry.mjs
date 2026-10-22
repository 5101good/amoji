// Generate the machine-readable act registry from Appendix A of the 0.1 RFC.
// Writes the spec copy and the pack-skill copy; --check fails on drift instead.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const rfc = resolve(root, 'docs/specs/amoji-0.1-rfc.md');
const targets = [
  resolve(root, 'docs/specs/amoji-0.1.registry.json'),
  resolve(root, 'plugins/amoji-studio/skills/amoji-pack/references/registry.json'),
];

function parseRegistry(markdown) {
  const appendix = markdown.split(/^## 附录 A/m)[1]?.split(/^## 附录 B/m)[0];
  if (!appendix) throw new Error('Appendix A not found');
  const acts = [];
  let family;
  for (const line of appendix.split('\n')) {
    const heading = /^### A\.\d+ \S+ ([a-z]+)（\d+）$/.exec(line);
    if (heading) { family = heading[1]; continue; }
    if (!line.startsWith('| `core:')) continue;
    if (!family) throw new Error(`Act row outside a family section: ${line}`);
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (cells.length !== 6) continue; // design-note tables in A.6 have fewer columns
    const [actCell, direction, expectsCell, flags, h2aGloss, a2hGloss] = cells;
    const act = actCell.replaceAll('`', '');
    const directions = direction === '↔' ? ['h2a', 'a2h'] : [direction];
    if (!directions.every(d => d === 'h2a' || d === 'a2h')) throw new Error(`Bad direction for ${act}`);
    const expects = expectsCell.split('/').map(value => value.trim());
    const forms = {};
    directions.forEach((dir, index) => {
      const gloss = dir === 'h2a' ? h2aGloss : a2hGloss;
      const slash = gloss.indexOf('/');
      if (slash < 0) throw new Error(`Missing ${dir} gloss for ${act}`);
      forms[dir] = {
        expects: expects[Math.min(index, expects.length - 1)],
        gloss: { 'zh-CN': gloss.slice(0, slash).trim(), en: gloss.slice(slash + 1).trim() },
      };
    });
    acts.push({
      act, family, status: 'provisional',
      authority: flags.includes('R') ? 'reduce' : 'none',
      forms,
      grounded: flags.includes('G'),
      pressure_sensitive: flags.includes('P'),
    });
  }
  if (new Set(acts.map(a => a.act)).size !== acts.length) throw new Error('Duplicate act in Appendix A');
  const revision = /^注册表修订：(\S+)$/m.exec(appendix)?.[1];
  if (!revision) throw new Error('Registry revision line not found in Appendix A');
  return { kind: 'amoji.registry', amoji: '0.1', revision, status: 'provisional', acts };
}

const registry = `${JSON.stringify(parseRegistry(await readFile(rfc, 'utf8')), null, 2)}\n`;
let stale = false;
for (const target of targets) {
  const current = await readFile(target, 'utf8').catch(() => '');
  if (current === registry) continue;
  if (process.argv.includes('--check')) { console.error(`Out of date: ${target}`); stale = true; }
  else await writeFile(target, registry);
}
if (stale) { console.error('Run: node scripts/build-act-registry.mjs'); process.exitCode = 1; }
