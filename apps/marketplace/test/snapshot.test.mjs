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
  const action = {
    action_id: crypto.randomUUID(),
    action_revision_id: crypto.randomUUID(),
    kind: "instruction",
    scope: "turn",
    locale: "zh-CN",
    effect_summary: "先说结论",
    conflict_group: "explanation",
    instruction: "先说结论",
    rights: { license: "CC0-1.0", creator: "Original" },
  };
  manifest.actions = [action];
  manifest.bindings = [
    {
      expression: {
        asset_id: expression.asset_id,
        revision_id: expression.revision_id,
      },
      actions: [
        {
          action_id: action.action_id,
          action_revision_id: action.action_revision_id,
        },
      ],
    },
  ];
  assert.deepEqual(buildSnapshot(manifest, manifest, identity), manifest);
  const draft = structuredClone(manifest);
  draft.expressions[0].rights.creator = "New attribution";
  draft.actions[0].rights.creator = "New attribution";
  const result = buildSnapshot(draft, manifest, identity);
  assert.notEqual(result.expressions[0].asset_id, expression.asset_id);
  assert.notEqual(result.expressions[0].revision_id, expression.revision_id);
  assert.deepEqual(result.expressions[0].semantics, expression.semantics);
  assert.deepEqual(result.expressions[0].derived_from, manifest.defaults[0]);
  assert.deepEqual(result.defaults[0], result.bindings[0].expression);
  assert.equal(result.defaults[0].asset_id, result.expressions[0].asset_id);
  assert.notEqual(result.actions[0].action_id, action.action_id);
  assert.equal(
    result.bindings[0].actions[0].action_id,
    result.actions[0].action_id,
  );
  assert.match(
    result.actions[0].rights.source,
    new RegExp(action.action_revision_id),
  );
  assert.equal(result.actions[0].rights.license, "CC0-1.0");
  assert.deepEqual(manifest.expressions[0], expression);
});
test("forking default and non-default revisions retains one default per resulting asset", async () => {
  const identity = {
    pack_id: crypto.randomUUID(),
    release_id: crypto.randomUUID(),
    version: 1,
  };
  const { manifest } = await archive(identity);
  const second = structuredClone(manifest.expressions[0]);
  second.revision_id = crypto.randomUUID();
  manifest.expressions.push(second);
  for (const edited of [0, 1]) {
    const draft = structuredClone(manifest);
    draft.expressions[edited].rights.creator = "Edited creator";
    const m = buildSnapshot(draft, manifest, identity);
    const assets = new Set(m.expressions.map((e) => e.asset_id));
    assert.equal(m.defaults.length, assets.size);
    assert.equal(new Set(m.defaults.map((r) => r.asset_id)).size, assets.size);
    for (const ref of m.defaults)
      assert.ok(
        m.expressions.some(
          (e) =>
            e.asset_id === ref.asset_id && e.revision_id === ref.revision_id,
        ),
      );
  }
});
