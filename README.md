# Amoji

让人看见图像，让 AI 使用同一表情的固定文字语义。当前提交是 **v0.1 票据 01 的 Codex 三样本接入小样**，不是完整 v0.1 产品。

已实现静态图、短循环 WebP、文字检索与精确版本解析、绑定会话/回合的选择凭据、幂等发送、本地选择面板和 Codex 插件包。样本为只读库，消息与凭据暂存在插件进程内。

## 开发与验证

本次环境：macOS arm64、Node.js 24.19.0。锁文件记录依赖。其他 OS 尚未验证。

```sh
npm ci
npm run typecheck
npm run build
npm test
node scripts/build-plugin.mjs
```

插件产物位于 `plugins/amoji`。其中 `runtime`、`assets` 和 `web` 为生成目录；更换机器后在插件的 `runtime` 目录运行 `npm ci --omit=dev` 以安装匹配平台的依赖。不要依赖开发者机器的原仓库路径。

`scripts/build-samples.mjs` 从已经保存的 imagegen 原始图重新封装三个固定样本，不调用图像生成服务。生成提示与来源见 [generation.json](assets/samples/generation.json)。样本分发许可尚未确定，不宣称已完成开源发布。

## Codex 接入小样

插件包含四个工具：`amoji_search`、`amoji_resolve`、`amoji_emit` 和实验用户入口 `amoji_pick`。前三个为原设计日常工具；第四个是因 Desktop 直接会话输入 API 尚未确认而制作的可审阅备选方案，尚待用户确认纳入正式 Spec。

在已加载插件的新会话中调用 `amoji` 技能或要求“打开 Amoji 表情选择器”。模型调用 `amoji_pick` 后打开默认浏览器，用户预览固定语义并点选发送。同一次 MCP 调用把文字交给原会话。AI 发送的图片在面板显示，并返回可用于 Codex Markdown 的本地图片路径。

模型输入不接受会话 ID、图像路径或语义覆盖。会话和回合取自实测的 Codex MCP `_meta.x-codex-turn-metadata`。元数据缺失或不一致时明确失败。

工具 `pending` 不代表用户已经看见。面板在图片实际加载后记录展示回执；CLI 退出会终止面板服务，已加载内容保留在网页，但不能继续发送。重启后的共享库、历史留存、断线重试和交付状态机仍由后续票据实现。

## 实测脚本

这些脚本会使用本机 Codex 登录状态发起真实模型调用。仅观测调用结构，不保存认证头或原始模型请求。

```sh
node scripts/probes/codex.mjs
node scripts/probes/live-tools.mjs
AMOJI_PROBE_PICK=1 node scripts/probes/live-tools.mjs
AMOJI_USE_PLUGIN=1 node scripts/probes/live-tools.mjs
AMOJI_RESUME_THREAD=<测试会话ID> node scripts/probes/live-tools.mjs
```

可通过 `AMOJI_CODEX_BIN` 指定被测二进制。`codex.mjs` 只对自带的只读观测 Hook 使用该次运行的 Hook 信任测试标志；不修改全局 Hook 信任配置。真实表情测试仅对 Amoji 的本地发送/选图工具设置该次调用的允许规则。

只看到进程退出码为 0 不代表工具成功。需要检查输出中的工具状态与请求计数。原始调用事件只保留在临时测试目录；仓库中的 [验收证据](docs/validation/codex-ticket-01.md) 是去除本地能力凭据后的摘要。

完整范围见 [Spec](docs/specs/amoji-v0.1-spec.md)、[票据](docs/planning/ticket-breakdown-v0.1.md) 和 [实现状态](docs/planning/implementation-status-v0.1.md)。当前尚未实现共享持久库、创作/导入导出、用户设置、Claude Code / dsh 适配及 20–30 个基础表情。
