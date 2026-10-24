import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { archive } from "./upload-fixtures.mjs";
await build({
  entryPoints: ["web/snapshot.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist/snapshot-test.mjs",
});
const { buildSnapshot } = await import("../dist/snapshot-test.mjs");
test("creator snapshot keeps unchanged semantics and forks only edited immutable identities with correct bindings", async () => {
  const identity = {
    pack_id: crypto.randomUUID(),
    release_id: crypto.randomUUID(),
    version: 3,
  };
  const { manifest } = await archive(identity);
  const expression = manifest.expressions[0];
  const effect = {
    effect_id: crypto.randomUUID(),
    effect_revision_id: crypto.randomUUID(),
    kind: "context",
    conflict_group: "explanation",
    title: { "zh-CN": "先说结论" },
    summary: { "zh-CN": "回答先给结论" },
    instruction: { "zh-CN": "先说结论" },
  };
  manifest.effects = [effect];
  manifest.bindings = [
    { target: { asset_id: expression.asset_id, revision_id: expression.revision_id }, effects: [effect.effect_id] },
    { target: { act: "core:ack" }, effects: [effect.effect_id] },
  ];
  assert.deepEqual(buildSnapshot(manifest, manifest, identity), manifest);
  const draft = structuredClone(manifest);
  draft.expressions[0].rights.creator = "New attribution";
  const result = buildSnapshot(draft, manifest, identity);
  assert.notEqual(result.expressions[0].asset_id, expression.asset_id);
  assert.notEqual(result.expressions[0].revision_id, expression.revision_id);
  assert.deepEqual(result.expressions[0].semantics, expression.semantics);
  assert.match(result.expressions[0].rights.source, new RegExp(expression.revision_id));
  assert.deepEqual(result.bindings[0].target, { asset_id: result.expressions[0].asset_id, revision_id: result.expressions[0].revision_id });
  assert.deepEqual(result.bindings[1].target, { act: "core:ack" }, "act bindings never change");
  assert.deepEqual(result.effects, manifest.effects, "effects keep their identity");
  assert.deepEqual(manifest.expressions[0], expression);
});
test("forking one revision leaves the other revisions of an asset untouched", async () => {
  const identity = {
    pack_id: crypto.randomUUID(),
    release_id: crypto.randomUUID(),
    version: 1,
  };
  const { manifest } = await archive(identity);
  const second = structuredClone(manifest.expressions[0]);
  second.asset_id = crypto.randomUUID();
  second.revision_id = crypto.randomUUID();
  manifest.expressions.push(second);
  for (const edited of [0, 1]) {
    const draft = structuredClone(manifest);
    draft.expressions[edited].rights.creator = "Edited creator";
    const m = buildSnapshot(draft, manifest, identity);
    assert.notEqual(m.expressions[edited].revision_id, manifest.expressions[edited].revision_id);
    assert.deepEqual(m.expressions[1 - edited], manifest.expressions[1 - edited]);
    assert.equal(new Set(m.expressions.map((e) => e.asset_id)).size, 2);
  }
});
