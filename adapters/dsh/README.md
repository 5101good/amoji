# Amoji for dsh

可分发的 Host / Web Client 适配包，兼容基线是 deepseek-harness `d347e703908d0406b7a7ef80e3a0e594d86b2215`（`0.1.3-alpha.1`）。完整宿主尚未验收。

在项目根运行 `npm run test:dsh` 构建与验证，再用 `npm pack ./adapters/dsh --ignore-scripts --pack-destination .cache/dsh-package` 生成包。依赖由包管理器安装；本机测试没有安装 dsh 或修改宿主配置。

Host 自动连接同一 Amoji 共享服务，要求 API 2 与 `dsh-idle-submission-v1`。浏览器只调用宿主受限 RPC；不会得到核心服务密钥。会话需要持久化 flush 监听。

详细实现、已运行检查与真机补验步骤见项目 `docs/validation/dsh-ticket-04.md`。Client 模块不是普通 ESM：`client.js` 必须经 dsh 的 `window.__ModuleLoader__` 加载。
