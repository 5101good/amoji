# 票据 03：Claude Code 适配验证

日期：2026-09-16。基线 `f7a6ac7`，工作分支 `codex/v0.1-completion`。本票交付实际普通插件、Hook、MCP 适配、共享面板接线与能力合同。仅修改工作区；没有安装插件、改用户配置、升级 Claude、启动真实模型或推送。

## 实现

- `plugins/amoji-claude` 含 `.claude-plugin/plugin.json`、`.mcp.json`、Hook 清单、Skill 和说明；`scripts/build-claude-plugin.mjs` 打包共享服务、客户端、面板、素材与 npm/原生运行依赖。路径从 `${CLAUDE_PLUGIN_ROOT}` 解析，和 Codex 物化 `.mcp.json` 分开。
- `src/claude-hook.ts` 从宿主 stdin 验证真实 session/prompt/invocation，覆盖保留票据字段，保留正常参数，不返回 allow。缺身份、子代理、自定义 agent、错误工具和额外目标字段拒绝。
- `src/claude-mcp-server.ts` 验证并剥离票据，四个模型工具复用既有工具参数合同、核心和固定文字投影；默认不依赖私有 MCP 元数据。`amoji_emit` 打开配套面板，`amoji_pick` 只完成原工具调用。
- 同一 API 2 服务提供可选能力 `claude-hook-tickets-v1`，数据库仍为 1；票据内存短期保存，库和消息仍由原核心维护。未知能力握手拒绝，旧 Codex 客户端正常使用。
- `ConnectedRuntime` 按操作释放绑定；共用面板按 host/instance/session 分区，保留确定版本、动图/封面、完整会话历史与消息 ID。

## 已执行的本地检查

| 检查 | 证据与结果 |
|---|---|
| Hook stdin/stdout | `tests/claude-adapter.test.ts` 启动真实 Hook 子进程，确认整对象 updatedInput、覆盖伪票据、未自动授权；缺身份、子代理、错误 Hook 与非法参数退出 2 |
| MCP stdio | 启动两个真实 `claude-main.ts` 进程；四工具可列出，缺票据、假票据、修改参数、额外调用 ID 冲突、票据重放拒绝 |
| 共享服务 RPC | `tests/shared-claude-ticket.test.ts` 使用真实本地 HTTP、鉴权、租约和数据库；签发冲突、工具/摘要/身份绑定、一次消费、过期、能力握手、API 2 普通客户端通过 |
| 三样本 | 庆祝、自嘲、加油均返回固定 ID/revision/完整语义，全部 MCP content 是 text；面板 revision 等于受控清单，图片/动图与封面的 SHA-256 对应原字节 |
| 会话、回合与限量 | 两个 MCP 进程可处理同一真实会话；跨会话/回合选择凭据拒绝，多个 Hook 保持同一 prompt_id，每回合最多一次新 emit，同选择重试保持消息 ID |
| 人工选择 | 双会话同时等待；伪造与跨会话 pick ID 拒绝，闲置 select 拒绝；真实 HTTP 点选完成相应 MCP 调用，返回所选固定语义，重复点选保持消息 ID；取消可结束等待 |
| 历史恢复与显示回执 | MCP 关闭后重新连接，同 session 的原消息 ID/revision 恢复；同会话 rendered 回执保存，跨会话回执拒绝，delivery 始终 pending |
| 独立发布产物 | `tests/plugin-artifact.test.ts` 在含空格的独立临时目录构建，从空 cwd 运行配置中的实际 Hook、MCP 和面板 HTTP/素材入口；依赖链接不回指开发树，Codex `.mcp.json` 内容保持不变 |
| 原有行为回归 | 全量本地测试涵盖 Codex MCP、原面板、持久化、迁移、服务选主/停止及每操作解绑，33 项通过 |

运行命令：

```sh
npm run typecheck
npm test
npm run build
node scripts/build-claude-plugin.mjs
claude plugin validate plugins/amoji-claude
git diff --check
```

`npm test`：33 passed、0 failed、0 skipped、0 cancelled。类型检查、构建、独立产物启动与 diff 检查通过。宿主 CLI 的 `plugin validate` 只验证插件清单，不表示已运行工具或模型；初次验证提示缺 author，随后使用项目原有归属 Amoji 补齐并复验。

保留初跑记录：票据 RPC 最初因未实现返回“未知服务方法”，新增适配和构建入口前分别失败，属于测试先行；三样本首轮把“加油”和“自嘲”的固定 ID 写反，实际返回与素材清单一致，修正测试期望后通过。没有把任何已运行的失败写成跳过。

本地检查中，OS 浏览器启动器替换为测试目录里的脚本，以避免打开用户浏览器；面板内容、HTTP、素材、数据库和 MCP 均实际运行。`/api/ack` 是测试发送的显示回执，不是浏览器图像 onload 的观测；未据此声明真实 Claude 面板或用户已读验证。人工 pick 是模拟人的 HTTP 选择，未通过真实 Claude 模型触发。

## 宿主验证：按授权未运行

既有只读宿主证据记录本机 Claude Code **2.1.177**、`loggedIn=false`；低于公开 `prompt_id` 合同的 **2.1.196+**。本票不升级、不索取凭据、不调用模型。因此真实宿主三样本收发、双会话、恢复历史、实际模型请求内容检查和真实浏览器图像事件均未运行，不能以本地 HTTP/MCP 测试替代。普通插件与预览 Channels 明确分开，本实现不依赖 Channels。

补验步骤（由已满足版本/认证的环境执行）：

1. 核对 Claude Code ≥2.1.196、已登录、Node ≥24；在对应平台重建并用 `claude --plugin-dir /绝对路径/amoji-claude` 加载候选包，保留正常权限策略。
2. 在两个独立会话运行 `/amoji:amoji`，分别点选三种样本，记录真实 Hook session_id/prompt_id/tool_use_id、同次 MCP 固定文字结果与精确版本；对照实际模型请求确认没有 image/base64 输入。
3. 请 AI 在不同用户回合用三样本回应；核对 scoped 工具名、Hook 修改后仍有原审批、同一 prompt_id 限量、面板目标、动图及暂停封面。记录真实浏览器图像 onload/onerror 和同消息显示回执。
4. 双会话交错操作，恢复同一真实 session；比较原 message_id/revision/素材，确认没有串会话或改用最新版本。保留成功及失败证据。

当前产物可通过 `plugins/amoji-claude` 及其 `BUILD.json` 检查。本机产物为 macOS arm64 / Node 24.19.0；Linux/Windows 启动分支未经实机验证。票据两分钟有效，过长审批需重新发起调用；服务重启时临时票据失效，持久消息不丢失。同用户恶意本地程序隔离、完整投递确认/故障恢复、Channels 和其他票据均不在本次范围。
