# Amoji for dsh

Host / Web Client 适配包，当前唯一发布验证目标是 `dsh 0.1.5-rc.2`。以 npm 发布包的真实 `defineTool`、Session 持久化校验器、SlotRegistry 和公开声明作为合同，不再依赖旧 alpha 源码快照。

在项目根运行 `npm ci`、`npm run test:dsh`，然后运行 `mkdir -p .cache/dsh-package` 与 `npm pack ./adapters/dsh --ignore-scripts --pack-destination .cache/dsh-package`。版本与完整性由 `package-lock.json` 固定，`scripts/dsh/baseline.json` 指定目标；`prepare:dsh` 只核对本地依赖，不下载旧源码。Client 经 `window.__ModuleLoader__` 加载，React 使用宿主提供的 18.x 平台模块，不声明或安装独立 React peer。Cordis/tools/connection 是 Host 提供的 optional peer，不要求向 profile 重复安装。

Host 自动连接同一 Amoji 共享服务，要求 API 2、数据库 3 及 `dsh-native-delivery-v1` / `library-management-v1` 能力。旧服务不满足时会明确拒绝连接，需要在适配器断开后由用户授权更新服务。浏览器只调用宿主受限 RPC，不得到核心服务密钥。Host 通过 connection.fetch.register 注册独立 /api/amoji/* POST 端点，继承 Connection 认证，不占用内置网关的 /api interceptor。安装或替换插件后重启对应 dsh profile，依赖安装完成本身不表示运行中插件已激活。

在 dsh 选择工作区后，宿主会预创建真实空白 Session；无需先发文字，即可从输入区“表情”搜索、预览和发送。当前工作区及 Agent preset 使用宿主原有流程，不调用 `selectModel`，不改变全局默认模型。完全未选择工作区时，先使用宿主工作区选择器。

用户表情展示在原生用户消息行：通过公开 Slot 包装已有 user/steering renderer，保留原组件、locale、inject 与全部 props，因此文字、附件、引用和原交互仍由宿主负责。AI 表情显示在对应顶层 direct tool 结果处。Code Dispatch / PTC 嵌套工具可能丢失 `presentationMeta`，本版本不保证其表情视图；验收使用 direct tools。

Session 中只使用原生 `user/message.source.rpcId=amoji:<message_id>` 与 `tool/result.meta`；Amoji 自有消息、accepted 与展示回执只由共享服务写入 SQLite。accepted 表示 prompt 接纳并通过 flush，不表示已观察到用户消息或模型已收到；观察到对应原生消息才显示 observed。

“创建自己的表情”暂时打开 Host 为当前会话生成的管理面板，创建确认后返回选择器刷新。完整内嵌管理属于 D4，不包含在本阶段。实现边界、检查和真机补验见项目 `docs/validation/dsh-native-2026-09-19.md`。

D2 已提供不可变修订、个人副本、归档、共享风格/频率/暂停和管理 CAS 的共享接口；完整原生管理界面留在 D4。克制冷却按真实 Session 原生回合计数，包含中间未调用 Amoji 的纯文字回合。合同与当前验证范围见 `docs/validation/dsh-library-lifecycle.md`。
