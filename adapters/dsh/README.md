# Amoji for dsh

可分发的 Host / Web Client 适配包，兼容基线是 deepseek-harness `d347e703908d0406b7a7ef80e3a0e594d86b2215`（`0.1.3-alpha.1`）。完整宿主尚未验收。

默认 `npm test` 只运行无需 dsh 源码下载的普通回归。`npm run prepare:dsh` 显式准备固定源码（首次需要 curl/网络）。在项目根运行 `npm run test:dsh` 构建、显式准备基线并验证，再用 `npm pack ./adapters/dsh --ignore-scripts --pack-destination .cache/dsh-package` 生成包。依赖由包管理器安装；本机测试没有安装 dsh 或修改宿主配置。

Host 自动连接同一 Amoji 共享服务，要求 API 2 与 `dsh-idle-submission-v1`。浏览器只调用宿主受限 RPC；不会得到核心服务密钥。会话需要持久化 flush 监听。

详细实现、已运行检查与真机补验步骤见项目 `docs/validation/dsh-ticket-04.md`。Client 模块不是普通 ESM：`client.js` 必须经 dsh 的 `window.__ModuleLoader__` 加载。

### 手工创建（票据 07）

在原生表情选择器点击“创建自己的表情”，再打开 Host 为当前会话生成的管理面板链接。面板提供上传、保存恢复草稿、图文预览和明确确认；确认后返回 dsh，点击“显示全部”刷新共享库，再选择发送。此入口通过人类 `amoji/manage` RPC 验证会话，不新增模型管理工具，也不发起模型调用。API 2 保持不变，数据库 2 和 `create-drafts-v1` 能力由同一共享核心提供；构建产物包含共用 web 面板。dsh 真宿主验收仍待集中执行。
