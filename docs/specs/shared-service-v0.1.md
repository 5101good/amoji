# Amoji 共享本地服务 API 2

票据 02 的实际适配合同，资产 JSON 仍遵守 [Amoji v0.1 协议](amoji-protocol-v0.1.md)。API 版本、数据库版本、插件版本和资产 revision 是不同标识。当前 API 为 2，数据库为 2（票据 07 增加持久草稿，详见文末）；API 2 增加必需的绑定释放能力，新客户端与旧 API 1 服务明确拒绝握手并提示升级。三个受控样本作为首次内容写入真实持久版本库，票据 02 当时未增加创建、导入、设置或其他宿主实现；后续扩展见文末。

## 公共客户端

源入口为 `src/shared-client.ts`，插件产物入口为 `runtime/src/shared-client.js`。依赖 Node.js 24 或更新版本；原生依赖须匹配安装机器，构建会复制依赖与素材。无需模型调用、供应商密钥或 Amoji 账号。

```ts
import { SharedClient } from './runtime/src/shared-client.js';

const client = await SharedClient.connect();
// 上下文由可信宿主适配层获取，不能取自模型参数、网页或最近窗口。
const binding = await client.bind({
  host: 'codex',                 // codex | claude-code | dsh
  hostInstanceId: 'local',       // 稳定宿主实例；同一实例重连必须一致
  sessionId: trustedSessionId,
  turnId: trustedTurnId,
});
const { candidates } = await client.search(binding, '加油', 3);
const message = await client.emit(binding, candidates[0].selection_token);
const history = await client.history(binding);
await client.unbind(binding);
await client.close();
```

`connect({ directory?, apiRange?: { min, max } })` 自动发现/启动共享服务并验证身份及 API 范围，默认 API 范围为 `[2,2]`。`directory` 供明确的数据环境或测试隔离；日常适配器省略它，使用同一用户默认库。`identity` 包含 `serviceId`、`pid`、规范化 `dataRoot`、`apiVersion` 和 `databaseVersion`，没有进程凭据。`signal` 在连接失效或关闭时中止，适配器应取消自己的待选请求和界面关联；不自动重发未知状态的消息。

| 方法 | 参数 | 返回/行为 |
|---|---|---|
| `bind` | 可信宿主上下文 | 当前连接的随机绑定句柄；句柄不能跨连接使用 |
| `unbind` | `binding` | 幂等释放此操作的句柄；不删除消息或其他在途句柄 |
| `list` | 无 | 当前库的完整确定版本，仅供人类界面 |
| `resolve` | `{asset_id, revision_id}` | 精确完整版本，不支持名称或 latest；适配器返回模型前必须白名单投影 |
| `search` | `binding, query, limit?` | 纯文字候选与选择凭据；默认 3，范围 1–5 |
| `emit` | `binding, selection_token` | 服务从已存凭据取确定版本，保存 AI 消息 |
| `receive` | `binding, {asset_id, revision_id}, send_request_id` | 用户点选消息；普通配文仍由宿主传递 |
| `history` | `binding` | 当前宿主实例/会话的完整消息快照 |
| `presentation` | `binding, message_id, rendered\|fallback` | 只更新此会话的显示事实 |
| `blobPath` | 已验证 `sha256` | 校验保留字节后返回本地内容寻址路径；供人类渲染，不用于识图 |
| `close` | 无 | 只断开本连接，不删除库或终止其他客户端 |

这里的 `binding` 参数只存在于受信任适配层。模型仍只看见 `amoji_search(query, limit?)`、`amoji_resolve(asset_id, revision_id)`、`amoji_emit(selection_token)` 和用户请求时的空参数 `amoji_pick()`。核心不接受发送时改义、任意图像路径或目标会话覆盖。Codex 从已验证的 `_meta.x-codex-turn-metadata` 建立绑定；其 `hostInstanceId=local` 表示当前 OS 用户的 Codex 实例。其他宿主需要独立的可信上下文获取实现。

适配器应在操作完成的 `finally` 中调用 `unbind`，连接已中止时由服务统一释放。Codex 的 `ConnectedRuntime` 按操作取得并释放绑定，不维护每回合缓存；后到的新回合不会覆盖或释放其他仍在途的绑定。选择凭据按真实上下文与精确版本持久绑定，不依赖这个临时句柄，所以 search 与 emit 可以分别取得绑定。

`list/resolve/history` 是适配器和人类界面 API，不是模型工具的直接返回值。Codex 使用 `modelProjection` 白名单，仅返回 asset/revision、名称、固定语义和消息状态；AI 发送额外返回已选素材的 Markdown 文本引用与对应面板地址。图像字节不进入 MCP 模型内容块。

## 进程与发现

同一数据根的候选服务竞争 `service-lock.sqlite` 的 SQLite `BEGIN EXCLUSIVE` 锁。锁由内核/SQLite 生命周期持有，进程死亡自动释放。只有取得锁的进程能打开库写入器；其他候选等待已启动服务的健康握手。若候选以 75 退出且尚无有效发现记录，客户端在原 8 秒启动预算内短暂随机退避并重新竞选，避免所有竞争者退出后只等待无人发布的记录。磁盘上存在锁文件或 PID 不是健康证据。

取得锁并加载版本/素材后，服务仅监听 `127.0.0.1`，原子写入 0600 `service.json`。数据根及素材目录为 0700，数据库与素材采用用户私有权限。发现文件保存实际监听地址、随机服务凭据和身份；共享服务私有 HTTP 接口检查 Host、拒绝浏览器 Origin，并验证服务凭据与身份。浏览器面板通过自己服务的 Origin 与每会话能力令牌访问，不暴露共享服务的发现凭据。

客户端使用带凭据的 `/health` 核对服务 ID、进程、规范化数据根和 API 范围，再保持一条 `/connect` HTTP 连接作为生命周期租约。关闭或进程崩溃会让服务释放该客户端的绑定句柄；已消费的选择凭据及消息去重记录保存在 SQLite，不随适配器连接清空。后续适配器优先直接消费公共客户端，无需另写发现或抢锁逻辑。

有活跃连接时服务持续运行；全部连接离开后默认空闲 60 秒退出。`AMOJI_SERVICE_IDLE_MS` 可用于本地进程检查，测试只设置在自己创建的进程环境中。管理员可调用 `stopSharedService(directory, expectedServiceId)`：必须匹配当前身份且没有活跃客户端；等待原进程实际退出以确认内核锁释放，不以发现文件消失报告完成。仅用 PID 做存活检查，不通过 PID 终止程序。该停止接缝兼容已知 API 1/2 服务；停止不会删除库。进程收到 SIGTERM/SIGINT 时释放锁并关闭连接，适配器据 `signal` 收口待选。完整升级/卸载 UX 属于票据 17。

## 持久性与旧库

默认路径：macOS 为 `~/Library/Application Support/Amoji/prototype`；Linux 为 `$XDG_DATA_HOME/amoji`，未设置时为 `~/.local/share/amoji`；Windows 为 `%LOCALAPPDATA%/Amoji`，未设置时为用户 `AppData/Local/Amoji`。`AMOJI_DATA_DIR` 显式覆盖。macOS 保留原型目录名以继续支持已经发出的旧图像路径；目录名不表示每插件新建库。

新服务在 `library.sqlite` 持久保存所有确定版本、当前库引用、消息快照、用户发送请求 ID、AI 选择凭据及去重结果；素材写入 `blobs/<sha256>`。素材先校验并原子落盘，再事务写入版本与引用。相同 asset/revision 的异内容为 `REVISION_CONFLICT`；再次启动的种子不会重写当前版本或删除历史版本。消息和去重键同事务保存，显示回执按相同消息 ID 更新。

未消费选择凭据有效期仍为 5 分钟；启动、检索以及运行时每分钟清理已过期且未消费的记录。已消费凭据与对应消息具有相同保留期，当前不自动删除消息或其幂等记录，过期时间不会使成功操作的重试产生新消息。

首次初始化发现旧 `messages.sqlite` 时，以只读方式读取旧版本登记和会话快照，把所需素材复制到新 `blobs/`，并保留原 `messages.sqlite`、`samples/manifest.json` 和 `samples/blobs/`。事务完成后记录已初始化，后续启动不再合并旧原型写入。迁移失败不删除旧数据，也没有可发送的半迁移记录。切换到新版后应让旧原型适配器结束使用；本票不自动升级已运行的旧插件。用户如需回退，原数据仍在，但新版期间的新消息不会反向写入旧原型数据库。

宿主投递状态目前保守记录为 `pending`；面板能记录 `rendered/fallback`。HTTP 成功或工具返回都不能证明宿主已经把文字写入历史，因而不伪造 `acknowledged`。完整投递确认与故障恢复属票据 15。

## 失败语义与复验

客户端抛出带 `code` 的 `ServiceError`。服务启动错误使用 `SERVICE_START_FAILED`，消息保留具体原因，如 `DATABASE_INCOMPATIBLE` 或 `REVISION_CONFLICT`。

| 错误 | 处理 |
|---|---|
| `API_INCOMPATIBLE` | 提示升级，不连接/降级数据库 |
| `SERVICE_IDENTITY_MISMATCH` / `DISCOVERY_INVALID` / `DISCOVERY_UNSAFE` | 明确拒绝发现记录，不覆盖正在使用的服务 |
| `SERVICE_UNAVAILABLE` | 记录指向仍在运行但未通过健康握手的进程；不以 PID 存在当健康，不杀它 |
| `SERVICE_START_FAILED` / `SERVICE_START_TIMEOUT` | 启动或初始化失败，保留数据和具体原因 |
| `SERVICE_BUSY` | 仍有活跃客户端，管理员停止被拒绝 |
| `CONNECTION_CLOSED` / `BINDING_UNAVAILABLE` | 断开自己的待选操作，由真实宿主上下文重新关联 |
| `BINDING_MISMATCH` / `TURN_MISMATCH` | 凭据不属于此会话/回合，拒绝发送 |
| `REVISION_NOT_FOUND` / `BLOB_MISSING` / `BLOB_INTEGRITY_FAILED` | 明确缺失或损坏，不能换用名字相同的新版本 |
| `REQUEST_CONFLICT` | 同一用户请求 ID 不能变更所选版本 |

`npm run typecheck` 与 `npm test` 执行公开服务、真实独立 MCP、面板、迁移和独立产物检查；`tests/plugin-artifact.test.ts` 同时运行编译和插件构建。进程测试全部使用各自临时数据根，不启动真实模型，也不改用户安装配置。测试覆盖 macOS arm64 / Node 24.19.0；Linux/Windows 路径实现不是跨 OS 宿主实测。新版安装版 Codex Desktop 三样本收发、双任务、回放与实际请求检查由本票主控另行执行，不能用这些合同测试代替。

## Claude Hook 票据扩展（票据 03）

API 版本保持 2，数据库保持 1。`identity.capabilities` 可选数组新增 `claude-hook-tickets-v1`；旧 API 2 Codex 客户端忽略此字段，其绑定、搜索和消息语义保持不变。Claude 通过 `connect({requiredCapabilities:['claude-hook-tickets-v1']})` 在连接前检查能力；旧 API 2 服务没有此能力时抛出 `CAPABILITY_UNAVAILABLE`，不替换或重启运行中的服务。客户端的票据方法也检查此能力。

| 新增方法 | 可信输入 | 输出 |
|---|---|---|
| `issueClaudeTicket` | `{sessionId,promptId,invocationId,toolName,argumentsDigest}`，由 PreToolUse 读取宿主 stdin | `{ticket,expiresAt}` |
| `redeemClaudeTicket` | `{ticket,toolName,argumentsDigest,invocationId?}`，由 MCP 适配层构造 | `{context:{host:'claude-code',hostInstanceId:'local',sessionId,turnId},invocationId}` |

这两个方法是同一共享服务的受凭据保护本地 RPC，不是模型工具或浏览器端点。仅接受 `mcp__plugin_amoji_amoji__amoji_(search|resolve|emit|pick)`。签发记录固定真实身份、完整工具名和除 `_amoji_ticket` 外全部业务参数的 SHA-256 摘要。摘要按排序后的工具参数生成；当前工具只接受 primitive 参数值，不接受额外身份或语义字段。

票据使用 256 位随机值，仅保存在现有服务内存，有效期两分钟、单次兑换。Hook 连接关闭不删除票据；服务重启会清空票据。相同 invocation 的相同签发在有效期内返回原票据，冲突拒绝；已兑换的重放拒绝。过期记录定期或签发时清理，最多保留 10000 条，达到容量后拒绝签发。此临时凭据不承担持久消息去重；已保存消息和选择凭据继续由核心负责。

Hook 缺失 `session_id`、`prompt_id` 或 `tool_use_id` 即拒绝，不从 PID、CWD、转录、模型参数或工具 ID 推测回合；`agent_id` 或 `agent_type` 存在时拒绝，v0.1 不支持子代理及自定义 agent。Hook 覆盖保留字段，输出整份 `updatedInput`，省略 `permissionDecision`，仍经过宿主正常审批。MCP 兑换并剥离票据，只将返回的可信 context 交给 `ConnectedRuntime`，每次操作在 `finally` 释放绑定。可选 `_meta['claudecode/toolUseId']` 若出现会附加核对；默认路径不依赖这个未公开稳定性的字段。

新增失败包括 `CLAUDE_CONTEXT_UNAVAILABLE`、`CLAUDE_SUBAGENT_UNSUPPORTED`、`CLAUDE_INVOCATION_CONFLICT`、`CLAUDE_TICKET_UNAVAILABLE`、`CLAUDE_TICKET_MISMATCH`、`CLAUDE_TICKET_CONSUMED`、`CLAUDE_TICKET_EXPIRED`、`CLAUDE_TICKET_CAPACITY`。缺失或已被清理的过期票据返回 unavailable，尚在内存但已过期返回 expired。审批超过有效期后须重新发起调用，不自动重发未知结果。

Claude 普通插件的视觉在同一配套面板呈现，`amoji_emit` 不返回 Codex 专用的本地图像 Markdown；仅返回固定文字投影、消息状态和面板链接。`panel_opened` 只表示 OS 浏览器启动命令成功。面板重连以同一真实 session 读取历史，面板令牌和 URL 可换新，消息 ID 与 revision 不变。`amoji_pick` 必须由明确请求触发并在同次调用内返回文字语义；闲置面板无法主动插入 Claude 会话。未实现 Channels、宿主完成观察或投递确认状态机。

身份合同依据：[官方 Hook 输入与 prompt_id 最低版本](https://code.claude.com/docs/en/hooks#common-input-fields)、[插件 MCP 工具命名](https://code.claude.com/docs/en/hooks#match-mcp-tools)、[PreToolUse 参数修改](https://code.claude.com/docs/en/hooks#pretooluse-decision-control)、[普通插件结构与路径](https://code.claude.com/docs/en/plugins-reference)。完整回合合同要求 Claude Code 2.1.196+；这些官方接口与实际宿主验证分别记录，不能互相替代。

## dsh 空闲用户输入扩展（票据 04）

API 2 / 数据库 1 不变，新增可选 capability `dsh-idle-submission-v1`。dsh Host 连接时显式要求此能力；旧服务缺少能力时拒绝连接，不自动替换已有服务。

`BindingContext.turnId` 对 `host:'dsh'` 的用户 submission、history 和 presentation 可省略。该绑定表示用户选定的真实会话，不表示 AI 回合；不得用 requestId 或 tool callId 填充 turnId。Codex / Claude 绑定仍要求非空 turn。核心 `search` / `emit` 对所有宿主继续强制非空真实 turn，缺失时返回 `TURN_REQUIRED`，包括已经存在的选择凭据。

dsh 的用户提交使用现有 `receive(binding, ref, requestId)`，不新增数据库。其核心 messageId 与宿主 `prompt.requestId` 的关系及 inbox / user-message 观察状态由 dsh 自身会话事件保存；`receive` 返回或 inbox accepted 都不等于模型完成或图片已渲染。每操作 bind/unbind 行为保持不变。

## 媒体校验与动图呈现扩展（票据 06）

API 2 / 数据库 1 不变。`src/media.ts` 提供后续创建、导入和固定样本载入共同使用的媒体校验接缝：`validateMediaBlob` 对一个声明与字节做校验，`validateExpressionMedia` 对主图、动画声明和独立封面做整体校验。校验先限制单素材 10 MiB、声明尺寸和允许容器，再用受像素及通道限制的解码器读取真实格式、尺寸、帧数和逐帧时长，最后强制完整像素解码。只读 metadata 不构成成功。

静态容器仅接受 PNG、JPEG、WebP；动图仅接受 GIF、animated WebP。实际格式、尺寸及动画性必须与声明一致。静态定义不得包含 `duration_ms` 或 `poster`；动图必须包含与真实逐帧时长精确一致的 `duration_ms`，以及摘要不同且实际解码为静态图的独立封面。明确拒绝 APNG、SVG、HTML 和其他未约定容器。边长上限 2048，动图上限 10 秒、200 帧，累计解码像素上限一亿。

共用面板和 dsh Client 默认按 `prefers-reduced-motion` 决定是否显示同一版本的静态封面；用户可以显式播放或暂停，系统偏好切换到减少动态效果时重新显示封面。播放状态只影响人类视觉，不修改版本、消息快照或模型文字投影。浏览器解码失败和服务端 `BLOB_MISSING` / `BLOB_INTEGRITY_FAILED` 都保留该消息快照的原始 fallback 与明确原因，不识图、不查同名新版。面板 blob HTTP 对缺失返回 404、完整性失败返回 422，不返回图片成功体。

## 手工创建扩展（票据 07）

资产协议仍为 `0.1`，API 仍为 `2`；数据库升级为 `2`，健康握手新增 `create-drafts-v1` 能力。API 2 的现有搜索、发送、绑定和 Claude/dsh 合同不变。旧客户端可连接新服务；新客户端的创建方法会先核对能力，旧服务返回 `CAPABILITY_UNAVAILABLE`，不会误认为写入成功。旧服务直接打开数据库 2 时应拒绝降级。三个构建器的 BUILD 记录实际 `serviceApi`、`databaseVersion`、`providedManagementCapabilities`，统一读取核心常量。

以下是供可信适配层和人类管理面板调用的公共 `SharedClient` 方法，不注册为模型工具：

| 方法 | 参数 | 行为 |
|---|---|---|
| `createDraft` | 无 | 创建空白持久草稿，返回 `draft_id`、`version=1`、`updated_at`、`fields` |
| `listDrafts` | 无 | 返回本机所有未确认草稿，与宿主、会话及客户端连接无关 |
| `getDraft` | `draft_id` | 恢复已保存内容、验证过的视觉描述及确认结果 |
| `saveDraft` | `draft_id, version, fields, upload?` | 乐观并发保存，递增草稿版本；`upload` 为原始单素材的规范 base64 字节，省略时保留原图 |
| `previewDraft` | `draft_id, version` | 严格校验语义和完整媒体，返回同一草稿的预览；不创建资产身份 |
| `confirmDraft` | `draft_id, version` | 明确确认并原子生成完整 `Expression`；同一草稿同版本重复确认返回同一资产版本 |

`fields` 只接受 `name`、`semantics`、`rights` 和可选 `tags`。嵌套对象也拒绝未知字段。保存允许未填写完的空白文字及超过最终字段长度的有界输入，以便保留草稿；每字段最多 16 KiB、列表最多 64 条、整份文字最多 64 KiB。预览/确认按协议严格检查非空白、Unicode code point 长度、列表限制与去重，以及 UTF-8 序列化 `{name, semantics}` 的 4 KiB 预算。不会截断字段。模型或上传调用不能提供 `asset_id`、`revision_id`、`created_at`、`schema_version`、`origin` 或视觉声明来伪造身份、日期、协议及归属。完整确认定义再次经启用 `date-time` 的 Schema 验证器校验。

草稿身份为 `draft_<uuid>`，没有可发送 `asset_id/revision_id`。`drafts` 表独立于 `revisions/library_entries`，确认前 `list/search/resolve/emit/receive` 都不能将草稿作为版本使用。草稿视觉只通过带面板能力凭据的人类图片通道可见。确认事务同时写入不可变版本、当前库条目、`expression_origins.origin=local` 和草稿的确定确认结果。`rights.creator/source` 只是用户说明，不参与本机作者归属判断。已确认草稿拒绝保存；旧预览版本返回 `DRAFT_CONFLICT`，必须恢复并重新预览。

`prepareUploadedMedia` 位于 `src/media.ts`，从实际上传字节推导格式、尺寸和动画信息，再复用票据 06 的完整解码与全部媒体预算。动图自动提取第一帧为独立 PNG 封面，并再次做静态媒体校验。内容寻址字节先写入不可变存储，草稿保存及确认都不会提交半可用资产。写入素材后事务失败可能留下无版本引用的字节，本票不做清理或删除。预览和确认会再次验证保留字节；损坏或丢失不会靠同名表情补图。

共用面板增加 `/api/drafts`（GET），以及 `/api/draft/create|get|save|preview|confirm`（POST），沿用面板原有 Host、Origin、随机能力令牌边界。浏览器不获取共享服务秘密。上传请求最多 14 MiB（含 base64 开销和草稿文字）；其他面板写入仍限 4 KiB。HTTP 按原始字节计量并在完整拼接后解码 UTF-8，避免跨网络分块破坏补充平面字符。

用户通过“新建草稿 → 上传并填写 → 保存/预览 → 确认或返回修改”操作；语义错误保留输入，素材错误不替换已存草稿。草稿恢复在新宿主面板、MCP 重连及共享服务重启后可用。确认前可以播放/暂停动图，减少动态效果时显示同一草稿的封面。确认成功后共用面板刷新、选中新版，仍须点击发送，目标沿用当前面板的真实宿主会话。

Codex/Claude 使用现有共用面板入口。dsh 原生 Picker 的“创建自己的表情”通过人类 RPC `amoji/manage({sessionId})` 请求管理面板地址；Host 验证会话并生成能力，Client 显示供用户打开的链接。该 RPC 不创建回合、不发送 prompt，也不成为模型工具。创建完成后返回 dsh Picker，点击“显示全部”读取同一共享库并经原有 submit 发送；面板不会伪造 dsh 的 pending pick。Adapter 卸载或核心连接失效会关闭管理面板。

数据库 1→2 仅增加 `drafts` 与 `expression_origins`，保留原版本、库条目、消息快照、选择凭据及素材；既有资产不因迁移被重新标为本机作者。本票不提供建议、版本编辑、包导入或永久删除。

### 创建请求恢复与预览就绪（07 第一轮审查修补）

`saveDraft/previewDraft/confirmDraft` 的公共客户端预算为 60 秒，其他 RPC 仍为 5 秒。保存或确认的传输超时/响应丢失返回 `DRAFT_OUTCOME_UNKNOWN`，表示可能仍在处理或已经提交，不能据此新建或覆盖；预览的传输问题返回可重试的 `DRAFT_PREVIEW_UNAVAILABLE`。调用方保留原保存请求或原确认 `draft_id/version`，用户明确操作后进行核对，不无限自动重试。

服务把保存意图（原 `version`、完整 `fields`、`upload` 或 null）的规范化 JSON SHA-256 存入本地草稿 `last_save: {base_version, request_hash}`。重试在版本 CAS 前核对指纹，一致时返回同一保存结果；有后续不同保存时仍拒绝旧版本。该状态与草稿同事务持久化、随重启保留，不新增表、不改变 DB2/API2、不进入可分享资产。面板在未知保存结果期间锁定输入并提供“核对保存结果”，使用保留的完整载荷重试；已确定的字段/媒体错误则保留可编辑输入。

面板只有当前草稿版本、输入快照和当前预览 generation 的图片成功 `load` 后才允许确认，确认处理器再次核对。换图、播放/暂停、错误、返回修改、新预览、换草稿及输入变动取消资格；旧图片的迟到事件无权启用新预览。图像就绪判断只在人类界面，不构成模型图片输入。

## 文字建议扩展（票据 08）

API、数据库和资产协议仍分别为 `2`、`2` 和 `0.1`；健康握手新增 `text-suggestions-v1` 管理能力。`suggestText(intent, notes?)` 只接受文字意图和可选的逐行适用语境说明，返回 `local-deterministic-v1` 候选及清楚的能力说明。当前实现使用本机确定性文字规则，不调用模型、不要求供应商密钥，也不读取草稿、图片、blob、文件路径、宿主会话或已确认 revision。越过最终名称、含义和语境边界的输入明确拒绝，不自动截断。

建议调用不写数据库。面板把返回值放在独立待选区，用户可以修改、拒绝或放弃；只有明确点击“采用到草稿”才把当时可见的候选复制到未保存表单。采用仍不等于保存、预览或确认。服务不可用、请求超时或用户取消时，原文字输入、手工字段和已保存草稿保持不变，完整手工流程继续可用。

每次请求绑定面板当时的草稿对象、版本、手工字段快照、文字意图和补充说明。上述任一内容变化、切换或新建草稿、取消、页面关闭及后发请求都会使旧结果失效；迟到响应无权显示或覆盖。建议能力不注册为模型工具，不改变 Codex `display_markdown`，也不能修改已确认草稿或不可变 revision。三个构建产物的 `providedManagementCapabilities` 同时声明 `create-drafts-v1` 与 `text-suggestions-v1`。
