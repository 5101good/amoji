# 票据 01：可操作浏览器面板地址探针报告

日期：2026-09-15。

## 状态

开发探针改进已实现并提交；真实模型与浏览器验收由根代理执行，本报告不把静态检查记为票据 01 的真实通过证据。

## 提交

- 实现提交：`beec133`（`test: expose live Amoji panel URL for browser probe`）
- 修改文件：`scripts/probes/live-tools.mjs`
- 本报告在后续独立提交中加入，便于报告引用已确定的实现提交哈希。

## 实现

- `AMOJI_PROBE_PICK=1 AMOJI_PROBE_EMIT_FIRST=1` 启用 emit-first 调试模式。提示要求真实模型先按 `AMOJI_REPLY_QUERY` 执行 `amoji_search` 和一次 `amoji_emit`，再执行 `amoji_pick` 等待人类视觉选择，最后只根据返回的固定文字语义作文字回应。
- 默认 pick-first、非 pick 纯文本、resume、`AMOJI_CODEX_BIN`、安装版发现、临时数据目录和原有超时分支仍沿用原路径。
- 流式收到 `item.completed` 后，只检查 `server=amoji`、`tool=amoji_emit` 的成功结果；从 text content 中解析 JSON，并验证 `panel_url` 为带端口和 capability fragment 的 `http://127.0.0.1/...` 面板根路径。
- 合法结果会立即输出一行 `amoji.panel_ready` JSON，只含 `panel_url` 与 `message_id`。该分支不输出 `selection_token`、认证头或其他结果字段；默认模式不输出 `panel_url`。
- JSON 行、tool result 或 URL 畸形时直接忽略该事件，继续处理子进程输出。新增模式必须成功提取面板进度，且 Amoji 调用按 `search → emit → pick` 完成、`amoji_emit` 总调用数恰好为一次、相关调用没有失败，才可能判为通过。

## 检查

- `node --check scripts/probes/live-tools.mjs`：通过。
- `git diff --check`：通过。
- 提交前 staged path 仅有 `scripts/probes/live-tools.mjs`。
- 构造参数复核：emit-first 仅在两个环境开关同时为 `1` 时生效；默认 pick-first prompt 未改；resume 在 pick 模式复用所选 prompt；安装版和非安装版的 MCP 配置分支未移除；指定引擎和隔离数据目录仍原样传递。
- 日志边界复核：新增实时输出只有三项固定键；URL 只在 emit-first 模式出现；原始 events、stderr 和脱敏 wire 记录仍只写既有临时运行目录，没有新增持久日志或仓库证据文件。
- 对照 Codex 官方 JSONL 事件测试核对了 MCP 完成项的 `server`、`tool`、`status` 和 `result.content[].text` 结构：<https://github.com/openai/codex/blob/main/codex-rs/exec/src/event_processor_with_jsonl_output_tests.rs>。

## 已知限制

- 按 brief 未启动真实模型，因此尚未现场证明当前 Codex 版本会依序执行三次工具调用、实时进度能被根代理消费，或面板能被 CUA 打开并完成视觉点击。
- 当前产品面板服务明确监听 `127.0.0.1` 且入口路径为 `/`，探针据此拒绝其他主机和路径；未来若产品面板改用另一种 loopback 表示或入口路径，探针需同步调整。
- `panel_url` 含临时本机 capability，只应从实时标准输出交给本次 CUA 会话；不得复制到持久文档或验收资产。本报告不含任何实际 URL。
- 没有新增复述实现的单测；验证范围遵循 brief，限于语法、差异、分支构造和日志边界静态复核。
