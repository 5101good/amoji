# Amoji · Claude Desktop Mods

[English](README.en.md) · [开源项目](https://github.com/5101good/amoji)

人看图，AI 读固定语义。在 **Claude Desktop 的 Code 页签、本地会话**中，使用原生表情面板、双向图片消息、个人库和 AI 辅助创建。

需要支持 Mods 的 Claude Code（验证基线 2.1.295+）以及 Node.js 24+。普通 Chat、Cowork 和云端会话不属于此适配器。终端提供纯文字降级，图片体验以 Desktop 为准。

## 安装

本源码适配器尚未随 v1.0.0 发布。使用当前分支构建，或在后续 GitHub Release 中下载 `amoji-claude-mods-<版本>.zip`。解压后得到 `.claude-plugin/` 和 `plugin/`；保留完整目录。

在解压目录执行：

```sh
npm ci --prefix ./plugin/runtime --omit=dev --ignore-scripts
claude plugin marketplace add .
```

进入需要使用 Amoji 的项目目录，再安装到该项目的个人范围：

```sh
claude plugin install amoji@amoji-desktop --scope local
```

重开 Code 会话，或按宿主提示运行 `/reload-plugins`。Desktop 首次启动会话时可能先显示命令未识别提示，待插件入口出现后用原生按钮打开；不要将它当作普通模型提示反复发送。输入区的 `☺ Amoji` 按钮和 `/amoji` 都可打开面板。若此前安装旧版 `amoji` Claude 原型，请先停用该旧插件，避免同名命令和工具冲突。

依赖按锁文件从 npm 获取，分发 ZIP 不含本机二进制和 node_modules。CLI 与 Desktop 本地会话共用插件设置；从项目范围开始可避免影响其他工作区。

## 使用

- **表情**：按名称或语义搜索，按 Enter 更新结果。点击表情名称直接发送，不必再按会话发送按钮。含义入口可检查固定语义。
- **个人库**：查看条目、归档或恢复、为个人条目创建新版本、复制内置表情、选择包版本。历史消息保留发送时的图片与语义。
- **创建**：一个意图输入框，模型默认当前会话模型，可选别名或自定义模型 ID。AI 只读这段文字，无图片或聊天记录；建议需主动采用，再编辑和核对。也可直接手工填写。
- **图片与表情包**：粘贴本地绝对路径（支持 `~/`）。图片支持 PNG、JPEG、WebP、GIF，上限 10 MiB；预览成功并勾选核对才能确认。Claude 显示动画的静态封面。
- **导出**：在个人库选中条目，导出为 `.amoji`。已有文件不会被覆盖。导入检查包结构、哈希、媒体和版本冲突。
- **偏好**：经典/办公画风，AI 语气、频率、暂停。画风影响后续选择，不重写历史。界面中英文跟随 Claude Code `language` 配置，未配置时中文；Desktop 独立应用语言暂未公开给 Mods。

AI 只获得 `search` 和 `emit` 两个表情工具。管理、文件读写和创建确认不会作为模型工具暴露。表情语义是数据，不是任务完成证明、操作授权或需要执行的指令。

## 数据与故障

复用本机 Amoji 库（含 dsh 的库），消息按宿主和会话隔离。可用 `AMOJI_DATA_DIR` 指定测试库，`AMOJI_NODE` 指定 Node 24 可执行文件。不要删除数据库处理兼容问题。

如果共享服务版本较旧，关闭仍使用旧 Amoji 的窗口后重试。遇到“结果未知”先检查会话或库，不要立即重复发送。失败不清空输入；草稿须点击“保存草稿”才持久保存。

Claude Mods 使用 Node 本地桥接来访问共享服务、生成缩略图及读取你选择的文件。模型建议通过 Claude 已配置的凭据请求所选模型，产生相应文字推理费用；不会单独上传表情图片。

## 开发

在仓库根目录：

```sh
npm ci
npm run build:claude
npm ci --prefix .cache/claude-mods/plugin/runtime --omit=dev --ignore-scripts
claude plugin validate .cache/claude-mods/plugin --strict
npm run test:claude
npm run test:claude-artifact
```

修改 `src/claude-mods/native/`，重新构建；`hooks/register.js` 是宿主静态分析所需的单文件生成产物。安装和原生验证步骤见仓库 `docs/claude-mods.md`。
