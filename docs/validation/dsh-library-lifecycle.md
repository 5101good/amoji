# dsh 共享库生命周期 D2 验证

2026-09-20。当前主适配为 dsh 0.1.5-rc.2。本记录证明共享业务与公开合同，不代表完整管理 UI 或发行验收完成。

已交付：

- 由共享服务确定创建、编辑、复制模式；本地编辑保留身份并生成不可变修订，内置/导入来源形成个人副本并保留 derived_from。旧消息的定义和视觉 hash 不变。
- 条目与设置修改序号 CAS；错误携当前状态，未确认草稿保持保存；用户可从最新条目重新建草稿并显式重用本次字段。
- 归档从新发列表和搜索隐藏；发送时再次核对可用性。精确历史和素材保留；已消费 token/requestId 重试仍返回原消息。
- 共享风格、频率和暂停设置。默认克制，每回合至多一个，连续 AI 表情不能重复相同身份；克制额外冷却一个完整回合。暂停不阻止手动发送、精确解析或已成功请求查询。
- dsh 从公开 turnBoundary 与真实 Session 的 turn/start 事件提供可信序号。零 Amoji 工具的中间回合参与冷却，模型不能提供回合顺序。

验证使用临时目录、真实 SharedClient/HTTP 服务/LibraryStore、双客户端、服务重启、dsh 发布包 defineTool 与真实 Session/validateStoredEvents/fromRestore。没有访问用户 profile、凭据或运行中服务，没有新增模型请求。

执行结果：

```text
npm run typecheck
通过

node --import tsx --test tests/library-management.test.ts tests/create.test.ts tests/create-recovery.test.ts tests/catalog.test.ts tests/shared-service.test.ts tests/shared-migration.test.ts tests/shared-claude-ticket.test.ts tests/dsh-host.test.ts tests/dsh-public-contract.test.ts
46 tests / 46 pass / 0 fail / 0 skipped

node --import tsx --test --test-name-pattern='管理 capability' tests/library-management.test.ts
补充冲突显式解决后的收发验证：1 pass / 0 fail

npm run build:dsh
通过；分发 runtime 包含 library-management，BUILD 声明数据库 3 和新管理 capability

git diff --check
通过
```

核心测试包括：编辑含义并替换图片；选中后版本变化拒绝静默切换；builtin 与 imported 的来源副本；上游默认变化不覆盖个人副本；双客户端编辑/设置冲突 current 与草稿保留；冲突解决后的新收发；归档后重启、历史与已消费重试；删除隔离素材后的 BLOB_MISSING 和原 fallback；暂停前 token 复核；温暖风格从整库候选排序（包含原前五名之外的匹配）；dsh 纯文字中间回合冷却和真实 Session 冷恢复。

API 保持 2，数据库为 3；消费者需检查 `library-management-v1`，dsh 入口同时要求 `dsh-native-delivery-v1`。详细方法、字段与 D3/D4 接线约束见 [共享服务合同](../specs/shared-service-v0.1.md#d2-库生命周期与个人偏好数据库-3)。

边界：导入状态由隔离数据库模拟，完整包读取/导入由 D3 交付；完整 dsh 原生编辑、归档、设置与冲突 UI 由 D4 交付；真实多会话/模型行为、冷重启 UI 与完整发行回归由 D5 交付。其他暂缓适配器没有新 UI 或安装，未提供可信 ordinal 时保守地按核心已观察回合冷却，不宣称与 dsh 的完整回合能力等价。本阶段未运行全套 alltest。
