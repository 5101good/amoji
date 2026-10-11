/** Draft edits create new identities; unchanged expressions retain their exact references. */
export function buildSnapshot(
  input: any,
  original: any,
  identity: { pack_id: string; release_id: string; version: number },
) {
  const m = structuredClone(input),
    expressionRefs = new Map<string, any>(),
    actionRefs = new Map<string, any>();
  const stable = (v: any): string =>
    JSON.stringify(v, (_k, x) =>
      x && typeof x === "object" && !Array.isArray(x)
        ? Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((k) => [k, x[k]]),
          )
        : x,
    );
  for (const e of m.expressions) {
    const old = original.expressions.find(
      (o: any) => o.asset_id === e.asset_id && o.revision_id === e.revision_id,
    );
    if (!old || stable(old) === stable(e)) continue;
    const ref = { asset_id: e.asset_id, revision_id: e.revision_id };
    e.asset_id = crypto.randomUUID();
    e.revision_id = crypto.randomUUID();
    e.derived_from = ref;
    expressionRefs.set(ref.asset_id + ":" + ref.revision_id, {
      asset_id: e.asset_id,
      revision_id: e.revision_id,
    });
  }
  for (const a of m.actions) {
    const old = original.actions?.find(
      (o: any) =>
        o.action_id === a.action_id &&
        o.action_revision_id === a.action_revision_id,
    );
    if (!old || stable(old) === stable(a)) continue;
    const key = a.action_id + ":" + a.action_revision_id;
    const source = `amoji:action/${a.action_id}/${a.action_revision_id}`;
    a.action_id = crypto.randomUUID();
    a.action_revision_id = crypto.randomUUID();
    a.rights.source = a.rights.source
      ? `${a.rights.source}\n${source}`
      : source;
    actionRefs.set(key, {
      action_id: a.action_id,
      action_revision_id: a.action_revision_id,
    });
  }
  m.defaults = m.defaults.map(
    (r: any) => expressionRefs.get(r.asset_id + ":" + r.revision_id) ?? r,
  );
  m.bindings = m.bindings.map((b: any) => ({
    expression:
      expressionRefs.get(
        b.expression.asset_id + ":" + b.expression.revision_id,
      ) ?? b.expression,
    actions: b.actions.map(
      (a: any) => actionRefs.get(a.action_id + ":" + a.action_revision_id) ?? a,
    ),
  }));
  return { ...m, ...identity };
}
