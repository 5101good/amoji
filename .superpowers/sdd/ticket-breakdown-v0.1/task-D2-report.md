# D2 实施报告

状态：DONE。BASE：e2b76de32fdd17f98306f50c2c3eed3f415958e9。

## 实施与公开接口

按任务 brief 完成共享管理业务，LibraryStore 唯一数据库写者。没有派子代理、修改用户 profile/凭据/服务、运行外部安装或请求模型。只有隔离临时服务用于合同测试。

- 新增 src/library-management.ts 管理类型、严格设置/ref 校验、风格排序与策略说明。数据库从 2 升 3，新增 entry_state（条目修改序号/归档）；API 保持 2，通过 library-management-v1 协商。既有 revisions、library_entries、草稿、消息与 blobs 原值保留。local 归属保留，种子登记 builtin，无法证明本地所有权的旧条目登记 imported。
- SharedClient 与 ConnectedRuntime.management 提供 listEntries、getEntry、startRevisionDraft(ref,version)、setArchived(assetId,version,archived)、getSettings、updateSettings(version,preferences)。这些管理接口不注册模型工具。ServiceError.current 透传 CAS 的当前条目、设置或草稿。
- 服务确定草稿 mode/source/entry_version；local 编辑保留 asset_id，新 revision derived_from 前版；builtin/imported 复制新身份、local 归属、来源关系。rights.creator 不影响权限。确认前校验条目 CAS；失败保留草稿，确认重试返回原确定版本。
- 归档过滤新发/搜索并在 emit/receive 再次核对当前可用性；旧未消费选择不可绕过。已消费 token 和已接收 requestId 重试先返回原消息。旧 revision、视觉 hash 和历史快照保持；缺失素材返回 BLOB_MISSING 与原 fallback，不查最新版补图。
- settings 默认 neutral/restrained/未暂停，支持 warm/playful 与 moderate/active。风格在整组语境匹配候选排序后截取，固定语义不变。每回合一个、连续相同 asset 限制、克制冷却、暂停均由核心发送时执行；手动发送独立。
- root 指明必须包含零工具回合后，最小接线 dsh capture：校验可信 Session 与 turnBoundary 当前 seq，从原生 turn/start 事件计数产生 turnOrdinal；模型参数不扩展，缺少对应原生事件拒绝。真实发布包 Session 的持久事件重建后仍正确包含中间纯文字回合。其他端仅保守 fallback，无新端适配。
- dsh 入口和 BUILD 声明新 capability，构建显式复制 library-management 运行时模块。API/迁移/后续消费合同写入 shared-service-v0.1.md，公开证据写入 docs/validation/dsh-library-lifecycle.md。

## TDD 证据

1. RED：`node --import tsx --test tests/library-management.test.ts`，初始 3/3 失败：服务未声明 library-management-v1，listEntries/getSettings 尚不存在。GREEN：完成核心、公共 RPC、客户端和 runtime 接线后同命令 3/3 通过。随后扩展 imported 迁移、归档重启缺失素材、冲突解决与整库风格案例。
2. RED：`node --import tsx --test --test-name-pattern='dsh 克制冷却' tests/dsh-host.test.ts`，纯文字中间回合后的第三回合仍报 FREQUENCY_LIMIT。GREEN：增加宿主原生 ordinal 接线后 1/1 通过；继续加入真实 npm Session + validateStoredEvents/fromRestore 冷恢复案例，通过。
3. RED：`node --import tsx --test --test-name-pattern='风格对整库|数据库2导入' tests/library-management.test.ts`，2 项中风格失败：第六个温暖匹配未进入前五个候选。GREEN：排序作用于全部语境匹配后再限流，扩展聚焦测试通过。
4. RED：`node --import tsx --test --test-name-pattern='打包dsh Host提供' tests/dsh-host.test.ts`，BUILD 缺少管理能力。GREEN：更新实际入口握手/BUILD 和复制模块列表后通过，并直接 import 打包 LibraryStore 确认模块可加载。

一次中间受影响回归为 36/39：产物尚未重建导致 BUILD DB=2；旧三样本连续发送测试未声明适中设置；原 resolve fixture 原先没有真实 turn/start 事件。已重建产物，三样本回归显式设置 moderate，fixture 仅在模拟工具执行时添加真实回合记录，resolve 继续断言没有消息和自定义事件。最终聚焦验证如下，不把中间失败隐藏为完成。

## 最终验证

- `npm run typecheck`：通过。
- `node --import tsx --test tests/library-management.test.ts tests/create.test.ts tests/create-recovery.test.ts tests/catalog.test.ts tests/shared-service.test.ts tests/shared-migration.test.ts tests/shared-claude-ticket.test.ts tests/dsh-host.test.ts tests/dsh-public-contract.test.ts`：46 tests，46 pass，0 fail，0 skipped，约 16.65 秒。
- 其后只扩充冲突显式解决后收发断言并更新文档，`node --import tsx --test --test-name-pattern='管理 capability' tests/library-management.test.ts`：1 pass，0 fail。
- `npm run build:dsh`：通过，包含 tsc 与新 runtime/BUILD 生成；最终构建再次通过。
- `git diff --check`：通过。

## 自审及文件

新增 library-management.ts 与 library-management.test.ts；修改 Store/SharedClient/SharedService/contract、drafts、sample-catalog 的 derived_from 类型、search 可选候选排序、AdapterRuntime.management、dsh host 与入口、build-dsh；仅更新 create/shared-claude-ticket 的数据库版本断言，扩充 dsh-host 测试；README/公开合同/验证报告同步。生成产物按现有规则不提交。

自审发现并修复候选先截断后风格排序和 dsh 分发模块遗漏。确认所有管理字段只能经服务端路径产生；CAS 确认与 revision/default 写入处于同一事务；已消费请求判定在新发策略之前；发送不接收动态语义、任意目标或模型回合号；旧历史不跟随默认 revision。当前 Store 是既有较大集中事务模块，本阶段没有重构或引入第二 writer。

## 后续消费与边界

D3 导入须在同一 Store 事务初始化 imported 来源与 entry_state，推进上游默认时增 version、保留 archived、拒绝覆盖 local；不要让导入默认改写个人副本。D2 imported 案例只模拟隔离数据库中的输入状态，不声称完整包已实现。

D4 读取 management capability，使用 entry.version 建编辑草稿；调用原 creation.saveDraft/previewDraft/confirmDraft 完成编辑。冲突把 ServiceError.current 提供给用户同时保留本地输入。若确认冲突，可用户显式从当前条目新建草稿并重用字段/素材；不自动覆盖。完整 dsh UI 未在 D2 实现。

D5 负责真实管理 UI/多会话/模型风格行为/完整 alltest 与发行验收。当前 dsh ordinal 来自原生事件；暂缓端没有 ordinal 时只观察核心见过的可信 turnId，可能更保守，不宣称那些端完成完整回合验收。moderate 与 active 都无额外硬冷却，区别是使用建议；连续相同 AI asset 禁止，手动消息不解除该限制。以上界限已公开，无其他未解决正确性疑虑。
