import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const run = mkdtempSync(join(tmpdir(), 'amoji-context-'));
const log = join(run, 'context.jsonl');
writeFileSync(log, '');
const executable = process.env.AMOJI_CODEX_BIN || 'codex';
const hooks = Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop'].map(event => [event, [{ ...(event === 'PreToolUse' ? { matcher: 'mcp__amoji_probe__.*' } : {}), hooks: [{ type: 'command', command: `AMOJI_PROBE_LOG='${log}' node '${join(root, 'scripts/probes/hook.mjs')}'`, timeout: 10 }] }]]));
const args = ['exec', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral', '--json', '--dangerously-bypass-hook-trust', '-C', run, '-s', 'read-only', '-c', 'features.apps=false', '-c', `mcp_servers.amoji_probe.command="${process.execPath}"`, '-c', `mcp_servers.amoji_probe.args=${JSON.stringify([join(root, 'scripts/probes/mcp.mjs')])}`, '-c', `mcp_servers.amoji_probe.env={AMOJI_PROBE_LOG="${log}"}`];
// Inline TOML object, with only generated paths and vetted test hooks.
for (const [event, groups] of Object.entries(hooks)) {
  const group = groups[0];
  const hook = group.hooks[0];
  args.push('-c', `hooks.${event}=[{${group.matcher ? `matcher=${JSON.stringify(group.matcher)},` : ''}hooks=[{type="command",command=${JSON.stringify(hook.command)},timeout=10}]}]`);
}
args.push('这是 Amoji 集成测试。请只调用一次 amoji_context_probe 工具，参数为空对象，不读取文件，不调用图像工具，然后回复测试收到。');
const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
const timer = setTimeout(() => child.kill('SIGTERM'), 120000);
let output = '';
let stderr = '';
child.stdout.on('data', c => output += c);
child.stderr.on('data', c => stderr += c);
child.on('error', e => { clearTimeout(timer); console.error(e.message); process.exitCode = 1; });
child.on('exit', code => {
  clearTimeout(timer);
  writeFileSync(join(run, 'events.jsonl'), output, { mode: 0o600 });
  writeFileSync(join(run, 'stderr.txt'), stderr, { mode: 0o600 });
  console.log(JSON.stringify({ executable, exitCode: code, run, context: readFileSync(log, 'utf8'), events: output.slice(-6000), stderr: stderr.slice(-2500) }, null, 2));
  process.exitCode = code ?? 1;
});
