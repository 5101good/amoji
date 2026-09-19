# dsh 0.1.5-rc.2 原生双向接入

2026-09-19，D1 源码与本地合同验证；真机 QA 由 root 在独立 profile 记录。本报告不声称模型已调用工具或真实浏览器已验收。

## 当前实现

- 发布目标锁定 npm `0.1.5-rc.2`，以 `package-lock.json` 固定依赖。`npm run test:dsh` 构建插件并验证真实公开 defineTool、Session、持久化读取器、SlotRegistry 与声明合同；不再执行旧 `0.1.3-alpha.1` git hash 桩。
- Host 不写 `amoji/*` Session 事件。人类投递以确定的 `amoji:<message_id>` 作为原生 prompt requestId，历史以原生 user source.rpcId 关联。AI 用 direct tool 原生 result.meta 关联。消息、accepted 与展示回执由 SharedClient 调用唯一 LibraryStore 写者保存。
- 投递先确认持久化服务存在，调用原生 prompt，再 flush，然后保存 accepted。该值不是完整投递；原生 user/message 出现才是 observed。失败重试保留同一选择与 requestId。
- 原生输入区提供搜索、静态/动画预览、固定语义详情与发送。主流程不显示内部 Session ID，精确 ref 保留在详情中。
- 原生 user/steering 行通过 slots.entries、subscribe 取得宿主 renderer，再以较低 priority 包装，原组件保留全部 props、locale、inject 和 store。新消息按 rpcId 从共享库核对图文后附加图片。普通消息直接使用原组件且不访问 Amoji 历史。没有复制附件、引用或消息 UI；History 仅保留兼容测试导出，不注册到底部 dock。
- 所有扩展通过 inject + register 生命周期，声明延迟出现、卸载和同步部分失败均有清理。包装监听宿主 renderer 变化；如果未来 user renderer 增加自有 children，拒绝不安全包装，不偷偷吞掉附件。
- 只消费 settled tool-result.meta。模型三工具仍只有 search/resolve/emit；媒体仅经人类 RPC。Code Dispatch / PTC 嵌套工具不保证 meta，本阶段仅支持 direct tool 图片视图。
- 动图支持 reduced-motion、播放暂停和失败 fallback；图像源切换会更换 DOM img，迟到旧图 load 不能为新封面保存回执。

## 零文字首发与宿主证据

0.1.5-rc.2 `dsh-client-ui-workspace/lib/client.js` 的 `openWorkspace` 调用 `connectWorkspace`，后者经公开 Session Controller `create({workspaceId})` 建立空白 Session，然后 `openSession` 绑定 shell。`dsh-client-ui-conversation` 只有未选工作区的 composer 是 inert。产品沿用这条原生流程：先选工作区即可直接发表情，之前不需要文字消息。Amoji 不创建假 Session、不调用 selectModel、不改默认模型，也不绕过 Agent preset 原有选择。

## 本地验证

`npm run typecheck`；`npm run test:dsh`；`node --import tsx --test tests/shared-service.test.ts tests/shared-migration.test.ts tests/shared-panel.test.ts`。

TDD 已观察的失败包括：旧 Host 向 Session 写入 amoji 事件；旧 Client 没有包装原用户行；动图暂停重复使用同一 img 导致旧 load 可归属新图。对应修复后通过。公开声明还实际捕获并修正 JsonValue 返回合同。测试使用真实 Session 写入原生首条消息、flush 到文件、经 validateStoredEvents 读取并 fromRestore，再与 Amoji 消息重新关联；未知 amoji/submission 对照被真实读取器拒绝。

## 必须由真实 QA 补证

独立 profile 安装并重启后的 Host/Client 激活；选工作区后零文字首发表情；真实用户行和 AI direct tool 图文；普通文本、附件、文件/技能引用及交互；深浅主题与选择器可见区域；动图 reduced-motion 与回执；两个会话切换；cold restart 恢复；低成本模型真实调用三工具和无媒体模型输出。不要把本地测试等同这些真机证据。管理页面仍是现有独立创建入口，完整内嵌管理属于 D4。

## 真实安装回报修正：Connection 共存

root 在独立 QA 首次启动确认 /api 只能有一个 interceptor，原实现与内置 Gateway 冲突。已用真实 HostConnectionService 先复现相同报错，再改为公开 connection.fetch.register 的七个精确 POST /api/amoji/* buffered 端点。沿用公开 clientRequestSchema 校验与 server-response 信封，不改变 Client 调用；端点继承 Connection 的认证、Origin/Host 信任和请求大小限制。共存测试同时断言 Gateway 原端点仍可调用、Amoji 实际派发、method 不一致拒绝、卸载后 Gateway 仍在且 Amoji 返回404。Client 平台 React 不再声明npm peer；Host提供的Cordis/tools/connection 标为 optional peer，避免建议用户为平台模块重复装依赖。

## 2026-09-20 聚焦修复

真实 QA 暴露了完整 Expression 被作为窄 ref 发送，以及空白会话选择器向上超出视口。现已在 Client RPC 边界显式构造两字段 ref；选择器采用原生 popover 顶层与锚点/视口空间定位，支持向上或向下展开并限制宽高。accepted 生命周期检查也改为从新 SharedClient 连接读取真正的 dsh_submission 字段。

对应红绿测试复现了 INVALID_ARGUMENT 和旧 absolute 定位；修复后 typecheck、build:dsh 与三个相关 dsh 测试文件的 25 项检查通过。真实图片解码、浮层位置与交互仍由 root 浏览器 QA 记录。

## 2026-09-20 人类呈现、表达上下文与工具失败

真机首回合已由 root 观察到原生用户 observed/rendered、search/resolve 成功及自造 token 被拒绝。本轮源码修复把已核实用户消息的精确投影文字在显示层转换为名称/固定语义，原图片、附件、引用、额外文字和宿主交互保留，版本数据放入详情；未核实的行和持久原消息不改。新 prompt 用自然名称开头，明确表情是用户感受表达而非任务/授权，原精确 modelProjection 仍附在说明后，既有或用户自定义标题不重写。工具说明补齐 token 来源；settled 失败展示实际错误并支持文字 fallback，不再停留在等待占位。

对应三个失败测试已先红后绿，聚焦三个 dsh 测试文件 28 项、typecheck、build:dsh 与 diff 检查通过。模型是否按新说明自然回应及新标题效果仍由 root 短回合 QA 证明。
