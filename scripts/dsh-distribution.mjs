import { readFile, writeFile, readdir, mkdir, cp, stat, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'adapters/dsh');
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(out, 'package.json'), 'utf8'));
const meta = JSON.parse(await readFile(join(root, '.cache/dsh-client-metafile.json'), 'utf8'));
const records = new Map();
const missingOptional = [];
async function packageRoot(name, from) {
  // Package exports may hide package.json; Node resolution plus ascent keeps the actual resolved copy.
  const req = createRequire(join(from, 'package.json'));
  for (const exportName of ['package.json', 'package']) {
    try { return dirname(req.resolve(`${name}/${exportName}`)); } catch {}
  }
  let file;
  try { file = req.resolve(name); } catch { return undefined; }
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    try { if (JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).name === name) return dir; } catch {}
  }
}
async function visit(name, from, kind, optional = false) {
  const dir = await packageRoot(name, from);
  if (!dir) { if (optional) { missingOptional.push(name); return; } throw new Error(`Missing actual dependency ${name}`); }
  const p = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const key = `${p.name}@${p.version}`;
  if (records.has(key)) { records.get(key).kinds.add(kind); return; }
  const record = { name: p.name, version: p.version, license: p.license ?? null, kinds: new Set([kind]), dir, licenses: [], integrity: lock.packages[relative(root, dir)]?.integrity ?? null };
  if (!record.license) throw new Error(`Missing license declaration ${key}`);
  records.set(key, record);
  for (const child of Object.keys(p.dependencies ?? {})) await visit(child, dir, 'installed-runtime');
  for (const child of Object.keys(p.optionalDependencies ?? {})) await visit(child, dir, 'installed-optional', true);
}
for (const name of Object.keys(manifest.dependencies)) await visit(name, root, 'installed-runtime');
for (const input of Object.keys(meta.inputs)) {
  const parts = input.split('node_modules/'); if (parts.length === 1) continue;
  const tail = parts.at(-1).split('/'); const name = tail[0].startsWith('@') ? tail.slice(0, 2).join('/') : tail[0];
  await visit(name, root, 'client-bundled');
}
const licenseDir = join(out, 'THIRD_PARTY_LICENSES');
await rm(licenseDir, { recursive: true, force: true }); await mkdir(licenseDir, { recursive: true });
const result = [];
for (const record of [...records.values()].sort((a,b) => a.name.localeCompare(b.name))) {
  const target = join(licenseDir, `${record.name.replaceAll('/', '__')}@${record.version}`); await mkdir(target, { recursive: true });
  for (const name of await readdir(record.dir)) {
    if (!/^(LICEN[CS]E|COPYING|NOTICE)/i.test(name) || !(await stat(join(record.dir, name))).isFile()) continue;
    await cp(join(record.dir, name), join(target, name)); record.licenses.push(relative(out, join(target, name)));
  }
  if (record.name.includes('sharp-libvips')) {
    for (const name of ['README.md','versions.json']) await cp(join(record.dir, name), join(target, name));
    record.licenses.push(relative(out, join(target, 'README.md')));
    record.nativeComponents = JSON.parse(await readFile(join(record.dir, 'versions.json'), 'utf8'));
  }
  if (!record.licenses.length) throw new Error(`No license evidence in actual package ${record.name}`);
  const {dir, kinds, ...publicRecord} = record;
  result.push({...publicRecord,kinds:[...kinds]});
}
await cp(join(root, 'LICENSE'), join(out, 'LICENSE')); await cp(join(root, 'NOTICE'), join(out, 'NOTICE'));
await writeFile(join(out, 'THIRD_PARTY.json'), JSON.stringify({ platform:process.platform, arch:process.arch, node:process.version, clientSha256:createHash('sha256').update(await readFile(join(out,'client.js'))).digest('hex'), bundledInputs:Object.keys(meta.inputs).filter(path=>path.includes('node_modules/')), externalClient: ['react'], runtimeDependenciesEmbedded:false, packages:result, unavailableOptional:[...new Set(missingOptional)].sort() },null,2)+'\n');
console.log(`Distribution licenses: ${result.length} actual packages; node_modules excluded from tarball`);
