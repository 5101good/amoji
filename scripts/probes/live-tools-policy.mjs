const expressFirstTools = ['amoji_express', 'amoji_pick'];

export function isSuccessfulAmojiCall(call, tool) {
  return call?.type === 'mcp_tool_call' && call.server === 'amoji' && call.tool === tool
    && call.status === 'completed' && !call.error && !call.result?.isError && !call.result?.is_error;
}

/** Express-first probes allow exactly one express (by act, no search) followed by one pick. */
export function hasExactExpressFirstSequence(calls) {
  const related = calls.filter(call => call?.type === 'mcp_tool_call' && call.server === 'amoji' && ['amoji_search', ...expressFirstTools].includes(call.tool));
  return related.length === expressFirstTools.length
    && related.every((call, index) => isSuccessfulAmojiCall(call, expressFirstTools[index]));
}
