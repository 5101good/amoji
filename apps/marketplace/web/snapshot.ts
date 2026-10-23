/**
 * Draft edits create new identities; unchanged expressions retain their exact
 * references. An edited expression records the revision it came from in its
 * rights source (Amoji 0.1 has no per-expression derivation field), and
 * bindings that targeted it follow the new identity.
 */
export function buildSnapshot(
  input: any,
  original: any,
  identity: { pack_id: string; release_id: string; version: number },
) {
  const m = structuredClone(input),
    expressionRefs = new Map<string, any>();
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
    const key = e.asset_id + ":" + e.revision_id;
    const source = `amoji:expression/${e.asset_id}/${e.revision_id}`;
    e.asset_id = crypto.randomUUID();
    e.revision_id = crypto.randomUUID();
    e.rights.source = e.rights.source ? `${e.rights.source}\n${source}` : source;
    expressionRefs.set(key, { asset_id: e.asset_id, revision_id: e.revision_id });
  }
  if (m.bindings)
    m.bindings = m.bindings.map((b: any) => ({
      ...b,
      target:
        "act" in b.target
          ? b.target
          : (expressionRefs.get(b.target.asset_id + ":" + b.target.revision_id) ?? b.target),
    }));
  return { ...m, ...identity };
}
