/** The only Mods -> Node boundary. User text travels on stdin, never in a shell. */
export async function bridge($, context, command, args = {}) {
  const [configuredNode, data] = await Promise.all([$.env.get("AMOJI_NODE"), $.env.get("AMOJI_DATA_DIR")]);
  const node = configuredNode || "node";
  const result = await $.process.run(
    [node, $.plugin.root + "/runtime/src/claude-mods/main.js"],
    {
      stdin: JSON.stringify({ command, context, args }),
      timeoutMs: command === "publisher" ? 300_000 : 60_000,
      ...(data ? { env: { AMOJI_DATA_DIR: data } } : {}),
    },
  );
  if (result.exitCode !== 0 || result.isStdoutTruncated)
    throw new Error("BRIDGE_UNAVAILABLE");
  let reply;
  try {
    reply = JSON.parse(result.stdout);
  } catch {
    throw new Error("BRIDGE_UNAVAILABLE");
  }
  if (!reply.ok) throw new Error(reply.error?.code || "BRIDGE_UNAVAILABLE");
  return reply.result;
}
export const refOf = (expression) => ({
  asset_id: expression.asset_id,
  revision_id: expression.revision_id,
});
export const L = (s, zh, en) => (s.language === "en" ? en : zh);
export function errorText(s, error) {
  const code = String(error?.message || error);
  if (/ACTION_LIMIT/.test(code))return L(s,"协作提示超出数量或文字预算，请减少后重试。","Too much collaboration guidance. Reduce the selected rules or text and retry.");
  if (/PUBLISHER_LOGIN|UNAUTHENTICATED|PAIRING_EXPIRED/.test(code))return L(s,"市场授权已失效，请重新连接账号；草稿已保留。","Market authorization expired. Reconnect your account; drafts are preserved.");
  if (/PUBLISHER_OFFLINE|MARKET_UNAVAILABLE/.test(code))return L(s,"市场暂不可用。请稍后刷新或核对原操作，已安装的表情仍可使用。","Market unavailable. Refresh or check the original operation later. Installed expressions remain usable.");
  if (/RELEASE_REMOVED|SAFETY_REMOVED|ACTION_UNAVAILABLE/.test(code))return L(s,"此版本或提示已不可用，请刷新后选择其他内容。","This release or guidance is unavailable. Refresh and choose another.");
  if (/DIGEST_MISMATCH|MARKET_INVALID/.test(code))return L(s,"内容校验未通过，未安装。请刷新市场后重试。","Content verification failed; nothing was installed. Refresh the market before retrying.");
  if (/PUBLISHER_|RIGHTS_|LICENSE|UPLOAD_|RATE_LIMIT/.test(code))return L(s,"投稿未完成。请检查许可、账号与内容状态；草稿已保留，可刷新或恢复原操作。","Submission was not completed. Check license, account and content status. Drafts are preserved; refresh or resume the original operation.");
  if (/^DRAFT_(CONFLICT|CONFIRMED)$/.test(code))
    return L(
      s,
      "这个草稿已在另一处更新。你的输入已保留，请选择如何继续。",
      "This draft changed elsewhere. Your input is preserved; choose how to continue.",
    );
  if (/OUTCOME_UNKNOWN/.test(code))
    return L(
      s,
      "操作结果尚待核对，未自动重试。请先检查会话或表情库。",
      "The outcome is unknown. No retry was made. Check the conversation or library first.",
    );
  if (/STALE|CONFLICT|VERSION/.test(code))
    return L(
      s,
      "数据已被另一个窗口更新。请刷新后再操作；当前输入仍保留。",
      "Updated in another window. Refresh before trying again; your input is preserved.",
    );
  if (/EXPORT_EXISTS/.test(code))
    return L(
      s,
      "文件已存在，请换一个文件名。",
      "That file already exists. Choose a new filename.",
    );
  if (/FILE_WRITE_FAILED/.test(code))
    return L(
      s,
      "无法导出，请检查目标目录是否存在并允许写入。",
      "Export failed. Check that the destination folder exists and is writable.",
    );
  if (
    /INVALID_PATH|ENOENT|FILE_READ_FAILED|FILE_CHANGED|FILE_LIMIT|MEDIA_|PACK_/.test(
      code,
    )
  )
    return L(
      s,
      "无法读取这个文件。请检查绝对路径、格式和大小。图片上限 10 MiB。",
      "Cannot read this file. Check its absolute path, format and size. Images: up to 10 MiB.",
    );
  if (/SUGGESTION/.test(code))
    return L(
      s,
      "AI 建议未完成或格式不合规，草稿保持不变。可重试或手工编辑。",
      "The AI suggestion failed or was invalid. Your draft is unchanged. Retry or edit manually.",
    );
  if (/INVALID|SCHEMA|BUDGET|REVIEW_REQUIRED/.test(code))
    return L(
      s,
      "请检查必填内容、文字长度和图片，并核对固定语义。",
      "Check required fields, text lengths and image, then review the fixed meaning.",
    );
  if (/CAPABILITY|API_|DATABASE_/.test(code))
    return L(
      s,
      "共享服务版本不兼容。关闭使用旧版 Amoji 的窗口后重试，不要删除表情库。",
      "The shared service is incompatible. Close windows using an older Amoji and retry; keep your library.",
    );
  if (/SUBMIT_DROPPED/.test(code))
    return L(
      s,
      "Claude 未接受这条消息。请处理会话中的提示后重新发送。",
      "Claude did not accept the message. Resolve the session notice before sending again.",
    );
  if (/SUBMIT_UNKNOWN/.test(code))
    return L(
      s,
      "提交结果未知。请先查看会话，避免重复发送。",
      "Submission status is unknown. Check the conversation before sending again.",
    );
  return L(
    s,
    "本地服务暂时不可用。请检查 Node.js 24+ 和插件安装；输入已保留。",
    "The local service is unavailable. Check Node.js 24+ and the plugin installation. Your input is preserved.",
  );
}
