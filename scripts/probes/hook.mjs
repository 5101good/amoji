import { appendFileSync } from 'node:fs';
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const safe = Object.fromEntries(['hook_event_name', 'session_id', 'turn_id', 'tool_use_id', 'tool_name'].filter(k => input[k] !== undefined).map(k => [k, input[k]]));
appendFileSync(process.env.AMOJI_PROBE_LOG, JSON.stringify(safe) + '\n');
process.stdout.write('{}');
