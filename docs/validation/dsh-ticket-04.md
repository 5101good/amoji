# dsh Host / Client 适配（票据 04）

实现已完成；固定源码边界、独立构建及组件检查通过。**完整 dsh 宿主未运行，不能据此宣称真机支持。** 本机 `command -v dsh` 无结果；按本票授权不安装整套宿主、不配置供应商、不发模型请求。

## 固定兼容边界

- 官方源码提交：`d347e703908d0406b7a7ef80e3a0e594d86b2215`，dsh `0.1.3-alpha.1`，Cordis `4.0.2`；Client 检查用共享 React `19.2.4`。
- [工具 schema / defineTool](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/tools/src/schema.ts)、[Connection 公共 RPC](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/connection/src/rpc.ts)、[Session 标准 props](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/ui-session/src/client/index.ts)、[loader 格式](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/tsdown.client.ts) 是实际采用的接口。
- `scripts/dsh/baseline.json` 固定 14 个必要源码文件的 Git blob SHA；`prepare-baseline.mjs` 获取精确文件、验证散列并编译官方 `defineTool` / `SlotCore`。不下载整个仓库，也不替换为空模块或 SDK 假实现。
- `src/dsh/contracts.ts` 是适配器实际消费的窄结构端口，使用 strict TypeScript；不是全套 dsh SDK 声明。已对真实基线 `defineTool`、`SlotCore` 运行检查；**没有跑完整 dsh monorepo 的类型检查、依赖组合或原生会话存储**。Host 身份、投影、Connection 载体及会话 flush 在独立检查中由明确的测试端口提供。

## 实现

`adapters/dsh` 是发布包源，含 `dsh.bundle.patch`、`dsh.client.platform=web` 和 `./client` 导出。`npm run build:dsh` 生成 Host 共用服务 runtime、精确样本 blobs、loader `client.js` 和 `BUILD.json`。runtime 直接复制本项目同一核心构建结果；数据仍经同一个 SharedClient 发现服务写入，没有第二套数据库或版本算法。npm 包依赖安装后可用，未把 native sharp 称为跨平台预装产物。

Host 注册 `amoji_search` / `amoji_resolve` / `amoji_emit`。`amoji_resolve` 仅接受 asset_id/revision_id，从同一核心读取精确版本并返回 modelProjection 文字，不创建消息或视觉元数据。入口从 `exec.agent.id/session`、`callId/rootCallId` 与 `turnBoundary.openTurnStartSeq` 同步冻结上下文；模型 schema 没有 session / turn。要求 session 对象属于 Host registry，await 后检查取消和身份变化。不同调用 ID 在同一真实回合共用同一个核心 turn；不会拿调用 ID 当回合。取消与切换不会改投另一个会话；已提交到共享核心的原会话记录保留，不能把后续失败称为已投递。

`output.render` 仅产出 text blocks，内容来自核心固定语义；`presentationMeta` 保存 messageId / ref / visualHash / posterHash / alt。客户端以真实 wire name `amoji_emit` 注册 keyed `tool.call.toolview`，读取持久 `block.meta`；`conversation.input.left` 提供选择器，`conversation.composer.dock` 显示持久核心历史。Session 标准 `sessionId` 来源于宿主 Session binding / SessionFace；打开选择器时冻结，切换会话关闭，不转投。选择器按 session key 分离状态，旧实例销毁时 abort，所有异步完成回调核对 generation；History 快照记录所属 session，只渲染当前会话行。三个 Slot 注册由同一个 effect 持有 disposer，卸载或部分注册失败时逆序释放，可以重新 apply。

浏览器通过已认证 Connection 的 `/api` 受限 `amoji/{catalog,history,visual,submit,display}` 端点，不能取得核心凭据或任意文件路径。RPC 只允许确定字段；视觉按有效会话、精确 ref 和消息归属验证后读取核心 blob；data URL 仅返回人类 UI 通道。图片组件核对版本、hash 和 alt，提供静态封面/播放/暂停、加载成功与失败回执，失败显示固定文字。失败细节保存为 `amoji/display` 事件，核心已有 `fallback` 状态继续兼容。回执保存失败会显示错误。

用户输入通过 `sessionController.prompt`，content 只有核心语义 text。共享核心 `requestId` 幂等映射 messageId，宿主请求稳定为 `amoji:<messageId>`；`amoji/submission` 记录该关系，`amoji/accepted` 只记录 inbox accepted。历史读取 `source.rpcId` 对应的 `user/message`，返回真实 host message ID / seq 和此前 `turn/start`，不把 accepted 当完整投递或人类已读。提交前要求 `sessions.flush` 存在参与的持久化监听；缺少监听或失败都拒绝发送。重试始终沿用原 ID。同 key 的幂等 submit job 使用独立 30 秒协作超时，各 RPC waiter 的 abort 只结束自身等待；包括首个 waiter 在内，均不影响其他等待者。所有等待者取消后，已接纳的 job 仍继续完成并保存结果，不重新投递或丢掉未知状态；宿主必须合作响应 timeout signal，不能将超时信号称为强制终止。

公共服务保持 API 2 / 数据库 1，新增可选能力 `dsh-idle-submission-v1`。只允许 dsh 的 idle submission/history/display 绑定省略 turn；Codex/Claude 仍必需真实 turn；AI search / emit 在核心再次拒绝空 turn。ConnectedRuntime 的每操作 bind/unbind 继续复用。

## 实际已运行

```sh
npm run typecheck
npm run test:dsh
npx tsx --test tests/test-runner.test.ts
npx tsx --test tests/shared-service.test.ts tests/shared-mcp.test.ts tests/shared-claude-ticket.test.ts tests/claude-adapter.test.ts
npm pack ./adapters/dsh --ignore-scripts --pack-destination .cache/dsh-package --json
git diff --check
```

- 第一轮限定修复后 10 个 dsh 检查：真实官方 defineTool 与实际适配入口；缺身份/伪会话/空回合/额外模型参数拒绝；三样本固定文字和精确 hash；双会话隔离；同回合跨工具选择；取消/切换；idle submission、同 requestId 冲突与重试、序列化历史重建；无持久化监听和重试都拒绝；resolve 第三工具严格精确解析、无发送副作用；Slot 卸载和部分失败恢复；pending 切换与独立 waiter 取消。
- 打包 Host 入口实际导入并连接测试私有目录中的真实共享服务；其真实工具依赖由固定源码编译加载。Connection RPC 的分发、字段与会话拒绝运行过，底层真实浏览器 HTTP/认证载体未运行。
- 实际 `client.js` 在 loader 环境通过共享 require 加载 React；官方 SlotCore 验证三个 slot 注册，JSDOM + ReactDOM 真正挂载，触发 img load/error、动图播放、用户选择和会话切换。JSDOM 不解码图片，也不是原生浏览器或 dsh UI 验收。
- 初版 12 个公共兼容检查通过，覆盖 Claude Hook/MCP、共享服务协商、绑定释放、重启和 Codex MCP；没有重跑票据 01 完整真机矩阵。
- 修复过的实际检查失败包括 JSX 自动 runtime 导致的 loader 额外依赖、选择器嵌套 button、测试 React 清理次序和测试查询不匹配样本。上述失败均已修复并重跑，不记为跳过。

## 第一轮限定修复的验证范围

只运行 `npm run typecheck`、`npm run test:dsh`（10/10）、`npx tsx --test tests/test-runner.test.ts`（1/1）、重新打包和差异检查；没有重跑上述初版 12 项或无关矩阵。无网络检查先清除子进程的 NODE_TEST_CONTEXT，避免 Node 将选定回归当作递归 test runner 而跳过；实际执行默认 runner 的投影用例，PATH 无 curl 且 net/tls/fetch 禁用。

`npm test` 现在由 `scripts/test.mjs` 只发现非 `dsh-*` 普通回归，无隐式下载。源码下载单列为 `npm run prepare:dsh`，`npm run test:dsh` 显式执行它并保留全部真实基线验证；首次 dsh 专项需要 curl/网络或已经按散列验证的本地缓存。默认普通测试不依赖 `.cache/dsh-source`。

BUILD 元数据硬编码（P3）按本轮指示 deferred，未改动。

## 真机补验（本次全部未运行）

前置：固定提交的已构建 dsh Host/Web Client、Node 24+、已有模型路由和认证、可用浏览器。安装行为须在后续获授权环境执行；本次没有写任何用户 dsh 配置。

```sh
# 在本项目生成可分发包
npm ci
npm run test:dsh
mkdir -p .cache/dsh-package
npm pack ./adapters/dsh --ignore-scripts --pack-destination .cache/dsh-package
# 在固定提交的 dsh 环境；使用实际绝对包路径
# dsh plugin --profile web add /absolute/path/amoji-dsh-0.1.0-dev.1.tgz
# dsh web
```

1. 观察真实插件装载、服务注入与 Connection 认证，然后分别发送三样本。核对固定 ref/语义、静态与动图 UI、onLoad/onError 回执；故意破坏图片请求应显示 fallback。
2. 同时开 A/B 会话：A 打开选择器，切换 B；确认关闭或仍绑定 A，不出现投向 B 的 prompt。让 A/B 各自工具检索并发送，观察真实 turnBoundary 与 exec 身份，不接受模型伪造参数。
3. 捕获浏览器 `/api` 与 provider 请求：prompt / tool content 只能有文字语义，媒体编码仅在人类 `amoji/visual` RPC；检查用户 requestId 与真实 `user/message.source.rpcId` 对齐。
4. 等待真实持久化 flush、重载页面并重启宿主；确认核心 messageId、ref/hash、工具 `result.meta`、用户消息和历史 UI 可恢复。捕获 accepted、observed、渲染回执的不同阶段；不能只看 HTTP 成功。
5. 真机请求取消、关闭会话、重试相同 requestId 与缺少持久化监听，确认不会串投，也不会将未确认状态报告为已完成。

这些宿主/供应商/浏览器观察条件均缺失，交由后续宿主验收；独立源码检查不能代替它们。
