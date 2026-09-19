# dsh 原生管理 D4

2026-09-20；目标宿主 `@deepseek-ai/dsh@0.1.5-rc.2`。本文件记录源码与隔离检查，不把它们当作真实浏览器验收。D5 仍需完成实际安装、主题/尺寸/键盘、真实上传下载、CAS、多会话和模型用户旅程。

## 操作路径

1. 在 dsh 选工作区，点击输入区“表情”。固定尺寸网格支持搜索、预览、名称选择、动图暂停/播放及发送。“管理表情”打开同页原生 dialog，Escape 或“返回选择器”关闭。
2. “表情库”查看可用或已归档条目；选择一项后查看历史版本、图像、固定语义、许可和精确身份。内置/导入项可明确设定当前版本。归档只影响新发送；旧消息仍读取其原版本。仅当前版本可编辑；个人条目生成新修订，其他来源创建个人副本。
3. “创作与草稿 → 新建表情”，选择 PNG/JPEG/WebP/GIF（最多 10 MiB、2048 px；动图最多 10 秒）。填写固定含义、文字回退、语气、适用/避免场景、标签和许可。可展开“从文字意图获取建议”，在独立待选区修改，再采用或放弃。意图、主表单和素材变化会使旧候选失效；迟到响应不能覆盖输入。
4. “保存草稿”可保存未完成输入。“保存并预览”先走共享服务真实媒体和语义校验；浏览器图片 load 成功后才能勾选图文核对并“确认加入表情库”。修改任何主表单内容或换图会撤销预览确认。成功后返回选择器即可在刷新库中找到新版本。
5. 草稿列表恢复已保存内容；切换编辑前使用“结束当前编辑”，明确放弃未保存修改。当前页面内暂存编辑内容可跨组件卸载恢复，但页面重载前仍应保存草稿。切换聊天不会把旧选择改投新会话；需在新会话重新选择。
6. “AI 偏好”加载/保存共享风格、频率和暂停。暂停 AI 后人仍可发送。CAS 冲突保留输入并展示服务当前状态；用户可选择读取当前值或采用新版本号继续编辑，不自动覆盖。编辑条目确认冲突可明确基于当前条目开始新草稿，保留本次填写并重新预览。
7. 在表情详情中“选择此版本导出”，再打开“导入与导出”下载完整包。导入选择 `.amoji`/ZIP，成功刷新共享库；已有条目不自动切新版。结果未知时保留并锁定原 File，可核对库或幂等重试同一包。

## 实现边界

- 管理经现有认证 Connection 的精确 `/api/amoji/management` 白名单，再调用 ConnectedRuntime 的 creation/management/suggestions/packs。新增 `listRevisions(assetId)` 只读接线，版本来自 LibraryStore；没有前端复制业务存储、任意文件路径或模型管理工具。
- 草稿及条目错误保留 `code/current`；草稿未知结果通过 `getDraft` 核对。旧兼容外部面板 RPC 仍存在，但新 UI 不调用它。
- `/api/amoji/pack-import`、`pack-export` 使用公开 streaming route，Connection 负责认证与 Origin/Host 信任。应用逐块读取、检查取消、施加 260 MiB / 128 KiB 限制。导入原始二进制交 SharedClient；导出完整成功后才返回 ZIP。没有 base64 大包和核心 secret 泄漏。
- AI 使用公开 `uiConversation.events.register` 定义独立 `amoji-expressions` 节点：消费原生 append `tool/result.meta`，同 messageId 去重，在 `turn/end.seq` 锚定，处于折叠过程之后；无最终文字也生成。原有 node renderer、tail chain、actions 均不改。工具 renderer 用公开 `useChat` 查询本插件主流节点，完成后只留文字反馈，避免展开工具组重复图。失败工具继续显示实际错误。
- 使用宿主字体与 `--dsw-alias-*` 深浅主题变量，系统原生 dialog 提供焦点圈定和 Escape；选择器保留 D1 的 top-layer 视口碰撞定位。没有修改宿主 DOM、node_modules 或素材身份。

## 实际自动检查

- `npm run typecheck`：通过。
- `npm run build:dsh`：通过，分发 runtime 明确包含新 host-management 模块。
- `node --import tsx --test tests/dsh-client.test.ts tests/dsh-native-client.test.ts tests/dsh-host.test.ts tests/dsh-management-ui.test.ts`：39 项通过，0 失败/跳过，约 3 秒。
- 新测试包含实际 DOM 确认成功、load 门禁与输入失效、建议迟到、偏好 CAS 输入保留、编辑卸载恢复、包未知结果原 File 重试、导出失败不下载、独立 AI 节点及展开工具组去重。Host 测试调用真实共享服务版本枚举/草稿，并实际从二进制 route 导出再导入完整包、拒绝无效会话和超限读取。
- 既有真实 loader/SlotRegistry、原生 Session 冷恢复、Connection route 共存、首发与跨会话投递测试继续通过。没有重复全 suite、真实安装、用户服务变更或模型调用。

## 仍待真实验收

root 已观察到共享 lease 在约 5 分钟 idle 后断开，这是 D5 的可靠性工作，本阶段未隐藏或改写该错误。上述组件检查不证明真实 dsh 像素、原生下载、实际注册事件投影或供应商行为；需在匹配本阶段代码的共享服务与插件上验收。已保存草稿持久化，页面内未保存缓存不宣称可跨页面重载。
