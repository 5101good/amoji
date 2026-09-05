// Capability probe only. Logs context keys, never environment values or credentials.
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const log = process.env.AMOJI_PROBE_LOG;
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (!Object.hasOwn(request, 'id')) continue;
  let result;
  if (request.method === 'initialize') {
    result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'amoji-context-probe', version: '0.1.0' } };
  } else if (request.method === 'tools/list') {
    result = { tools: [{ name: 'amoji_context_probe', description: 'Verify text-only Amoji host context. Call once with an empty object.', annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] };
  } else if (request.method === 'tools/call') {
    const context = { method: request.method, meta: request.params?._meta ?? null, args: request.params?.arguments ?? null, environmentKeys: Object.keys(process.env).filter(k => /CODEX.*(THREAD|SESSION|TURN)/.test(k)) };
    if (log) appendFileSync(log, JSON.stringify(context) + '\n');
    result = { content: [{ type: 'text', text: 'Amoji text-only context probe received. No image was read or returned.' }] };
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } }) + '\n');
    continue;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
}
