# Amoji for Claude Code

普通 Claude Code 插件，复用 Codex 的同一个本地版本库和服务。模型只收固定文字语义；人类在配套面板看同一确定版本的图片、动图和历史。

需要 Node.js 24+、Claude Code 2.1.196+，以及可用的 `PreToolUse` Hook。共享服务须为 API 2 并声明 `claude-hook-tickets-v1`；缺少能力时明确失败，不更改正在运行的旧服务。仅支持默认主会话，子代理和 `--agent` 自定义主会话明确拒绝。当前机器的 2.1.177 不满足完整回合合同，未运行真实宿主验证。

从仓库构建：

```sh
npm run build
node scripts/build-claude-plugin.mjs /目标目录/amoji-claude
```

生成目录包含插件清单、MCP 配置、Hook、Skill、共享服务与面板入口、素材和 npm 运行依赖。复制到同平台同架构机器时可移动整个目录，路径由 `${CLAUDE_PLUGIN_ROOT}` 解析；其他平台需重新构建原生依赖。`node` 必须在宿主 PATH 中。不可用 Codex 的物化 `.mcp.json` 替换此包的配置。

在已满足版本和认证的 Claude 中，用 `claude --plugin-dir /目标目录/amoji-claude` 加载候选插件；调用 `/amoji:amoji` 或明确要求选表情。`amoji_pick` 等待当前调用的用户选择，再返回固定语义；普通插件不提供空闲面板主动插入任意会话的能力。`amoji_emit` 打开配套面板，失败时返回可手动打开的 `panel_url`。面板按钮、动画暂停、版本语义与本会话完整历史共用现有实现。

PreToolUse 用真实 `session_id`、`prompt_id`、`tool_use_id` 签发两分钟有效的一次性关联票据；覆盖模型填入的 `_amoji_ticket`，保留业务参数，不返回自动授权。若用户审批超过票据有效期，重新发起调用。MCP 校验、剥离票据后调用核心；多次 Hook 的同一 `prompt_id` 仍是同一回合。Hook 不记录 prompt 文本或转录，也不把图片或路径送入模型内容块。

服务重启使尚未兑换的关联票据失效；已存表情消息和确定版本不会删除。同一宿主会话重连时重新打开面板恢复历史，面板 URL 及能力令牌会换新。HTTP/MCP 成功、浏览器命令成功或面板 `rendered` 均不充当 Claude 消息写入确认。宿主完成观察和完整投递状态机留待后续票据。

Hook 与 MCP 处于同一个 OS 用户的本地可信适配边界，服务发现凭据不交给模型或网页；这不是隔离同用户恶意本地程序的沙箱。默认数据根与 Codex 相同；测试可明确使用 `AMOJI_DATA_DIR` 隔离。
