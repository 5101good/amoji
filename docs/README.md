# Amoji 文档

[English](README.en.md) · [项目首页](../README.md)

这里是 Amoji 2.0.0 的使用与开发入口，涵盖 dsh 与 Claude Desktop Code 本地会话。旧 Codex/Claude hook 适配器仍为 legacy；各宿主的验证范围见对应指南。

| 想做什么 | 文档 |
| --- | --- |
| 安装、从 1.x 升级、备份和故障恢复 | [dsh 安装指南](dsh-installation.md) |
| Claude Desktop Code 原生表情 | [Mods 适配指南](claude-mods.md) |
| 发送表情、创作、偏好、导入导出 | [使用指南](usage.md) |
| 理解固定语义、版本和投递状态 | [架构与协议](architecture.md) |
| 阅读当前表情协议 | [Amoji 0.1 RFC](specs/amoji-0.1-rfc.md) |
| 让 AI 创作整套 0.1 表情包 | [Amoji Studio 创作 skill](../plugins/amoji-studio/README.md) |
| 本地构建、测试和贡献 | [开发指南](development.md)、[贡献指南](../CONTRIBUTING.md) |
| 了解兼容范围、发布流程与未验证项 | [发布与已知限制](release.md) |
| 阅读当前发布正文 | [v2.0.0](releases/v2.0.0.md) |
| 追溯历史发布 | [v1.1.0](releases/v1.1.0.md)、[v1.0.0](releases/v1.0.0.md)、[1.0 发布审计](release-audit.md) |
| 报告安全问题 | [安全政策](../SECURITY.md) |
| 核对素材与许可 | [官方表情包](../assets/official-packs/README.md)、[NOTICE](../NOTICE) |

当前产品版本为 **2.0.0**，实现 [Amoji 0.1 协议](specs/amoji-0.1-rfc.md)（码位注册表 `0.1-r3`）；共享 API 为 `3`、数据库为 `1`，版本号含义互相独立。[JSON Schema](specs/amoji-0.1.schema.json) 与[码位注册表](specs/amoji-0.1.registry.json)参与运行时校验。1.x 包与数据库没有直接迁移路径。2.0.0 在同目录使用 `library-0.1.sqlite` 并保留旧 `library.sqlite`；升级前应关闭旧服务并备份完整目录，隔离试用时可另设数据目录。

当前对外指南提供中文默认与英文对应版。历史发布与验收记录保留其当时范围，不代表 2.0.0 最终发行包已通过相同检查；本次证据以对应提交、标签、工作流及验收记录为准。后续用户研究与实验建议见[验证材料](plans/amoji-0.1-backlog.md)，不作为已完成结论。
