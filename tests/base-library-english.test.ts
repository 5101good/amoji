import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Ajv2020} from 'ajv/dist/2020.js';
const readJson=async (path:string)=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
test('英文定义与中文定义一一对应，经典与办公共用同一组语义且满足 v0.1 字段约束',async()=>{
 const chinese=await readJson('../assets/base-library/definitions.json');const english=await readJson('../assets/base-library/definitions.en.json');
 const schema=await readJson('../docs/specs/amoji-v0.1.schema.json');
 const ajv=new Ajv2020({strict:false});ajv.addSchema(schema);
 const semantics=ajv.getSchema('urn:amoji:schema:0.1#/$defs/semantics')!;
 const revision=schema.$defs.revision.properties;const name=ajv.compile(revision.name);const tags=ajv.compile(revision.tags);
 assert.equal(english.version,chinese.version);assert.equal(english.entries.length,24);
 assert.deepEqual(english.entries.map((e:any)=>[e.slug,e.family]),chinese.entries.map((e:any)=>[e.slug,e.family]));
 for(const [i,entry] of english.entries.entries()){
  const source=chinese.entries[i];
  assert.equal(entry.semantics.locale,'en',entry.slug);
  assert.ok(semantics(entry.semantics),`${entry.slug}: ${JSON.stringify(semantics.errors)}`);
  assert.ok(name(entry.name),entry.slug);assert.ok(tags(entry.tags),`${entry.slug}: ${JSON.stringify(tags.errors)}`);
  assert.equal(entry.semantics.fallback,`[${entry.name}]`,entry.slug);
  // Same optional fields as the Chinese source, so both locales carry the same guidance.
  assert.deepEqual(Object.keys(entry.semantics).sort(),Object.keys(source.semantics).sort(),entry.slug);
  for(const key of ['use_when','avoid_when'])assert.equal(entry.semantics[key].length,source.semantics[key].length,`${entry.slug}.${key}`);
 }
 assert.deepEqual([...new Set(english.entries.map((e:any)=>e.group))],['Progress','Clarify','Direction','Feedback']);
});
