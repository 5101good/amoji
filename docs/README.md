# Amoji 文档

[English](README.en.md) · [项目首页](../README.md)

这里是 Amoji 1.0 的当前使用与开发入口。主要支持 dsh；Codex 与 Claude Code 为暂不验证的 legacy 适配。

| 想做什么 | 文档 |
| --- | --- |
| 安装、升级、备份和故障恢复 | [dsh 安装指南](dsh-installation.md) |
| 发送表情、创作、偏好、导入导出 | [使用指南](usage.md) |
| 理解固定语义、版本和投递状态 | [架构与协议](architecture.md) |
| 本地构建、测试和贡献 | [开发指南](development.md)、[贡献指南](../CONTRIBUTING.md) |
| 了解兼容范围与未验证项 | [发布与已知限制](release.md) |
| 阅读 1.0 发布正文 | [v1.0.0](releases/v1.0.0.md) |
| 报告安全问题 | [安全政策](../SECURITY.md) |
| 核对素材与许可 | [基础库](../assets/base-library/README.md)、[NOTICE](../NOTICE) |
| 核对本次发布验收 | [发布审计](release-audit.md) |

当前产品版本为 1.0.0；表情/包 Schema 仍为 `0.1`、共享 API 为 `2`、数据库为 `4`，版本号含义互相独立。[JSON Schema](specs/amoji-v0.1.schema.json)仍参与运行时校验。

当前对外指南提供中文默认与英文对应版。过时的研究、计划与分次验收文档已从当前源码移除；需要追溯时可查看 Git 历史。运行时使用的 Schema 和测试示例保留。
