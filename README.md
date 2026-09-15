# Amoji

让人看见图像，让 AI 使用同一表情的固定文字语义。当前已实现 **共享本地服务和 Codex、Claude Code、dsh 三端适配**，仍使用三个受控样本，不是完整 v0.1 产品。实现、可执行检查和真实宿主验证分别记录在 [实现状态](docs/planning/implementation-status-v0.1.md)。

已实现静态图、短循环 WebP、文字检索与精确版本解析、绑定会话/回合的选择凭据、幂等发送、本地选择面板和 Codex 插件包。独立共享服务统一保存不可变版本、当前库条目、素材、消息快照、展示回执和选择凭据；MCP 进程通过公共客户端访问。多个适配器使用相同库，消息按可信宿主实例与会话隔离。三端用户入口和AI工具使用同一中文检索，候选保留完整语义并受8KiB文本预算限制；无匹配返回空结果，详见[搜索与待验记录](docs/validation/search-ticket-05.md)。公共接口与后续适配方法见 [共享服务合同](docs/specs/shared-service-v0.1.md)。

## 开发与验证

本次环境：macOS arm64、Node.js 24.19.0。锁文件记录依赖。其他 OS 尚未验证。

```sh
npm ci
npm run typecheck
npm run build
npm test
node scripts/build-plugin.mjs
```

插件产物位于 `plugins/amoji`。其中 `runtime`、`assets`、`web` 和 `.mcp.json` 为生成产物，包含共享服务入口和全部运行依赖。构建保留依赖的相对链接；独立产物测试在临时目录、未提供开发素材路径的条件下执行真实 MCP 收发及面板取图。当前 Codex 插件加载路径不展开 MCP 参数中的 `${PLUGIN_ROOT}`，因此构建脚本按目标目录和当前 Node 路径生成启动配置。**不能直接把已生成目录搬到另一台机器；应在目标机器运行 `npm ci`、构建和下面的安装流程。**

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

插件包含四个工具：`amoji_search`、`amoji_resolve`、`amoji_emit` 和用户入口 `amoji_pick`。前三个为日常表达工具；第四个沿用已确认的 `/amoji → 选择器 → 同次工具返回` 控制路径，已纳入 Spec。票据 01 在安装版 Codex Desktop 的接入证据见 [2026-09-15 验证](docs/validation/codex-ticket-01-2026-09-15.md)；共享服务改造后的安装版 Desktop 验收另行执行。

在已加载插件的新会话中调用 `amoji` 技能或要求“打开 Amoji 表情选择器”。模型调用 `amoji_pick` 后打开默认浏览器，用户预览固定语义并点选发送。同一次 MCP 调用把文字交给原会话。AI 发送的图片在面板显示，并返回可用于 Codex Markdown 的本地图片路径。

模型输入不接受会话 ID、图像路径或语义覆盖。会话和回合取自实测的 Codex MCP `_meta.x-codex-turn-metadata`。元数据缺失或不一致时明确失败。

工具 `pending` 不代表宿主已经确认记录。面板仅在图片加载后记录同一消息 ID 的展示回执；HTTP 成功与显示成功都不会把宿主状态改成 `acknowledged`。适配器退出时关闭自己的面板和待选请求；其他连接继续使用服务，最后一个连接离开后服务默认空闲 60 秒退出。

macOS 默认数据目录继续使用 `~/Library/Application Support/Amoji/prototype`，保留原命名以兼容已发本地图片引用。新服务写入 `library.sqlite` 与 `blobs/`；首次启动只读复制旧 `messages.sqlite` 和 `samples/` 中的数据，原文件保留且不改写。以后以共享库为准，不反复从旧原型合并。测试可用 `AMOJI_DATA_DIR` 隔离。重新关联同一真实会话后可读取完整消息与固定视觉；旧面板能力凭据失效。编辑、完整故障恢复和升级/卸载界面仍属于后续票据。

## Claude Code 适配

Claude Code 普通插件复用同一个共享服务和面板，通过 PreToolUse Hook 将可信会话、回合与调用关联到 MCP；模型只收到固定文字语义。其独立插件构建命令为 `node scripts/build-claude-plugin.mjs`，默认生成 `plugins/amoji-claude`，与 Codex 使用各自的启动配置。

Hook、MCP、面板和独立产物已执行本地合同检查；**真实 Claude 宿主尚未验证**。完整适配要求 Claude Code 2.1.196+ 的公开 `prompt_id` 合同，本机2.1.177未登录，按用户授权跳过真机。构建与使用步骤见 [Claude 插件说明](plugins/amoji-claude/README.md)，检查范围及补验条件见 [03 验证记录](docs/validation/claude-ticket-03.md)。

## dsh 适配

dsh 分发包包含实际 Host/Client 双入口：Host 将三个日常工具映射到共享核心，Client 提供选择器、工具视觉和历史呈现。模型只接收固定文字投影，用户图像读取与精确版本关联；运行时不识图。

```sh
npm run build:dsh
npm run test:dsh
```

`build:dsh` 构建 `adapters/dsh`；`test:dsh` 显式准备固定提交的源码基线，再执行真实 `defineTool`/`SlotCore` 与 loader/组件合同检查，首次准备需要网络和 `curl`。普通 `npm test` 不含此下载前置。构建与使用见 [dsh 插件说明](adapters/dsh/README.md)。**完整 dsh 宿主未验证**；Session/Connection 测试端口和 JSDOM 图片事件不能证明原生持久化、浏览器解码或模型请求。边界与补验步骤见 [04 验证记录](docs/validation/dsh-ticket-04.md)。

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

完整范围见 [Spec](docs/specs/amoji-v0.1-spec.md)、[票据](docs/planning/ticket-breakdown-v0.1.md) 和 [实现状态](docs/planning/implementation-status-v0.1.md)。当前尚未实现完整创作/导入导出及用户设置；24个基础表情的视觉/语义草稿已制作，仍待正式包集成、许可与完整验收。Linux/Windows 仅有路径解析实现，未经实际宿主运行验证。
