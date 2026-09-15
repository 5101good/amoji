const emitFirstTools = ['amoji_search', 'amoji_emit', 'amoji_pick'];

export function isSuccessfulAmojiCall(call, tool) {
  return call?.type === 'mcp_tool_call' && call.server === 'amoji' && call.tool === tool
    && call.status === 'completed' && !call.error && !call.result?.isError && !call.result?.is_error;
}

export function hasExactEmitFirstSequence(calls) {
  const related = calls.filter(call => call?.type === 'mcp_tool_call' && call.server === 'amoji' && emitFirstTools.includes(call.tool));
  return related.length === emitFirstTools.length
    && related.every((call, index) => isSuccessfulAmojiCall(call, emitFirstTools[index]));
}
