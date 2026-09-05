# Amoji

让人看见图像，让 AI 使用同一表情的固定文字语义。当前提交是 **v0.1 票据 01 的 Codex 三样本接入小样**，不是完整 v0.1 产品。

已实现静态图、短循环 WebP、文字检索与精确版本解析、绑定会话/回合的选择凭据、幂等发送、本地选择面板和 Codex 插件包。样本为只读目录；双向消息快照、展示回执与不可变版本登记保存在 SQLite，素材保存在独立数据目录。短期选择凭据不跨进程保存。

## 开发与验证

本次环境：macOS arm64、Node.js 24.19.0。锁文件记录依赖。其他 OS 尚未验证。

```sh
npm ci
npm run typecheck
npm run build
npm test
node scripts/build-plugin.mjs
```

插件产物位于 `plugins/amoji`。其中 `runtime`、`assets`、`web` 和 `.mcp.json` 为生成产物。当前 Codex 插件加载路径不展开 MCP 参数中的 `${PLUGIN_ROOT}`，因此构建脚本按目标目录和当前 Node 路径生成启动配置。**不能直接把已生成目录搬到另一台机器；应在目标机器运行 `npm ci`、构建和下面的安装流程。**

个人市场开发安装（需要已安装的官方 `plugin-creator` 技能及其 helper）：

```sh
python3 ~/.codex/skills/.system/plugin-creator/scripts/read_marketplace_name.py
node scripts/build-plugin.mjs "$HOME/plugins/amoji"
python3 ~/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py "$HOME/plugins/amoji"
codex plugin add amoji@personal
```

本机 helper 返回的市场名是 `personal`；若返回其他名称，替换安装命令中的市场名。初次在其他机器建立市场条目时，先使用官方 plugin-creator 的 scaffold 流程。已安装插件的启动配置引用 `~/plugins/amoji` 中的本地运行时，因此要保留该目录；移动目录或更换 Node 后重新构建并安装。新会话才能可靠加载更新。本期产物是 macOS 本地安装小样，还不是无需安装器的跨平台发布包。

`scripts/build-samples.mjs` 从已经保存的 imagegen 原始图重新封装三个固定样本，不调用图像生成服务。生成提示与来源见 [generation.json](assets/samples/generation.json)。样本分发许可尚未确定，不宣称已完成开源发布。

## Codex 接入小样

插件包含四个工具：`amoji_search`、`amoji_resolve`、`amoji_emit` 和实验用户入口 `amoji_pick`。前三个为原设计日常工具；第四个是因 Desktop 直接会话输入 API 尚未确认而制作的可审阅备选方案，尚待用户确认纳入正式 Spec。

在已加载插件的新会话中调用 `amoji` 技能或要求“打开 Amoji 表情选择器”。模型调用 `amoji_pick` 后打开默认浏览器，用户预览固定语义并点选发送。同一次 MCP 调用把文字交给原会话。AI 发送的图片在面板显示，并返回可用于 Codex Markdown 的本地图片路径。

模型输入不接受会话 ID、图像路径或语义覆盖。会话和回合取自实测的 Codex MCP `_meta.x-codex-turn-metadata`。元数据缺失或不一致时明确失败。

工具 `pending` 不代表用户已经看见。面板在图片实际加载后记录展示回执；CLI 退出会终止面板服务，已加载内容保留在网页，但不能继续发送。默认数据目录为 `~/Library/Application Support/Amoji/prototype`，测试可用 `AMOJI_DATA_DIR` 隔离。重新关联同一会话后，面板可读取原消息的完整定义与视觉快照；旧面板能力凭据失效。用户可编辑共享库、跨进程投递重试和完整交付状态机仍未实现。

## 实测脚本

这些脚本会使用本机 Codex 登录状态发起真实模型调用。仅观测调用结构，不保存认证头或原始模型请求。

```sh
node scripts/probes/codex.mjs
node scripts/probes/live-tools.mjs
AMOJI_PROBE_PICK=1 node scripts/probes/live-tools.mjs
AMOJI_USE_PLUGIN=1 node scripts/probes/live-tools.mjs
AMOJI_RESUME_THREAD=<测试会话ID> node scripts/probes/live-tools.mjs
```

可通过 `AMOJI_CODEX_BIN` 指定被测二进制、`AMOJI_REPLY_QUERY` 指定双向测试中 AI 检索的文字。每个探针默认使用临时数据目录；重开同一会话的面板时，同时传入原来的 `AMOJI_DATA_DIR` 和 `AMOJI_PROBE_PICK=1`。`codex.mjs` 只对自带的只读观测 Hook 使用该次运行的 Hook 信任测试标志；不修改全局 Hook 信任配置。真实表情测试仅对 Amoji 的本地发送/选图工具设置该次调用的允许规则。安装版探针保留宿主的安装发现配置，因此其他已配置 MCP 也可能启动；只将实际 Amoji 调用计入成功。

探针要求预期工具成功且实际请求中图像输入为零，单有 Codex 进程退出码 0 不会通过。原始调用事件只保留在临时测试目录；仓库中的 [验收证据](docs/validation/codex-ticket-01.md) 是去除本地能力凭据后的摘要。

完整范围见 [Spec](docs/specs/amoji-v0.1-spec.md)、[票据](docs/planning/ticket-breakdown-v0.1.md) 和 [实现状态](docs/planning/implementation-status-v0.1.md)。当前尚未实现共享持久库、创作/导入导出、用户设置、Claude Code / dsh 适配及 20–30 个基础表情。
