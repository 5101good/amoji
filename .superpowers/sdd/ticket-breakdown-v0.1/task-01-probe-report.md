# 票据 01：可操作浏览器面板地址探针报告

日期：2026-09-15。

## 状态

开发探针改进及独立审查修复已实现并提交；真实模型与浏览器验收由根代理执行，本报告不把代码检查记为票据 01 的真实通过证据。

## 提交

- 实现提交：`beec133`（`test: expose live Amoji panel URL for browser probe`）
- 原报告提交：`0f7137e`（`docs: report Amoji browser probe change`）
- 审查修复提交：`b0eac53`（`test: reject extra Amoji probe calls`）
- 修改文件：`scripts/probes/live-tools.mjs`
- 审查修复辅助文件：`scripts/probes/live-tools-policy.mjs`、`scripts/probes/live-tools-policy.test.mjs`
- 本次报告更新随审查修复之后的独立文档提交交付，便于引用已确定的实现提交哈希。

## 实现

- `AMOJI_PROBE_PICK=1 AMOJI_PROBE_EMIT_FIRST=1` 启用 emit-first 调试模式。提示要求真实模型先按 `AMOJI_REPLY_QUERY` 执行 `amoji_search` 和一次 `amoji_emit`，再执行 `amoji_pick` 等待人类视觉选择，最后只根据返回的固定文字语义作文字回应。
- 默认 pick-first、非 pick 纯文本、resume、`AMOJI_CODEX_BIN`、安装版发现、临时数据目录和原有超时分支仍沿用原路径。
- 流式收到 `item.completed` 后，只检查 `server=amoji`、`tool=amoji_emit` 的成功结果；从 text content 中解析 JSON，并验证 `panel_url` 为带端口和 capability fragment 的 `http://127.0.0.1/...` 面板根路径。
- 合法结果会立即输出一行 `amoji.panel_ready` JSON，只含 `panel_url` 与 `message_id`。该分支不输出 `selection_token`、认证头或其他结果字段；默认模式不输出 `panel_url`。
- JSON 行、tool result 或 URL 畸形时直接忽略该事件，继续处理子进程输出。新增模式必须成功提取面板进度，且相关 Amoji 调用的完整序列精确等于一次 `search → emit → pick`，三个调用全部成功，才可能判为通过。

## 审查修复

独立审查发现首版用 `indexOf` 检查成功子序列，会把 `pick,search,emit,pick` 和 `search,pick,emit,pick` 错记为通过。修复后只从 Amoji 完成项中选取 `amoji_search`、`amoji_emit`、`amoji_pick` 三种相关调用，并对完整数组做长度、顺序及逐项成功比较；重复 `search`、`emit` 或 `pick` 均拒绝。其他 server 和不相关 Amoji 工具不参与该序列。

实时 `panel_ready` 与最终 `passed` 现在共同调用 `isSuccessfulAmojiCall`，成功定义不会在两处独立演变。

## 检查

- `node --check scripts/probes/live-tools.mjs`：通过。
- `node --check scripts/probes/live-tools-policy.mjs` 和 `node --check scripts/probes/live-tools-policy.test.mjs`：通过。
- `node --test scripts/probes/live-tools-policy.test.mjs`：3 项通过；覆盖精确成功序列、审查给出的两种假阳性、三个重复调用负例、非 Amoji server 及失败结果。
- `git diff --check`：通过。
- 初始实现提交前 staged path 仅有 `scripts/probes/live-tools.mjs`；审查修复提交仅含三个 `scripts/probes/live-tools*` 文件。根代理的未跟踪验收证据未纳入提交。
- 构造参数复核：emit-first 仅在两个环境开关同时为 `1` 时生效；默认 pick-first prompt 未改；resume 在 pick 模式复用所选 prompt；安装版和非安装版的 MCP 配置分支未移除；指定引擎和隔离数据目录仍原样传递。
- 日志边界复核：新增实时输出只有三项固定键；URL 只在 emit-first 模式出现；原始 events、stderr 和脱敏 wire 记录仍只写既有临时运行目录，没有新增持久日志或仓库证据文件。
- 对照 Codex 官方 JSONL 事件测试核对了 MCP 完成项的 `server`、`tool`、`status` 和 `result.content[].text` 结构：<https://github.com/openai/codex/blob/main/codex-rs/exec/src/event_processor_with_jsonl_output_tests.rs>。
- 对已有三次真实运行 `amoji-live-S0v6BI`、`amoji-live-NOCiBa`、`amoji-live-Cllw8Z` 做脱敏事件回放：只读取并输出 Amoji 工具名，三者均为精确 `amoji_search,amoji_emit,amoji_pick`，新判定均接受。回放没有输出工具结果、`selection_token`、`panel_url` 或原始 context，也没有启动新模型调用。

## 已知限制

- 本修复没有再次启动真实模型；三份既有日志只能证明已完成回合能通过新判定，实时进度消费和 CUA 视觉结论仍以根代理本轮验收记录为准。
- 当前产品面板服务明确监听 `127.0.0.1` 且入口路径为 `/`，探针据此拒绝其他主机和路径；未来若产品面板改用另一种 loopback 表示或入口路径，探针需同步调整。
- `panel_url` 含临时本机 capability，只应从实时标准输出交给本次 CUA 会话；不得复制到持久文档或验收资产。本报告不含任何实际 URL。
- 新增测试只覆盖独立策略函数的可观察真假判定，不启动探针子进程，不调用模型，也不复制产品运行时实现。
