# dsh 安装、升级与恢复

[English](dsh-installation.en.md) · [文档首页](README.md)

## 要求

- Node.js >=24；当前真实宿主基线是 dsh 0.1.5-rc.2、macOS arm64。
- 模型由 dsh 配置。发送用户表情会触发正常宿主会话；AI 文字建议使用 dsh 已配置的文本模型。
- Linux/Windows 有路径处理实现，尚未完成实际宿主验证。不要把构建成功等同于跨平台兼容。

## 安装发布包

从 [Releases](https://github.com/5101good/amoji/releases) 获取同次发布的 `amoji-dsh-1.0.0.tgz` 与 `SHA256SUMS`。核对 SHA-256 后，在下载目录运行：

```sh
npx @deepseek-ai/dsh@0.1.5-rc.2 plugin --profile amoji add ./amoji-dsh-1.0.0.tgz --ignore-scripts
npx @deepseek-ai/dsh@0.1.5-rc.2 --profile amoji
```

示例使用独立 `amoji` profile。若安装到已有 profile，替换命令中的名称并先保存工作、退出该 profile。插件通过官方 plugin 命令安装，依赖由宿主包管理器解析。tgz 不包含 `node_modules` 或原生二进制，安装需要网络访问依赖源；它不是离线安装器。

重启后选择工作区，打开输入区“表情”。新会话无需先发送普通文字；新库在当前画风下显示 24 个内置表情。已有个人内容的库可能更多。安装返回 0 只说明安装命令成功；实际入口、图片加载和一次发送应分别检查。

## 从源码构建

```sh
git clone https://github.com/5101good/amoji.git
cd amoji
npm ci
npm run typecheck
npm test
npm run test:dsh
mkdir -p .local/release
npm pack ./adapters/dsh --ignore-scripts --pack-destination .local/release
```

`test:dsh` 包含 `build:dsh` 与固定公开合同准备。只构建可运行 `npm run build:dsh`。`npm pack` 的文件名由 `adapters/dsh/package.json` 决定；1.0.0 为 `amoji-dsh-1.0.0.tgz`。安装自己刚生成的文件，而非旧缓存包。源码依赖由根目录 `package-lock.json` 锁定，宿主安装后的实际依赖由其 profile 锁文件记录。

## 数据与备份

| 平台 | 默认目录 |
| --- | --- |
| macOS | `~/Library/Application Support/Amoji/prototype` |
| Linux | `$XDG_DATA_HOME/amoji`，未设置时为 `~/.local/share/amoji` |
| Windows | `%LOCALAPPDATA%/Amoji`，未设置时为用户目录下 `AppData/Local/Amoji` |

`prototype` 是兼容历史图片引用保留的目录名。`AMOJI_DATA_DIR` 可覆盖位置；测试使用独立目录。运行库主要包括 `library.sqlite` 和 `blobs/`，服务发现文件可能含本地访问凭据。不要公开上传整个目录。

升级前保存草稿，保留 dsh profile 的持久会话与锁文件。备份数据库应使用 SQLite 一致备份，或关闭全部相关客户端、等共享服务退出后复制完整数据目录；不要在写入过程中只复制一个 SQLite 文件。表情包导出只包含选定版本及素材，不是会话、草稿和偏好的完整备份。

## 升级与卸载

使用唯一路径保存新版 tgz，对相同 profile 再次执行 `plugin ... add`，然后重启。卸载：

```sh
npx @deepseek-ai/dsh@0.1.5-rc.2 plugin --profile amoji remove @amoji/dsh
```

卸载不主动删除共享库。重新安装时保留原数据目录；不要通过删库解决连接问题。共享服务在最后一个连接离开后默认空闲 60 秒退出；其他客户端仍连接时继续运行。

当前要求共享 API 2、数据库 4，以及 `dsh-native-delivery-v1`、`dsh-reliable-delivery-v1`、`library-management-v1`、`packs-v1` 能力。不兼容时会拒绝连接，不会自动降级数据库。退出旧核心的全部使用端后再重新连接；不要强行启动第二个写入进程或按过期 PID 杀进程。

## 故障恢复

- 连接丢失：用选择器“重新连接并核对”或管理窗口的重连操作恢复；它不会自动重发消息。
- 发送结果未知：保留原选择，核对原会话和原请求；不要换一个表情另发来“重试”。
- 图片失败：显示固定文字回退。文字或工具成功不等于图片已实际显示。
- 草稿保存结果未知：先核对原草稿，再继续编辑；刷新页面前保存输入。
- 没有建议模型：先在 dsh 配置模型，然后刷新列表。提供方连接、额度及工具续答错误需要在宿主/提供方侧排查。

更细的状态含义见[架构](architecture.md)，验收范围见[发布说明](release.md)。
