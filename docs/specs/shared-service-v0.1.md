# Amoji 共享本地服务 API 2

票据 02 的实际适配合同，资产 JSON 仍遵守 [Amoji v0.1 协议](amoji-protocol-v0.1.md)。API 版本、数据库版本、插件版本和资产 revision 是不同标识。当前 API 为 2，数据库仍为 1；API 2 增加必需的绑定释放能力，新客户端与旧 API 1 服务明确拒绝握手并提示升级。三个受控样本作为首次内容写入真实持久版本库，未增加创建、导入、设置或其他宿主实现。

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
