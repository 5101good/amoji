# Amoji 规格文档

日期：2026-09-05。阶段：用户已确认产品共识；本文档集为首版规格与技术设计，尚无工程实现或客户端运行验收。

## 阅读顺序

完整功能与 Issue 正文见 [Amoji v0.1 Spec](specs/amoji-v0.1-spec.md)，按 to-spec 模板汇总了 64 条用户故事、实现与测试决策。用户已指定以 Codex 验证完整接入；其他宿主的验证工具不可用时，先完成实现并明确记录真机测试跳过。Issue Tracker 待配置，尚未发布或应用 `ready-for-agent` 标签。

[票据拆分修订稿](planning/ticket-breakdown-v0.1.md)包含 19 张票据方案、81 项验收条件，覆盖全部 64 条用户故事。主线调整为 01 Codex 接入 → 02 共享核心；03 Claude Code、04 dsh 的实现接在核心之后，工具缺失的真机验证不再阻塞主线。图片制作采用 Codex imagegen 技能；尚未正式发布票据或生成素材。

1. [产品规格 PRD](product/prd-v0.1.md)：产品原则、范围、用户流程和已确认决策。
2. [领域词汇](../CONTEXT.md)：表情、版本、消息和表情包的统一含义。
3. [数据协议](specs/amoji-protocol-v0.1.md)：固定语义、不可变版本、双投影和包格式。
4. [JSON Schema](specs/amoji-v0.1.schema.json)：版本、表情包清单和消息记录的结构约束。
5. [三端技术设计](design/architecture-v0.1.md)：共享运行时、工具接口、宿主适配和失败处理。
6. [验收与实施顺序](planning/acceptance-v0.1.md)：需求追踪、技术验证门槛和后续工作包。

## 证据与状态

- [dsh 深度调研](research/deepseek-dsh-plugin-research-2026-09-05.md)：固定源码提交、打包机制、工具和 Web UI 契约。
- [Codex / Claude Code 接入边界](research/client-plugin-boundaries-2026-09-05.md)：官方依据、推导与待实测项。
- [规格自检记录](planning/spec-review-v0.1.md)：文档与结构验证，不代表产品运行通过。

产品需求以用户确认的 PRD 为准；接口字段以协议及 Schema 为准；宿主能力以注明版本的官方证据和后续真实验收为准。技术文档中的工作方案、预算和默认值属于工程设计，可经验证调整，但不能悄悄削弱产品承诺。

本期必须验证 Codex 会话绑定、完整双向视觉、真实文本模型请求及全部产品行为。其他适配器完成实现与可执行检查；只有验证工具缺失才可跳过宿主实测，失败与跳过分别记录。具体开源许可证与内置视觉素材的分发许可须在公开发布前落实；当前未添加许可证或发布软件。
