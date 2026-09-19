# D3：完整包与基础库验证

2026-09-20。当前主适配与后续真机验收对象为 dsh。本阶段交付共享业务与普通基础包；没有安装到用户 profile、调用模型、生成新图或完成 dsh 管理 UI/真机会话验收。

## 已实现

`src/packs.ts` 负责普通 `.amoji` ZIP：固定资源预算、唯一安全路径、UTF-8/Schema/字段预算、唯一版本引用、完整默认引用、素材闭包、实际摘要及完整媒体解码。压缩输入最多260MiB，隔离目录逐项展开最多250MiB/1000条目/2MiB清单/200版本，单素材仍限10MiB。除 manifest.json 与 blobs/<sha256> 外只容许一个空 blobs/ 目录；拒绝链接、特殊文件、加密、重复名、越界、额外文件、本地头与中央目录路径/标志/压缩算法不一致。CRC-32 与真实流字节数逐项校验，不仅相信ZIP声明。

LibraryStore 仍是唯一业务数据库写者。所有媒体通过后写入摘要存储；revision、default、origin、entry_state、包记录在同一SQLite事务发布，提交中途失败全部回滚。提交前素材可能成为不可发送孤立文件，按协议保留待清理，不删除历史。重复同一版本幂等，同版本不同定义拒绝；导入增加新revision不会切换已有默认、改变归档或修改个人副本，也不依据rights.creator授予local归属。

导出所选确定版本（包括显式旧版本）与去重素材，不读取会话、设置、使用记录、凭据或本机路径字段。一个asset的所选当前版作包默认；未选择当前版时以该asset首个所选版本为默认。ZIP在私有临时文件写完后才返回，失败不提供看似完整的包，源库旧版本和素材保留。

`assets/base-library/base.amoji` 包含24个独立固定身份、25份真实素材：六组各四项，23静态、1动图及独立封面，所有定义具备fallback。素材复用既有制作成果；正式构建和首次加载均走同一完整包验证。新库只加载24项，旧用户库/三个历史样本/个人内容不删除。基础种子记builtin；从外部文件导入相同包仍记imported。

基础内容使用项目CC0-1.0声明，完整LICENSE及脱敏提示/来源见[基础库](../../assets/base-library/README.md)。旧开发样本原许可不改；私人库和第三方依赖不套用基础内容许可。ZIP依赖固定yauzl3.4.0/yazl3.3.1，实际依赖及原生Sharp/libvips许可边界见[依赖记录](../../assets/base-library/DEPENDENCIES.md)。没有外部发布或第三方权利保证。

## D4 接口

数据库4 / API2，能力名`packs-v1`；`ConnectedRuntime.packs` 仅在握手声明后提供。dsh分发入口同时要求原D2管理能力和包能力，不新增模型工具。

| 方法 | 成功结果 | 人类消费约束 |
| --- | --- | --- |
| `importPack(bytes: Uint8Array)` | `{pack_id, added, existing, defaults}` | added/existing计revision；defaults只是包默认，不能展示成已切换旧条目 |
| `exportPack(refs: ExpressionRef[], name: string)` | 完整`Buffer` | 1–200个精确版本；用户保存返回字节为.amoji |
| `selectRevision(ref, version)` | `LibraryEntry` | 显式人类CAS；拒绝local覆盖；保留origin/archived，实际切换才增version |

二进制导入通过认证POST `/packs/import`（application/zip），导出POST `/packs/export`（JSON `{refs,name}`）。均沿用service身份、secret、活跃connection验证及网页Origin拒绝；普通RPC14MiB限制不用于包字节。客户端包请求120秒超时；导入请求或响应正文损坏产生`PACK_OUTCOME_UNKNOWN`，应保留原文件并重试相同包。`ENTRY_CONFLICT`的current用于冲突恢复；`LOCAL_REVISION_PROTECTED`提示走个人编辑确认流程。模型search/resolve/emit合同未扩大。

## 实际自动证据

- 首次RED：新公共包测试2/2失败，服务无packs-v1且client.importPack不存在；实现后2/2通过。
- 第二轮RED：18通过、2失败，嵌套未知schema错误码尚未区分、基础包尚不存在；修复/生成后20/20通过。
- 后续RED→GREEN覆盖显式同asset多revision导出、普通ZIP空blobs目录、已提交后响应正文损坏的未知结果，以及中央目录合法但本地头藏越界路径。
- 受影响共享回归首轮66项：62通过、4失败。三处仍假设初始3样本，另一处在风格切换后拿首候选错误地当同一asset；对应断言修正后`tests/create.test.ts tests/library-management.test.ts tests/shared-claude-ticket.test.ts`共14项全部通过。创建面板同类旧计数失败已修正并通过；两个既有create-recovery测试通过（包含真实超过5秒操作）。
- `node --import tsx --test tests/packs.test.ts tests/dsh-host.test.ts`：45项通过（当时pack25项、host20项）；其后增补实际分发runtime与本地头边界，并完成最后包验证。
- 最终`node --import tsx --test tests/packs.test.ts`：27项全部通过，0失败/跳过，约4.34秒。含1001条目、260MiB实际输入、250MiB实际展开、伪造展开尺寸、CRC/缺素材/错误摘要/坏媒体、并发冲突、SQLite提交故障回滚、历史版本、实际打包runtime24项启动/导出重导入。
- `npm run typecheck`、`npm run build:dsh`、`git diff --check`通过；dsh BUILD声明packs-v1，运行模块、普通包与来源许可随构建复制。

没有重跑已有24素材制作矩阵，也没有运行全套alltest或真实模型/宿主旅程。D4负责认证Connection和UI消费，D5负责真实dsh图文评审、选取收发、跨会话与完整发行验收。以上自动证据不代表这些尚未执行的验收通过。
