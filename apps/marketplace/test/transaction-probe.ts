// Test-only D1 feasibility fixture; never included in the production Worker.
interface Input {
  id: string;
  key: string;
  action: "approve" | "withdraw";
  version: number;
  fail?: boolean;
  actor: string;
}
export default {
  async fetch(req: Request, env: { DB: D1Database }) {
    const i = (await req.json()) as Input;
    const payload = JSON.stringify([i.actor, i.id, i.action, i.version]);
    async function replay() {
      const existing = await env.DB.prepare(
        "SELECT payload FROM fixture_operation WHERE key=?",
      )
        .bind(i.key)
        .first<{ payload: string }>();
      return existing
        ? new Response("recorded", {
            status: existing.payload === payload ? 200 : 409,
          })
        : null;
    }
    const old = await replay();
    if (old) return old;
    const marker = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE fixture_submission SET state=?,version=version+1,operation=? WHERE id=? AND state='pending' AND version=?",
        ).bind(i.action, marker, i.id, i.version),
        env.DB.prepare(
          "INSERT INTO fixture_operation(key,payload,success) SELECT ?,?,EXISTS(SELECT 1 FROM fixture_submission WHERE id=? AND operation=?)",
        ).bind(i.key, payload, i.id, marker),
        env.DB.prepare(
          "INSERT INTO fixture_audit(key,submission,action) VALUES (?,?,?)",
        ).bind(i.key, i.id, i.action),
        env.DB.prepare(
          "INSERT INTO fixture_operation(key,payload,success) SELECT ?,?,0 WHERE ?=1",
        ).bind(`fault:${marker}`, payload, i.fail ? 1 : 0),
      ]);
      return new Response("committed");
    } catch {
      return (
        (await replay()) ??
        new Response("rejected", { status: i.fail ? 500 : 412 })
      );
    }
  },
};
