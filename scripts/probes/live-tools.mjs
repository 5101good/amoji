import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startRelay } from './wire-relay.mjs';
const root = resolve(import.meta.dirname, '../..');
const run = mkdtempSync(join(tmpdir(), 'amoji-live-'));
const evidenceFile = join(run, 'wire.jsonl');
writeFileSync(evidenceFile, '', { mode: 0o600 });
const relay = await startRelay(evidenceFile);
const executable = process.env.AMOJI_CODEX_BIN || 'codex';
const args = ['exec', '--ignore-user-config', '--skip-git-repo-check', '--json', '-C', run, '-s', 'read-only',
  '-c', 'features.apps=false', '-c', 'model_provider="amoji_observation"',
  '-c', 'model_providers.amoji_observation.name="Amoji request observation"',
  '-c', `model_providers.amoji_observation.base_url="${relay.url}"`,
  '-c', 'model_providers.amoji_observation.wire_api="responses"',
  '-c', 'model_providers.amoji_observation.requires_openai_auth=true',
  '-c', 'model_providers.amoji_observation.supports_websockets=false',
  '-c', `mcp_servers.amoji.command="${process.execPath}"`,
  '-c', `mcp_servers.amoji.args=${JSON.stringify([join(root, 'dist/src/main.js')])}`,
  '-c', 'mcp_servers.amoji.tools.amoji_emit.approval_mode="approve"',
  '-c', 'mcp_servers.amoji.tools.amoji_pick.approval_mode="approve"',
  process.env.AMOJI_PROBE_PICK === '1'
    ? '这是 Amoji 双向集成测试。请调用 amoji_pick 打开表情选择器，等待我点选表情。你只能根据工具返回的固定文字语义理解我，再用 amoji_search 查询“加油”，使用得到的凭据调用 amoji_emit 回应。最后输出 display_markdown 和一句简短回应，不读取任何文件或图片。'
    : '这是 Amoji 集成测试。我刚完成了第一个里程碑，请调用 amoji_search 查询“庆祝”，然后使用得到的 selection_token 调用 amoji_emit，最后原样输出它给的 display_markdown 和一句简短庆祝。不读取文件，不调用图片工具。'];
if (process.env.AMOJI_RESUME_THREAD) {
  args.pop();
  args.push('resume', process.env.AMOJI_RESUME_THREAD, '继续 Amoji 纯文本回放测试：只用上一轮表情的文字语义，用一句话说说你理解到的情绪。不读取文件，不打开图片，不调用工具。');
}
if (process.env.AMOJI_USE_PLUGIN === '1') {
  for (let index = args.length - 2; index >= 0; index--) {
    if (args[index] === '-c' && args[index + 1].startsWith('mcp_servers.amoji.')) args.splice(index, 2);
  }
  args.splice(1, 0, '-c', 'plugins={"amoji@personal"={enabled=true,mcp_servers={amoji={tools={amoji_emit={approval_mode="approve"},amoji_pick={approval_mode="approve"}}}}}}');
}
const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; let stderr = '';
child.stdout.on('data', c => output += c);
child.stderr.on('data', c => stderr += c);
const timeout = setTimeout(() => child.kill('SIGTERM'), process.env.AMOJI_PROBE_PICK === '1' ? 300000 : 120000);
child.on('exit', async code => {
  clearTimeout(timeout);
  await relay.close();
  writeFileSync(join(run, 'events.jsonl'), output, { mode: 0o600 });
  writeFileSync(join(run, 'stderr.txt'), stderr, { mode: 0o600 });
  console.log(JSON.stringify({ run, executable, exitCode: code, wire: readFileSync(evidenceFile, 'utf8'), events: output.slice(-6500), stderr: stderr.slice(-1200) }, null, 2));
  process.exitCode = code ?? 1;
});
