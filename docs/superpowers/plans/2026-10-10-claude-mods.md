# Claude Desktop Mods 实施计划

Spec: docs/superpowers/specs/2026-10-10-claude-mods.md

Global Constraints: 中文默认及英文文档；三层解耦；现有 dsh 与共享库兼容；独立 worktree；低成本原生验收；不发布合并。

### Task 1: 共享交互用例与 Node 桥接

Interfaces: 提供 ExpressionApplication、Claude 桥接命令、session-only capability；复用 SharedClient 与现有 DTO。

1. 编写 tests/claude-mods-application.test.ts：真实服务下 idle 人工发送、真实回合 AI 选择与策略、会话隔离、冻结历史、消息标记验证、缩略图预算、草稿与包 IO。
2. 运行 npm run test:file -- tests/claude-mods-application.test.ts。Expected: 新模块缺失或新行为失败（RED）。
3. 实现分层用例与桥接。支持纯 JSON stdin 协议；文件大小、路径和禁止覆盖验证；模型工具结果不带图片。
4. 运行 npm run typecheck 与上述测试。Expected: 全部通过。
5. 提交实现，task-done 使用 npm test。Expected: 既有与新增测试通过。

### Task 2: 原生 Mods 界面与双向交互

Interfaces: 消费 Task 1 命令和 DTO；提供 hooks/register.js、交互状态、原生视图与工具。

1. 创建原生插件测试：入口、分页、点击直接发送、失败状态、模型工具上下文、消息重绘、偏好与创建操作。
2. 运行 claude plugin test plugins/amoji-claude-mods。Expected: 新行为失败（RED）。
3. 实现紧凑入口、原生 Pane、图片点击、搜索/库/创建/设置、模型选择建议、导入导出以及历史重绘；正确处理取消、并发与未知提交。
4. 构建并运行 strict validate、原生插件 tests。Expected: 无错误。
5. 提交实现，task-done 使用 npm test。Expected: 回归通过。

### Task 3: 包装、文档与回归

Interfaces: 消费 Task 1/2；提供可安装插件包、CI 构建入口和中英使用/架构文档。

1. 写插件包内容/路径/无开发依赖测试并验证 RED。
2. 实现可重复构建，生产依赖与资产、开源许可、元信息；更新 CI 与双语文档，不修改 dsh 发行行为。
3. 执行 npm run typecheck、npm test、npm run test:dsh、插件验证与构建。Expected: 全部通过。
4. 提交并记录各层验证证据。

### Task 4: Claude Desktop 原生验收与最终审查

Interfaces: 消费可安装产物；提供实际验收记录和已修复分支。

1. 隔离库与测试会话安装，原生窗口验证人→AI、AI 工具→人、历史、画风、草稿创建与 AI 建议、导入导出、错误恢复。Expected: 观察与 spec 一致；宿主限制明确记录。
2. 缺陷必须复现→失败测试→修复→对应回归，不重复跑无关测试。
3. 发起一个独立的全分支 reviewer，修复 Critical/Important 并重测。
4. 记录实际能力和剩余宿主限制。Expected: 不将模拟通过当作真机完成；不自动推送合并发布。
