import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateReleaseVersion(version, pluginVersion, tag = '') {
  assert.equal(pluginVersion, version, 'Root and plugin versions must match');
  if (tag) {
    assert.match(version, /^\d+\.\d+\.\d+$/, 'Release tags must use a stable version');
    assert.equal(tag, `v${version}`, 'Tag must match the built package version');
  }
}

export function inspectTarball(compressed) {
  const bytes = gunzipSync(compressed);
  const files = new Map();
  const field = (header, start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = field(header, 0, 100);
    const prefix = field(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    assert.ok(path.startsWith('package/'), `Unexpected tar root: ${path}`);
    assert.ok(!path.includes('\\') && !path.split('/').some(part => part === '..' || part === '.'), `Unsafe tar path: ${path}`);
    const type = field(header, 156, 1);
    assert.ok(type === '' || type === '0' || type === '5', `Unsupported tar entry (links are forbidden): ${path}`);
    const size = Number.parseInt(field(header, 124, 12).trim(), 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= bytes.length, `Invalid tar size: ${path}`);
    if (type !== '5') {
      const relative = path.slice('package/'.length);
      assert.ok(!files.has(relative), `Duplicate tar entry: ${path}`);
      files.set(relative, bytes.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(files.size > 0, 'Empty package');
  return files;
}

export function validatePublicFile(path, bytes) {
  assert.ok(!path.split('/').some(part => part.startsWith('.') || ['node_modules', 'tests', 'samples'].includes(part)), `Private or development path: ${path}`);
  assert.ok(!/\.(?:map|sqlite(?:3)?|db|pem|key|node|dylib|so|dll)$/i.test(path), `Unexpected sensitive or native file: ${path}`);
  if (/\.(?:amoji|png|webp|gif|jpg|jpeg|ico|woff2?)$/i.test(path)) return;
  const text = bytes.toString('utf8');
  assert.ok(!/(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)[\w.-]+[\/\\]/i.test(text), `Personal absolute path in ${path}`);
  assert.ok(!/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})/.test(text), `Credential-like content in ${path}`);
}

export async function buildReleaseArtifacts() {
  const plugin = resolve(root, 'adapters/dsh');
  const destination = resolve(root, '.cache/release');
  const project = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(plugin, 'package.json'), 'utf8'));
  validateReleaseVersion(project.version, manifest.version, process.env.RELEASE_TAG);
  assert.equal(manifest.name, '@amoji/dsh');
  assert.equal(manifest.license, 'MIT');
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const [packed] = JSON.parse(execFileSync('npm', ['pack', plugin, '--ignore-scripts', '--json', '--pack-destination', destination], { cwd: root, encoding: 'utf8' }));
  assert.equal(packed.filename, `amoji-dsh-${project.version}.tgz`);
  const files = inspectTarball(await readFile(resolve(destination, packed.filename)));
  assert.deepEqual([...files.keys()].sort(), packed.files.map(file => file.path).sort(), 'Packed manifest must match actual archive');
  for (const [path, bytes] of files) {
    assert.ok(/^(?:index\.mjs|client\.js|package\.json|patch\.yml|BUILD\.json|README(?:\.en)?\.md|LICENSE|NOTICE|THIRD_PARTY\.json)$/.test(path)
      || /^(?:runtime\/|web\/|assets\/base-library\/|THIRD_PARTY_LICENSES\/)/.test(path), `Unexpected packaged path: ${path}`);
    validatePublicFile(path, bytes);
  }
  for (const path of ['index.mjs', 'client.js', 'patch.yml', 'BUILD.json', 'runtime/src/dsh/host.js', 'runtime/src/dsh/ai-suggestions.js', 'assets/base-library/base.amoji', 'assets/base-library/LICENSE', 'assets/base-library/provenance.json']) {
    assert.ok(files.has(path), `Missing required package file: ${path}`);
  }
  for (const path of ['LICENSE', 'NOTICE']) assert.ok(files.get(path)?.equals(await readFile(resolve(root, path))), `Stale ${path}`);
  const thirdParty = JSON.parse(files.get('THIRD_PARTY.json').toString());
  assert.equal(thirdParty.runtimeDependenciesEmbedded, false);
  assert.equal(thirdParty.clientSha256, digest(files.get('client.js')));
  assert.ok(thirdParty.packages.length > 0, 'Missing third-party inventory');
  for (const dependency of thirdParty.packages) {
    assert.ok(dependency.license && dependency.licenses.length, `Missing license: ${dependency.name}`);
    for (const path of dependency.licenses) assert.ok(files.has(path), `Missing license evidence: ${path}`);
  }
  const build = JSON.parse(files.get('BUILD.json').toString());
  assert.equal(build.plugin, manifest.name);
  assert.equal(build.version, project.version);
  assert.equal(build.repository, 'https://github.com/5101good/amoji');
  assert.equal(build.clientSha256, thirdParty.clientSha256);
  const { withValidatedPack } = await import('../dist/src/packs.js');
  const baseLibrary = files.get('assets/base-library/base.amoji');
  await withValidatedPack(baseLibrary, async pack => {
    validatePublicFile('base-library/manifest.json', Buffer.from(JSON.stringify(pack.manifest)));
    for (const expression of pack.manifest.expressions) assert.equal(expression.rights.license, 'CC0-1.0', 'Built-in assets must retain their CC0 license');
  });
  await writeFile(resolve(destination, `amoji-base-library-${project.version}.amoji`), baseLibrary);
  for (const [source, name] of [['LICENSE', 'LICENSE'], ['NOTICE', 'NOTICE'], ['THIRD_PARTY.json', 'THIRD_PARTY.json'], ['assets/base-library/LICENSE', 'BASE_LIBRARY_LICENSE'], ['assets/base-library/provenance.json', 'BASE_LIBRARY_PROVENANCE.json']]) {
    await writeFile(resolve(destination, name), files.get(source));
  }
  const notes = await readFile(resolve(root, `docs/releases/v${project.version}.md`));
  validatePublicFile('RELEASE_NOTES.md', notes);
  await writeFile(resolve(destination, 'RELEASE_NOTES.md'), notes);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const githubActions = process.env.GITHUB_ACTIONS === 'true';
  if (githubActions) assert.equal(commit, process.env.GITHUB_SHA, 'Build checkout must match workflow commit');
  await writeFile(resolve(destination, 'BUILD_PROVENANCE.json'), `${JSON.stringify({
    version: project.version,
    repository: 'https://github.com/5101good/amoji',
    commit,
    tag: process.env.RELEASE_TAG || null,
    builder: githubActions ? 'GitHub Actions' : 'local',
    ...(githubActions ? {
      workflowRun: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
      workflow: process.env.GITHUB_WORKFLOW_REF,
    } : { dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0 }),
  }, null, 2)}\n`);
  const checksums = [];
  for (const name of (await readdir(destination)).sort()) checksums.push(`${digest(await readFile(resolve(destination, name)))}  ${name}`);
  await writeFile(resolve(destination, 'SHA256SUMS'), `${checksums.join('\n')}\n`);
  console.log(`Verified ${files.size} package files and ${thirdParty.packages.length} dependency license records; release assets: ${destination}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildReleaseArtifacts();
