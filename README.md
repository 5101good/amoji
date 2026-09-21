# Amoji

[English](README.en.md) · [文档](docs/README.md) · [安装](docs/dsh-installation.md)

**面向人和 AI 的表情。人看图，AI 读固定语义。**

Amoji 为 dsh 提供原生表情选择器、双向消息展示和个人表情库。同一张表情有明确的含义、语气、适用场景与文字回退；模型通过文字检索和选择表情，不需要识图。

- **双向表达**：用户点选即可发送，AI 通过 `amoji_search`、`amoji_resolve`、`amoji_emit` 使用同一套固定语义。
- **两套画风**：经典、办公各覆盖相同的 24 个语义，共 48 个资产。切换画风不改变旧消息。
- **自己创作**：上传图片、填写语义，或用一个意图输入框生成 AI 文字建议。模型可选，默认当前会话模型；采用后仍可编辑，保存并预览确认后才入库。
- **本地管理**：草稿、版本、归档、个人副本、完整 `.amoji` 包导入导出和 AI 使用偏好。
- **中英界面**：跟随 dsh 的界面语言。界面翻译不改写表情本身保存的语义；内置语义目前为中文。

<p align="center"><img src="assets/samples/source/celebrate.png" alt="Amoji 经典角色：一起庆祝" width="160" /></p>

## 安装

1. 使用 Node.js **24 或更新版本**。当前验证基线为 **dsh 0.1.5-rc.2 / macOS arm64**。
2. 从 [GitHub Releases](https://github.com/5101good/amoji/releases) 下载 `amoji-dsh-1.0.0.tgz`，按同次发布的 `SHA256SUMS` 核对 SHA-256。
3. 安装到自己的 dsh profile，重启该 profile，选择工作区后打开输入区的“表情”。

```sh
npx @deepseek-ai/dsh@0.1.5-rc.2 plugin --profile amoji add ./amoji-dsh-1.0.0.tgz --ignore-scripts
npx @deepseek-ai/dsh@0.1.5-rc.2 --profile amoji
```

`amoji` 是示例 profile 名称；使用已有 profile 时替换它。源码安装参见[构建步骤](docs/dsh-installation.md)。插件安装成功与运行激活是两项不同检查。

## 使用

在选择器中搜索并点选表情即可发送；详情按钮用于先阅读固定语义。在“管理表情”中切换画风、调整 AI 语气与频率、管理自己的素材。AI 表情可独立暂停。

创作时描述“谁对谁说、什么情境、想表达什么、什么语气”，选择模型后生成建议。Amoji 只向所选模型发送文字意图和生成指令，不发送图片或会话历史。生成按宿主所配置模型的规则计费；也可以完全手工填写。建议不会自动保存或入库。

[完整使用指南](docs/usage.md)涵盖草稿确认、编辑旧版本、导入导出、连接恢复及发送状态。

## 验证与边界

1.0 以 dsh 为主要支持宿主。已有 macOS arm64 的本地安装、实际浏览器使用及一次真实 Flash 文字建议成功记录；这些证据不代表所有模型、平台或宿主版本均通过。一次 AI 发送测试的表情已成功显示，但提供方工具续答因 `reasoning_text` 兼容问题返回 HTTP 400，不能算完整模型回合成功。

Linux、Windows 和其他 dsh 版本未完成真实宿主验收。Code Dispatch / PTC 嵌套工具不保证图片展示。Codex、Claude Code 实现作为 legacy 保留，暂不纳入 1.0 真机验证或兼容承诺。详见[发布与已知限制](docs/release.md)。

## 开发与贡献

```sh
npm ci
npm run typecheck
npm test
npm run test:dsh
```

`test:dsh` 会构建插件并检查锁定的 dsh npm 合同。构建输出为 `adapters/dsh`。[开发指南](docs/development.md)、[架构与协议](docs/architecture.md)、[贡献指南](CONTRIBUTING.md)和[安全政策](SECURITY.md)说明开发、验证与报告问题的方法。

代码和技术文档使用 [MIT](LICENSE)；内置基础表情视觉、固定语义及生成提示使用 [CC0-1.0](assets/base-library/LICENSE)。生成来源见[基础库说明](assets/base-library/README.md)。第三方依赖、用户素材保留各自许可，见 [NOTICE](NOTICE)。
