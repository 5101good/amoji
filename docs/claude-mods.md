# Claude Desktop Mods

[English](claude-mods.en.md) · [文档首页](README.md)

此适配面向 **Claude Desktop → Code → 本地会话**。使用原生 AbovePrompt、Pane 和消息渲染，复用本机 Amoji 库。普通 Claude Chat/MCP Apps 是另一个宿主面；本指南不表示它已适配。

完整安装和使用步骤见[插件说明](../plugins/amoji-claude-mods/README.md)。当前源码有适配器，已发布的 v1.0.0 仍只包含 dsh；不要从旧标签推断包含 Claude 包。

## 三层边界

```text
Claude 原生 UI / Mods 事件 / 模型调用
          ↓ 纯 JSON 命令（stdin），真实会话和回合
src/claude-mods：宿主桥接、标记、缩略图、本地文件 IO
          ↓
src/application：交互用例、浏览分页、创建确认、建议输入/输出约束
          ↓ 公共客户端/端口
SharedClient → 共享服务 → LibraryStore / 不可变资产和消息
```

共享层不引用 Claude 的 `$`、控件、事件名、标记或模型 SDK；后续 Codex 可以复用用例，自己实现身份、呈现、提交与生成接口。dsh 继续使用其已验证的宿主协议，无须迁移数据。

Claude 的沙盒只能静态追踪同文件内的 `$` 调用，因此 `src/claude-mods/native/` 的可读模块被构建为单一 `hooks/register.js`。共享领域与 Node 代码没有被塞入这个受限环境。

## 双向消息

人工发送先通过共享服务按请求 ID 创建冻结消息，再调用 `$.prompt.submit`；只有文字标记和固定语义进入会话。AI 工具只接受查询或本回合选择凭据，真实 session/turn 从宿主事件取得；子代理不能借主回合发送。

渲染器仅将同会话、同方向的已存消息标记变成图像，普通文字仍保留。未知、伪造、跨会话和被改写的人工消息保持原文。历史引用冻结版本，不随画风、归档或新版本变化。

图片通过最多 8,500 字符的本地 SVG 缩略图呈现，每页 6 项；不向模型发送图片。动画使用静态封面。提交拒绝、结果未知、服务冲突都显示错误，不自动重试可能已经生效的操作。

## 验证和限制

- `npm test`：共享用例、持久化、隔离、媒体与桥接行为。
- `npm run test:claude`：官方 Mods strict validate 与控件/事件测试，测试不请求模型。
- `npm run test:claude-artifact`：安装实际包内锁定依赖，以隔离数据目录启动实际服务并读取基础库和缩略图。
- 真机验收需单独观察 Claude Desktop 中的选图、发送、模型工具回赠、两侧图片、创建预览与确认、偏好和导入导出。测试工具不等于屏幕绘制。

Mods 没有公开文件选择器，文件输入采用本地路径。UI 语言跟随 `settings.language`，未设置时中文；Desktop 应用自身的语言设置不在此 API 中。模型选项使用当前模型、Claude 别名及自定义 ID，由宿主校验可用性，不声称获得完整模型目录。

构建目录 `.cache/claude-mods` 是一个本地 marketplace。分发包为可移植 ZIP，依赖按锁文件安装，未捆绑 Sharp/libvips。CI 构建、检查后追加到 GitHub Release 的统一校验和与 provenance，实际发布只发生于显式推送版本标签。


## 当前验收状态

Claude Desktop 2.31226.1、内置 Claude Code 2.1.295 的本地会话已观察到输入区入口、双列表情缩略图、名称按钮直接发送、人工消息图片重绘，以及 Haiku 5.5 对固定文字语义的真实回应。重新加载插件后，已发送消息仍能重绘。

AI 工具回赠、真实 AI 文字建议和管理流程的完整真机验收尚未完成；自动化覆盖不替代这些观察。当前使用有明确名称的原生按钮发送。图片点击控件的真实命中尚未证实，因此未启用，也不将测试环境的模拟点击当作完成。
