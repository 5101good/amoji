import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startRelay } from './wire-relay.mjs';
const root = resolve(import.meta.dirname, '../..');
const run = mkdtempSync(join(tmpdir(), 'amoji-live-'));
const dataDirectory = process.env.AMOJI_DATA_DIR || join(run, 'data');
const evidenceFile = join(run, 'wire.jsonl');
writeFileSync(evidenceFile, '', { mode: 0o600 });
const relay = await startRelay(evidenceFile);
const executable = process.env.AMOJI_CODEX_BIN || 'codex';
const replyQuery = process.env.AMOJI_REPLY_QUERY || '加油';
const pickEnabled = process.env.AMOJI_PROBE_PICK === '1';
const emitFirst = pickEnabled && process.env.AMOJI_PROBE_EMIT_FIRST === '1';
const pickPrompt = `这是 Amoji 双向集成测试。请调用 amoji_pick 打开表情选择器，等待我点选表情。你只能根据工具返回的固定文字语义理解我，再用 amoji_search 查询“${replyQuery}”，使用得到的凭据调用 amoji_emit 回应。最后输出 display_markdown 和一句简短回应，不读取任何文件或图片。`;
const emitFirstPrompt = `这是 Amoji 双向集成测试。请先调用 amoji_search 查询“${replyQuery}”，使用同次检索得到的 selection_token 调用 amoji_emit；再调用 amoji_pick 打开表情选择器，等待我点选表情。你只能根据 amoji_pick 返回的固定文字语义理解我，最后用一句简短文字回应。每回合只能调用一次 amoji_emit，不读取任何文件或图片。`;
const probePrompt = emitFirst ? emitFirstPrompt : pickPrompt;
let panelProgressEmitted = false;

function emitPanelProgress(event) {
  if (!emitFirst || panelProgressEmitted || event?.type !== 'item.completed') return;
  const item = event.item;
  if (item?.type !== 'mcp_tool_call' || item.server !== 'amoji' || item.tool !== 'amoji_emit' || item.status !== 'completed'
    || item.error || item.result?.isError || item.result?.is_error || !Array.isArray(item.result?.content)) return;
  for (const block of item.result.content) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    try {
      const result = JSON.parse(block.text);
      if (!result || typeof result !== 'object' || Array.isArray(result)
        || typeof result.panel_url !== 'string' || typeof result.message_id !== 'string' || result.message_id.length === 0) continue;
      const panel = new URL(result.panel_url);
      if (panel.protocol !== 'http:' || panel.hostname !== '127.0.0.1' || panel.port === '' || panel.pathname !== '/'
        || panel.username || panel.password || panel.search || panel.hash.length <= 1) continue;
      panelProgressEmitted = true;
      console.log(JSON.stringify({ type: 'amoji.panel_ready', panel_url: result.panel_url, message_id: result.message_id }));
      return;
    } catch { continue; }
  }
}
const args = ['exec', '--ignore-user-config', '--skip-git-repo-check', '--json', '-C', run, '-s', 'read-only',
  '-c', 'features.apps=false', '-c', 'model_provider="amoji_observation"',
  '-c', 'model_providers.amoji_observation.name="Amoji request observation"',
  '-c', `model_providers.amoji_observation.base_url="${relay.url}"`,
  '-c', 'model_providers.amoji_observation.wire_api="responses"',
  '-c', 'model_providers.amoji_observation.requires_openai_auth=true',
  '-c', 'model_providers.amoji_observation.supports_websockets=false',
  '-c', `mcp_servers.amoji.command="${process.execPath}"`,
  '-c', `mcp_servers.amoji.args=${JSON.stringify([join(root, 'dist/src/main.js')])}`,
  '-c', `mcp_servers.amoji.env={AMOJI_DATA_DIR=${JSON.stringify(dataDirectory)}}`,
  '-c', 'mcp_servers.amoji.tools.amoji_emit.approval_mode="approve"',
  '-c', 'mcp_servers.amoji.tools.amoji_pick.approval_mode="approve"',
  pickEnabled
    ? probePrompt
    : '这是 Amoji 集成测试。我刚完成了第一个里程碑，请调用 amoji_search 查询“庆祝”，然后使用得到的 selection_token 调用 amoji_emit，最后原样输出它给的 display_markdown 和一句简短庆祝。不读取文件，不调用图片工具。'];
if (process.env.AMOJI_RESUME_THREAD) {
  args.pop();
  args.push('resume', process.env.AMOJI_RESUME_THREAD, pickEnabled ? probePrompt : '继续 Amoji 纯文本回放测试：只用上一轮表情的文字语义，用一句话说说你理解到的情绪。不读取文件，不打开图片，不调用工具。');
}
if (process.env.AMOJI_USE_PLUGIN === '1') {
  // Older Codex builds omit installed plugins under --ignore-user-config.
  // Retain installation discovery. Other user-configured MCP servers may start,
  // but the test prompt and expected-call checks concern Amoji only.
  args.splice(args.indexOf('--ignore-user-config'), 1);
  for (let index = args.length - 2; index >= 0; index--) {
    if (args[index] === '-c' && args[index + 1].startsWith('mcp_servers.amoji.')) args.splice(index, 2);
  }
  args.splice(1, 0, '-c', 'plugins={"amoji@personal"={enabled=true,mcp_servers={amoji={tools={amoji_emit={approval_mode="approve"},amoji_pick={approval_mode="approve"}}}}}}');
}
const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AMOJI_DATA_DIR: dataDirectory } });
let output = ''; let stderr = '';
let progress = '';
console.log(JSON.stringify({ run, dataDirectory, executable, installedPlugin: process.env.AMOJI_USE_PLUGIN === '1' }));
child.stdout.on('data', c => {
  output += c; progress += c;
  const lines = progress.split('\n'); progress = lines.pop();
  for (const line of lines) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'thread.started') console.log(JSON.stringify(event));
    if (event.item?.type === 'mcp_tool_call') console.log(JSON.stringify({ type: event.type, tool: event.item.tool, status: event.item.status }));
    emitPanelProgress(event);
  }
});
child.stderr.on('data', c => stderr += c);
const timeout = setTimeout(() => child.kill('SIGTERM'), pickEnabled ? 300000 : 120000);
child.on('exit', async code => {
  clearTimeout(timeout);
  await relay.close();
  writeFileSync(join(run, 'events.jsonl'), output, { mode: 0o600 });
  writeFileSync(join(run, 'stderr.txt'), stderr, { mode: 0o600 });
  const events = output.trim().split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const calls = events.filter(e => e.type === 'item.completed' && e.item?.type === 'mcp_tool_call').map(e => e.item);
  const amojiCalls = calls.filter(call => call.server === 'amoji');
  const wire = readFileSync(evidenceFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const expected = process.env.AMOJI_RESUME_THREAD && !pickEnabled ? [] : ['amoji_search', 'amoji_emit', ...(pickEnabled ? ['amoji_pick'] : [])];
  const successful = call => call.status === 'completed' && !call.error && !call.result?.isError && !call.result?.is_error;
  const successfulTools = expected.every(name => amojiCalls.some(call => call.tool === name && successful(call)));
  const orderedTools = amojiCalls.filter(successful).map(call => call.tool);
  let previousIndex = -1;
  const orderedEmitFirstCalls = !emitFirst || expected.every(name => {
    previousIndex = orderedTools.indexOf(name, previousIndex + 1);
    return previousIndex !== -1;
  });
  const strictEmitFirst = !emitFirst || (panelProgressEmitted && orderedEmitFirstCalls
    && amojiCalls.filter(call => call.tool === 'amoji_emit').length === 1
    && amojiCalls.filter(call => expected.includes(call.tool)).every(successful));
  const textOnly = wire.length > 0 && wire.every(request => request.parsed && request.inputImageParts === 0 && request.imageDataUrls === 0);
  const passed = code === 0 && successfulTools && strictEmitFirst && textOnly;
  console.log(JSON.stringify({ run, executable, exitCode: code, passed, requests: wire.length, textOnly,
    ...(emitFirst ? { panelReady: panelProgressEmitted } : {}), calls: calls.map(c => ({ tool: c.tool, status: c.status })), stderr: stderr.slice(-1200) }, null, 2));
  process.exitCode = passed ? 0 : 1;
});
