# 05 实现报告：搜索表情并让 AI 按语境选择

## 基线与范围

- 工作树：`/Users/leilei/develop/amoji/.worktrees/v0.1-completion`
- 分支：`codex/v0.1-completion`
- 固定起点：`b3cd64a96cbfa780aa567b2326acf5b80f936e72`
- 仅实现票据 05。未修改用户安装或配置，未调用真实宿主模型，未实现 06–19。
- `docs/planning/implementation-status-v0.1.md` 由 root 维护，本提交不包含该文件。

## 实现

### 共享确定性检索

- 新增 `src/search.ts`，由共享服务、样本运行时和面板 HTTP 边界复用。
- `query` 按原始 Unicode code point 校验为 1–240，拒绝纯空白；`limit` 默认 3、范围 1–5。
- 使用 NFKC、中文分词和确定性字段权重检索名称、标签、含义、fallback、tone 与 `use_when`；同分保持库顺序。
- `avoid_when` 参与冲突降权但不单独产生正向候选，因此“痛苦”不会仅因庆祝表情的禁用语境而推荐庆祝。
- 只搜索当前 `library_entries` 中可发送的精确版本；无匹配返回空数组，不使用首项兜底，不调用远端向量、分类或视觉模型。

### 模型输出预算与凭据

- `amoji_search` 结果由共享装配器生成，整个实际文本 JSON（候选、政策、精确引用和凭据）上限为 8192 UTF-8 字节。
- 候选保持完整 `name + semantics`，包含完整 `avoid_when`；超预算时只减少候选数量，不裁剪字段。
- 最大字段测试种子经公开 `SampleCatalog.load` 边界验证，单候选 `name + semantics` 为 3936 字节；5 个匹配候选在预算内保留 1 个，实际模型文本为 4299 字节。
- 每个返回候选使用 24 个随机字节生成 32 字符 base64url 凭据，保存精确版本、可信宿主 session/turn 和 5 分钟到期时间。未进入预算的候选不保存凭据。
- `emit` 继续先校验会话/回合，再优先返回已消费凭据的原消息；未消费凭据检查 5 分钟期限、每回合上限和当前版本可发送性。
- 搜索输出只有一个 text block，不提供 `structuredContent`，候选不含 `visual`、blob、媒体或路径，也不在其他字段重复完整语义。

### 面板

- 新增带标签的文字搜索框、搜索/显示全部入口、候选计数和明确空状态。
- `/api/search` 受现有面板 capability 与来源校验保护，调用同一个共享检索函数。
- 搜索结果可点选，预览含义、语气、适用/不适用语境和精确版本；发送按钮继续绑定面板已有的明确宿主 session 与 pending pick。
- 使用 JSDOM 执行真实 `web/panel.js` 并断言真实 DOM，而非只检查 JSON。

## 公共接口与兼容处理

- 新增面板接口：`GET /api/search?query=<text>&limit=<1..5>`，返回 `{ expressions }`；参数错误返回 400。
- `SampleCatalog.search(query, limit?)` 签名不变；共享服务 `search` RPC 和三端 `amoji_search` 返回形状不变。
- dsh 既有三候选测试原来以 `locale=zh-CN` 命中整库；票据 05 明确索引字段不含 locale，因此改用三个样本 `use_when` 都包含的“时”。三候选、精确版本、纯文字投影、无媒体进入模型等原断言全部保留。
- Codex `emit.display_markdown` 与 dsh 隐藏展示元数据属于前票已验证的人类展示链路，本票保持不变；“候选不返回媒体/路径”只约束 `amoji_search`。

## 测试与命令

### TDD 失败检查

命令：

```bash
npm run test:file -- tests/catalog.test.ts tests/runtime.test.ts tests/mcp.test.ts tests/panel.test.ts tests/panel-ui.test.ts
```

首次结果：10 项中 5 项通过、5 项失败；有效失败暴露跨字段中文查询、8 KiB 输出、面板搜索 HTTP 和真实 DOM 缺口。另一个失败来自最初把“候选不返回路径”误套到既有 `emit.display_markdown` 的测试假设；root 澄清范围后删除该错误假设并保留票据 01 的展示断言。实现后同命令 10/10 通过。

### 最终验证

```bash
npm run typecheck
```

结果：退出码 0，`tsc --noEmit` 无错误。

```bash
npm run build
```

结果：退出码 0，`tsc` 构建完成。

```bash
npm run test:file -- tests/catalog.test.ts tests/runtime.test.ts tests/mcp.test.ts tests/panel.test.ts tests/panel-ui.test.ts tests/shared-service.test.ts tests/shared-mcp.test.ts tests/claude-adapter.test.ts tests/dsh-host.test.ts tests/plugin-artifact.test.ts
```

结果：35/35 通过，0 失败，耗时约 11.2 秒。覆盖共享服务、真实 MCP、Claude Hook/MCP、dsh Host、Codex/Claude 构建产物、面板 HTTP 与真实 DOM；未重复未修改的完整三端产物矩阵。

预算测量命令使用与测试相同的最大字段候选调用 `searchExpressions` 和 `buildSearchResult`；结果：

```json
{"semanticBytes":3936,"candidates":1,"modelTextBytes":4299,"budget":8192}
```

## 工具成本边界

- 无合适候选：一次 `amoji_search`，返回空候选，随后直接文字回应。
- 有合适候选并发送：一次 `amoji_search` 加一次 `amoji_emit`。
- 搜索候选已经包含完整语义和精确引用，正常选择不需要额外调用 `amoji_resolve`。
- 每次搜索最多返回 5 个候选，且受 8 KiB 实际文本预算进一步收缩；不注入整库，不产生远端检索、分类、识图或媒体 token 成本。
- 面板搜索是本地 loopback HTTP 请求，不是模型工具调用。

## 待验收

- 本票未把自建 MCP 客户端称为真实模型验证。
- 安装版 Codex 中“模型根据自然语境自主选择合理候选”以及“无合适候选时只用文字回应”的真实请求闭环，按安排留给票据 19 统一执行和回填；在该证据补齐前不宣称票据 05 的全部真实宿主门槛已关闭。
