import { SharedClient } from './shared-client.js';
import { CLAUDE_TICKET_CAPABILITY, fail } from './shared-contract.js';
import { CLAUDE_TICKET_FIELD, claudeHookContext } from './claude-context.js';

let client: SharedClient | undefined;
try {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 32768) fail('CLAUDE_INPUT_TOO_LARGE', 'Hook 输入过大');
  }
  let input: unknown;
  try { input = JSON.parse(raw); } catch { fail('CLAUDE_CONTEXT_UNAVAILABLE', 'Hook 输入不是有效 JSON'); }
  const { invocation, args } = claudeHookContext(input);
  client = await SharedClient.connect({ requiredCapabilities: [CLAUDE_TICKET_CAPABILITY] });
  const { ticket } = await client.issueClaudeTicket(invocation);
  // No permissionDecision: the modified arguments still pass through the host's approval policy.
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...args, [CLAUDE_TICKET_FIELD]: ticket } } })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'CLAUDE_CONTEXT_UNAVAILABLE：无法关联工具调用'}\n`);
  process.exitCode = 2;
} finally {
  await client?.close();
}
