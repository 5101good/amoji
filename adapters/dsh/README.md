# Amoji for dsh

[English](README.en.md) · [项目与文档](https://github.com/5101good/amoji)

面向人和 AI 的原生表情：人看图，模型读固定语义。1.0.0 以 dsh **0.1.5-rc.2** 为基线，需要 Node.js **>=24**；已有实际宿主证据的平台为 macOS arm64。

## 安装与使用

从 [GitHub Releases](https://github.com/5101good/amoji/releases) 下载并核对 `amoji-dsh-1.0.0.tgz`，在文件所在目录执行：

第一条命令为新 profile 初始化 Web 模板并显示帮助；随后安装并启动。

```sh
npx @deepseek-ai/dsh@0.1.5-rc.2 --profile amoji --from-default-profile web --help
npx @deepseek-ai/dsh@0.1.5-rc.2 plugin --profile amoji add ./amoji-dsh-1.0.0.tgz --ignore-scripts
npx @deepseek-ai/dsh@0.1.5-rc.2 --profile amoji
```

`amoji` 是示例 profile，替换为自己的名称。安装到已有 profile 时先保存工作，安装后重启。选择工作区即可从输入区打开“表情”，无需先发送普通文字。点图发送，详情只查看含义；新库的经典/办公各有24个同语义表情，共48个资产。

“管理表情”支持草稿、个人副本、不可变历史版本、归档、偏好及 `.amoji` 包导入导出。创作只有一个意图输入框；AI 文字建议默认当前会话模型，可另选宿主已配置模型。只发送文字意图和生成指令，不发送图片或会话历史。采用建议后仍需编辑、保存、图文加载预览、勾选并确认入库。手工填写无需模型请求。

界面跟随 dsh 中英语言，固定语义不会随 UI 翻译改写。内置语义为中文。模型建议按所选提供方配置计费，不自动重试。

## 数据与兼容

Host 连接本地共享服务，要求 API 2、数据库4，以及 `dsh-native-delivery-v1`、`dsh-reliable-delivery-v1`、`library-management-v1`、`packs-v1`。macOS 默认数据目录为 `~/Library/Application Support/Amoji/prototype`，可用 `AMOJI_DATA_DIR` 隔离。升级保留共享数据和宿主会话；卸载插件不主动删除共享库。

浏览器只使用宿主认证 RPC，模型只使用三个文字工具。`accepted` 表示宿主已接收入队，原生用户消息是否落盘仍需核对；`observed` 表示已观察到对应原生消息，图片 `rendered` 是独立的加载证据。断连或结果未知时核对原请求，避免另发。

direct tools 是 AI 图像展示的验证路径；Code Dispatch/PTC 嵌套工具不保证显示。Linux、Windows、新版 dsh 与全部模型组合尚未验证。某提供方续答会因 `reasoning_text` 兼容返回400，插件不能保证所有模型完整工具回合成功。Codex/Claude Code legacy 不在本包范围。

## 包内容与许可

包含 Host/Client、共享核心、基础资产、构建信息与许可清单，不嵌入 `node_modules`、Sharp `.node` 或 libvips 动态库；宿主包管理器安装依赖，因此不是离线安装包。Client 使用宿主 React，Host 使用宿主服务。

代码 MIT；基础素材 CC0-1.0；第三方依赖保留各自许可。参见包内 `LICENSE`、`NOTICE`、`THIRD_PARTY.json`、`THIRD_PARTY_LICENSES/` 和 `assets/base-library/`。

完整[安装恢复](https://github.com/5101good/amoji/blob/main/docs/dsh-installation.md)、[使用](https://github.com/5101good/amoji/blob/main/docs/usage.md)和[已知限制](https://github.com/5101good/amoji/blob/main/docs/release.md)见源码仓库。
