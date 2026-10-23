import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { API_VERSION, DATABASE_VERSION, VERSIONED_PACKS_CAPABILITY, PACKS_CAPABILITY, LIBRARY_MANAGEMENT_CAPABILITY, CREATE_DRAFT_CAPABILITY, TEXT_SUGGESTION_CAPABILITY, DSH_RELIABILITY_CAPABILITY, DSH_NATIVE_CAPABILITY } from '../dist/src/shared-contract.js';
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'adapters/dsh');
const manifest = JSON.parse(await readFile(`${out}/package.json`, 'utf8'));
// These are exclusively generated directories owned by this build.
await rm(`${out}/runtime`, { recursive: true, force: true });
await rm(`${out}/assets`, { recursive: true, force: true });
await mkdir(`${out}/runtime/src/dsh`, { recursive: true });
// Every host-independent core module (protocol and application included) runs inside the plugin's service.
for (const name of await readdir(`${root}/dist/src`)) if (name.endsWith('.js')) await cp(`${root}/dist/src/${name}`, `${out}/runtime/src/${name}`);
for (const dir of ['protocol', 'application']) await cp(`${root}/dist/src/${dir}`, `${out}/runtime/src/${dir}`, { recursive: true });
await cp(`${root}/web`, `${out}/web`, { recursive: true });
// Host-side dsh modules are the .ts sources; .tsx files are bundled into client.js below.
for (const name of await readdir(`${root}/src/dsh`)) if (name.endsWith('.ts')) await cp(`${root}/dist/src/dsh/${name.replace(/\.ts$/, '.js')}`, `${out}/runtime/src/dsh/${name.replace(/\.ts$/, '.js')}`);
await mkdir(`${out}/runtime/docs/specs`, { recursive: true });
for (const name of ['amoji-0.1.schema.json', 'amoji-0.1.registry.json']) await cp(`${root}/docs/specs/${name}`, `${out}/runtime/docs/specs/${name}`);
await mkdir(`${out}/assets/official-packs`, { recursive: true });
for (const name of ['classic.amoji', 'office.amoji', 'LICENSE']) await cp(`${root}/assets/official-packs/${name}`, `${out}/assets/official-packs/${name}`);
const clientBuild = await build({ metafile: true, entryPoints: [`${root}/src/dsh/client.tsx`], outfile: `${out}/client.js`, bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', jsx: 'transform', tsconfigRaw: { compilerOptions: { jsx: 'react' } }, external: ['react', 'react/*'], banner: { js: 'window.__ModuleLoader__.load({id:"@amoji/dsh",factory:(require)=>{var module={exports:{}};var exports=module.exports;' }, footer: { js: 'return module.exports;}});' } });
await mkdir(`${root}/.cache`, { recursive: true });
await writeFile(`${root}/.cache/dsh-client-metafile.json`, JSON.stringify(clientBuild.metafile));
await import('./dsh-distribution.mjs');
const hash = createHash('sha256').update(await readFile(`${out}/client.js`)).digest('hex');
await writeFile(`${out}/BUILD.json`, JSON.stringify({ plugin: manifest.name, version: manifest.version, repository: 'https://github.com/5101good/amoji', dshVersion: '0.1.5-rc.2', serviceApi: API_VERSION, databaseVersion: DATABASE_VERSION, providedManagementCapabilities: [VERSIONED_PACKS_CAPABILITY, PACKS_CAPABILITY, LIBRARY_MANAGEMENT_CAPABILITY, CREATE_DRAFT_CAPABILITY, TEXT_SUGGESTION_CAPABILITY], requiredCapabilities: [DSH_RELIABILITY_CAPABILITY, DSH_NATIVE_CAPABILITY, LIBRARY_MANAGEMENT_CAPABILITY, PACKS_CAPABILITY], clientSha256: hash, node: process.version, validation: 'published npm contracts and local lifecycle tests; live QA tracked separately' }, null, 2) + '\n');
console.log(`Built ${out}`);
