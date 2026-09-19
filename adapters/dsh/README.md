# Amoji for dsh

Host / Web Client 适配包，当前唯一发布验证目标是 `dsh 0.1.5-rc.2`。以 npm 发布包的真实 `defineTool`、Session 持久化校验器、SlotRegistry 和公开声明作为合同，不再依赖旧 alpha 源码快照。

在项目根运行 `npm ci`、`npm run test:dsh`，然后运行 `mkdir -p .cache/dsh-package` 与 `npm pack ./adapters/dsh --ignore-scripts --pack-destination .cache/dsh-package`。版本与完整性由 `package-lock.json` 固定，`scripts/dsh/baseline.json` 指定目标；`prepare:dsh` 只核对本地依赖，不下载旧源码。Client 经 `window.__ModuleLoader__` 加载，React 使用宿主提供的 18.x 平台模块，不声明或安装独立 React peer。Cordis/tools/connection 是 Host 提供的 optional peer，不要求向 profile 重复安装。

Host 自动连接同一 Amoji 共享服务，要求 API 2、数据库 4 及 `dsh-native-delivery-v1` / `library-management-v1` / `packs-v1` 能力。旧服务不满足时会明确拒绝连接，需要在适配器断开后由用户授权更新服务。浏览器只调用宿主受限 RPC，不得到核心服务密钥。Host 通过 connection.fetch.register 注册独立 /api/amoji/* POST 端点，继承 Connection 认证，不占用内置网关的 /api interceptor。安装或替换插件后重启对应 dsh profile，依赖安装完成本身不表示运行中插件已激活。

在 dsh 选择工作区后，宿主会预创建真实空白 Session；无需先发文字，即可从输入区“表情”搜索、预览和发送。当前工作区及 Agent preset 使用宿主原有流程，不调用 `selectModel`，不改变全局默认模型。完全未选择工作区时，先使用宿主工作区选择器。

用户表情展示在原生用户消息行：通过公开 Slot 包装已有 user/steering renderer，保留原组件、locale、inject 与全部 props，因此文字、附件、引用和原交互仍由宿主负责。AI 表情在发送过程中显示于对应顶层 direct tool 结果处；原生回合结束后，由公开 ConversationNodeDefinition 创建独立对话节点，因此默认折叠工具组也可见。展开工具组时同 messageId 只保留文字反馈，不重复图片。无最终文字的结束回合也使用相同路径。Code Dispatch / PTC 嵌套工具可能丢失 `presentationMeta`，本版本不保证其表情视图；验收使用 direct tools。

Session 中只使用原生 `user/message.source.rpcId=amoji:<message_id>` 与 `tool/result.meta`；Amoji 自有消息、accepted 与展示回执只由共享服务写入 SQLite。accepted 表示 prompt 接纳并通过 flush，不表示已观察到用户消息或模型已收到；观察到对应原生消息才显示 observed。

“表情 → 管理表情”在同页原生对话框打开完整管理。可浏览可用/归档库、查看精确历史版本、选择当前版本、创建或编辑个人副本、保存/恢复草稿、修改 AI 偏好以及导入/导出完整包。创建必须保存、图文预览成功 load 后明确勾选确认，随后返回选择器即可发送。固定语义、许可和来源均可手工填写；文字建议在独立待选区修改/采用/放弃，不读取图片或调用模型。

未保存的草稿输入在当前页面内保留，切换会话/卸载编辑组件后可恢复；页面重载前请保存草稿。发送目标在选择时绑定，切换会话后需重新选择。并发修改保留本次输入并显示当前状态；确认或包导入结果未知时先核对原草稿/原文件，不把断连报成确定失败。完整包通过 Connection 认证的同源二进制流上传，最多 260 MiB；导出只有完整成功产物才触发下载，不输入服务器路径。

D2 的克制冷却按真实 Session 原生回合计数，包含中间未调用 Amoji 的纯文字回合。详细操作、自动检查和真实浏览器待验边界见 `docs/validation/dsh-native-management.md`；共享生命周期合同见 `docs/validation/dsh-library-lifecycle.md`。
