# 场景包 0.2 / Scenario packs 0.2

> **已被取代**：本协议将由 [Amoji 协议 0.1（RFC 草案）](amoji-0.1-rfc.md) 整体替换，并在实现迁移完成后删除。迁移前它仍是运行时依据。

本地管理页的“导入与导出”可从所选的已确认表情创建场景草稿，编辑名称、场景、说明、许可及可选动作，保存草稿、重开、预览并确认保存。纯视觉包保持空 `actions` / `bindings`。确认后的发布不可修改；固定表情版本和历史始终保持原值。

In Import and export, create a scenario draft from confirmed expressions, edit its description and license, optionally add instructions or built-in habits, save/resume, preview, and confirm. Visual-only packs have empty actions/bindings. Confirmed releases and expression revisions are immutable.

- 完整导出 0.2 保留精确 release、表达、动作、绑定及许可；显式仅表情导出为 0.1，丢弃动作。未知 schema 拒绝，不静默降级。
- Complete 0.2 exports retain the exact release, expressions, actions, bindings and licenses. Explicit expression-only exports use 0.1 without actions. Unknown schemas are rejected.
- 安装不会启用任何动作。dsh 提供“仅发送”和“发送并应用”，持续规则由用户在当前会话单独开启。关闭停止后续应用，不删除历史或保证模型忘记。动作是提示而非强制控制，不提升权限或追加独立推理。
- Installation never enables actions. dsh offers Send only and Send and apply; conversation rules require explicit activation. Disabling stops future application without erasing history or guaranteeing forgetting. Guidance is not enforcement, privilege escalation or independent inference.

机器合同：[JSON Schema](amoji-v0.2.schema.json)。表达继续符合 [0.1](amoji-v0.1.schema.json)。所有对象拒绝未知字段；引用须闭合，每资产一个默认版本。`bindings` 为 `{expression: {asset_id, revision_id}, actions: [{action_id, action_revision_id}]}`。`rights` 使用既有 `license`、可选 `creator/source`；顶层 `derived_from` 使用 `{pack_id, release_id}`。`scenario/styles` 为有界文字列表，`examples` 为有界说明列表，`requires` 只允许两个内建模板名。

The executable schema defines strict objects and closed references. Each asset has one default. Expression schemas remain 0.1; actions never enter their fixed semantics.

最多 200 表情、64 动作、每表达 3 个动作引用；instruction 2 KiB、说明/effect_summary/每个 example 4 KiB UTF-8。`ActionCompiler` 独立校验固定语义 4 KiB，最多两条持续规则和一次动作，完整 envelope 8 KiB。一次性偏好覆盖同组持续偏好；明确用户文字和宿主更高优先级规则优先。这只是用户协作提示，不是权限或执行保证，不会单独调用模型。

Limits are 200 expressions, 64 actions, three action refs per expression, 2 KiB instructions and 4 KiB descriptions. The pure compiler rejects overflow without truncation, uses a separate 4 KiB semantic budget, and bounds the entire action envelope to 8 KiB. It performs no inference or activation.

API 仍为 2。`versioned-packs-v1` 表示本地场景草稿/预览/保存/完整导出能力；旧 `packs-v1` 行为保留。`marketplace-v1` 和 `collaboration-v1` 分别声明本地获取及协作能力，不证明云服务部署或模型遵从。公开 `SharedClient` 提供 `createScenarioDraft/listScenarioDrafts/getScenarioDraft/saveScenarioDraft/previewScenarioDraft/confirmScenarioDraft/listScenarioPacks/getScenarioPack/exportScenarioPack`。写草稿用 version CAS；冲突保留输入，重读后明确重新保存。

API remains 2. Negotiate `versioned-packs-v1` for scenario authoring and exact exports. Existing capabilities keep their meanings; marketplace and collaboration capabilities do not prove cloud deployment or model compliance.

## 数据库升级与恢复 / Database upgrade and recovery

DB4→5 在单写服务持有 SQLite 写锁时，通过 SQLite backup API 备份已提交数据（包括 WAL），保存到数据目录的 `backups/library-v4-<uuid>.sqlite`。备份经完整性与版本校验并转换为独立文件；建表、检查和 user_version 更新在同一事务。备份或检查失败回滚，DB4 仍可恢复。

The reserved SQLite writer lock covers a consistent SQLite backup including committed WAL pages, integrity validation and the transactional migration. Backup or validation failure keeps the previous database version and data.

回退流程：停止全部客户端与共享服务，确认没有写入者；导出需要保留的新 0.2 包，保留完整升级后数据目录作为快照；在独立恢复目录中复制升级前 backup 为 `library.sqlite`，并复制同一数据目录的 `blobs`。不要复制升级后 WAL/SHM 到恢复目录。先用旧程序验证，再切换目录。**不得手改 user_version，也不得让旧程序直接打开 DB5。** 原始数据目录与备份保留，直到恢复核验完成。

For rollback, stop all clients and writers, export needed new packs and retain the complete upgraded directory. Restore the pre-upgrade backup as `library.sqlite` in a separate directory alongside its blobs. Never pair it with the upgraded WAL/SHM. Verify with the previous program before switching directories; never edit user_version or open DB5 with the old program.

本地旧大包预算保持不变；市场的更小预算由市场验证链路单独执行。此交付没有云部署、原生宿主动作或真实模型效果的验证声明。

Local legacy archive budgets remain unchanged. The smaller marketplace budget is enforced separately by its validation pipeline. This delivery does not establish cloud deployment, native action execution, or model compliance.
