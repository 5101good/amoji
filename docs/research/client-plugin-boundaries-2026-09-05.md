# Codex / Claude Code 插件接入边界

日期：2026-09-05。范围：官方文档和本次 Codex Desktop 会话的宿主约定。未安装或运行 Amoji 插件，未测试图片投递、会话绑定或模型请求。

## 判断方法

- **文档确认**：官方资料明确描述某个扩展机制，不代表 Amoji 已实现。
- **当前宿主约定**：本次会话可用的能力，不代表第三方插件拥有同样 API。
- **方案推导**：拟采用的实现方式，需要真实客户端验证。
- **待验证**：没有足够证据承诺该能力。

## 边界矩阵

| 对象 | 已知依据 | 对 Amoji 的含义 |
|---|---|---|
| OpenAI 插件 | 文档确认插件可结合 Skills、MCP 和可选 UI；具体能力可能随客户端不同 | 共享工具层可设计，不能推断所有界面开放任意选择器 |
| Codex Desktop 图片 | 当前会话允许 Markdown 引用本地绝对路径图片 | 可研究视觉输出；不证明第三方原生组件注册、输入框接入或回放时无图像输入 |
| Codex CLI | 插件和文本工具路径有依据 | 原生图片气泡、HTML 面板及表情输入扩展仍待验证 |
| Claude Code 插件 | 文档确认 Skills、Hooks、MCP 等组件 | 可封装文本语义工具；任意会话图片 renderer 不是已确认插件合同 |
| Claude Code MCP | 插件可自带 MCP server，并提供模型工具 | 工具返回成功不等于用户界面已显示 |
| Claude channels | 文档确认双向通道与配套 web UI 示例 | 可研究外部面板会话输入，但不能作为所有用户默认可用的前提 |
| 终端与 IDE | 图形界面或终端图像协议各有能力 | 必须逐个宿主形态验证，不能由外壳能力推断插件能力 |

OpenAI 插件组合及客户端差异依据：[Plugin architecture](https://developers.openai.com/plugins/concepts/plugins)。Claude 插件与 MCP 组件依据：[Plugins reference](https://code.claude.com/docs/en/plugins-reference)。

## UI 与模型数据必须分开

OpenAI UI 指南明确描述 ChatGPT iframe 与 MCP Apps bridge，适配器必须先确认目标 Codex 客户端是否实现所需能力，不能直接套用。依据：[Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)。

OpenAI UI reference 中，`content` 与 `structuredContent` 对模型可见，`_meta` 用于组件侧数据。Amoji 的固定语义应进入模型可见文本；素材展示由人类投影处理。这个宿主规则不是 Claude 或所有客户端的通用保证。依据：[Tool results](https://developers.openai.com/plugins/reference#tool-results)。

本次 Codex 宿主允许图片 Markdown，但没有验证其后续模型请求与回放处理。不调用识图工具只是必要条件，最终还要检查真实请求是否被宿主自动加入图像内容。

## Claude channels 的适用限制

channels 仍有研究预览的分发门槛；自定义通道可能需要开发标志或组织允许名单。官方 fakechat 示例说明可做 web UI 与 reply tool 的双向通道，不能由此声称普通插件安装即可启用任意自定义通道。依据：[Channels reference](https://code.claude.com/docs/en/channels-reference)。

首版主路线不依赖开发允许名单绕过。若使用 channels，须记录用户环境的真实可用条件，以及通知接收、处理和显示的独立证据。

## 技术验证结论

优先验证“面板选择 → 当前宿主会话收到文本语义 → AI 选择 → 面板/会话显示正确图片”。验证中必须包含两个同期开启的会话，防止把工作目录、进程或最近活跃窗口误当作目标会话。

当前结论是：统一语义协议与共享工具层具备设计依据；三端完整视觉交互尚未验证。具体方案见[三端技术设计](../design/architecture-v0.1.md)，dsh 证据见[固定源码调研](deepseek-dsh-plugin-research-2026-09-05.md)。

