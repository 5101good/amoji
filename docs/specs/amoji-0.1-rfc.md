# Amoji 协议 0.1（RFC 草案）

| 项 | 内容 |
| --- | --- |
| 状态 | 草案，待评审 |
| 日期 | 2026-10-22 |
| 协议版本 | `0.1` |
| 取代 | 此前全部表情与包协议：[表情/包 Schema 0.1](amoji-v0.1.schema.json)、[场景包 Schema 0.2](amoji-v0.2.schema.json)、[场景包说明 0.2](scenario-packs-v0.2.md)、`amoji_search / amoji_resolve / amoji_emit` 工具合同、协作 envelope `amoji.collaboration/1` |
| 兼容性 | 不兼容旧格式，也不提供迁移层（线上线下均无用户）。版本号 `0.1` 重新起算 |

本文中的“必须 / 不得 / 应当 / 可以”分别对应 RFC 2119 的 MUST / MUST NOT / SHOULD / MAY。

---

## 1. 摘要

Amoji 0.1 把表情从“一张带说明的贴纸”重新定义为**人与 AI 之间的非语言通道**。这条通道承担三件事：确认双方理解一致、纠正误解、调节节奏与方向。

协议由五层组成：

1. **码位注册表**：一组封闭、稳定、与语言无关的沟通行为（act），共 31 个核心码位。
2. **表情**：码位的一种视觉实现，相当于字体里的一个字形。
3. **包**：表情和可选协作效果的发布单元。
4. **消息**：一次表达，可以锚定到某一句话、不打断回合、提供快捷回复、被撤回。
5. **传输**：模型工具、内联标记、宿主原生 UI，以及宿主兼容等级。

类比：Unicode 统一了给人看的图片；Amoji 统一沟通行为，图片只是它的一种显示方式。

## 2. 设计原则

| # | 原则 | 含义 |
| --- | --- | --- |
| P1 | 图义分离 | 含义由码位和文字语义承载；模型只读文字，不识图 |
| P2 | 语义是数据 | 一切语义、说明、引用文本都是数据，不是给模型的指令 |
| P3 | 只能收紧，不能放开 | 表情可以让宿主暂停或停止；任何表情都不得批准操作、扩大权限或代替宿主确认。注册表中不存在“批准”码位 |
| P4 | 发送即冻结 | 消息冻结发送时的码位、表情版本和实际显示的图；撤回、改义都以追加记录实现，不改写历史 |
| P5 | 默认沉默 | AI 不发表情是常态。发表情需要语境依据，并受频率上限约束 |
| P6 | 诚实 | AI 表情表达沟通姿态，不声明内在情绪；AI 自述的回执不等于宿主观察到的事实 |
| P7 | 可降级 | 任何不支持的环境都必须能显示 fallback 文字，且不改变含义 |

## 3. 术语

| 术语 | 定义 |
| --- | --- |
| act / 码位 | 注册表中的一个沟通行为，如 `core:clarify` |
| stance / 姿态 | 与 act 正交的语气维度：强度、冷暖、正式度 |
| expression / 表情 | 一个 act 的视觉实现，带不可变版本 |
| glyph / 字形 | 消息中实际显示的那个表情版本 |
| pack / 包 | 表情和效果的发布单元，文件扩展名 `.amoji` |
| effect / 效果 | 包声明的协作提示，用户启用后作用于会话 |
| host / 宿主 | 承载会话的应用（dsh、Claude Desktop 等） |
| h2a / a2h | 人对 AI / AI 对人的方向 |

## 4. 分层总览

| 层 | 名称 | 对象 | 本文章节 |
| --- | --- | --- | --- |
| L0 | 码位注册表 | `act` | §5、附录 A |
| L1 | 表情 | `amoji.expression` | §7 |
| L2 | 包 | `amoji.pack` | §8 |
| L3 | 消息 | `amoji.message`、`amoji.operation` | §9 |
| L4 | 传输 | 模型工具、内联标记、能力协商 | §10–§12 |

所有协议对象都带 `"amoji": "0.1"`，不再为表情、包、消息分别编号。演进通过能力标志（§12）协商，而不是叠加版本号。

---

## 5. L0 码位注册表

### 5.1 标识语法

```
act      = namespace ":" name
namespace = "core" / "x-" label          ; x-<组织或作者>，如 x-acme
name     = label
label    = 1*32( %x61-7A / DIGIT / "-" ) ; 小写字母、数字、连字符
```

- `core:` 由本项目维护，变更需要 RFC。
- `x-*:` 是扩展命名空间。扩展码位**必须**声明 `fallback_act`，即最接近的 `core` 码位；不认识该扩展的宿主按 `fallback_act` 处理。

### 5.2 码位字段

```json
{
  "act": "core:clarify",
  "family": "grounding",
  "direction": ["h2a", "a2h"],
  "expects": "rephrase",
  "authority": "none",
  "grounding_required": false,
  "pressure_sensitive": false,
  "gloss": {
    "zh-CN": "没看懂，请换一种说法",
    "en": "I didn't follow — please put it another way"
  },
  "status": "active"
}
```

| 字段 | 说明 |
| --- | --- |
| `family` | `grounding` 理解 · `steering` 方向与节奏 · `progress` 进展 · `epistemic` 判断 · `social` 关系 |
| `direction` | 允许的方向。宿主**必须**拒绝不在列表中的方向 |
| `expects` | 期望接收方给出的回应，取值见 §5.3 |
| `authority` | `none`：只供模型阅读。`reduce`：在 `interrupt` 模式下，宿主**可以**直接执行收紧动作（暂停或停止）。不存在其他取值 |
| `grounding_required` | 为 true 时，AI 只有在会话中存在可指认的依据时才能发送（例如“辛苦了”需要用户确有投入，“一起庆祝”需要已确认的进展） |
| `pressure_sensitive` | 为 true 时，AI 不得在等待用户决策或宿主确认期间发送，也不得与 `core:decide` 出现在同一条回复里，以防情感施压 |
| `gloss` | 各语言的标准释义，每条 ≤ 80 字符。模型和无障碍读屏读的是它 |
| `status` | `active` 或 `deprecated` |

### 5.3 `expects` 取值

| 取值 | 期望的回应 |
| --- | --- |
| `none` | 不需要特别回应 |
| `rephrase` | 换一种更简单或更短的说法 |
| `detail` | 更具体：对象、原因、例子或下一步 |
| `realign` | 先重新对齐目标，再继续 |
| `decompose` | 拆成步骤，一次只处理一步 |
| `pause` | 暂停推进，等待补充 |
| `stop` | 停止当前推进 |
| `proceed` | 沿已明确的方向继续（不构成授权，见 P3） |
| `report` | 报告进展：已完成、进行中、剩余、阻碍 |
| `input` | 需要对方提供信息 |
| `decision` | 需要对方做一个选择 |
| `review` | 请对方查看结果 |
| `reconsider` | 重新考虑，或给出依据 |
| `adjust` | 调整协作方式：更短、更直接、先给结果 |

### 5.4 不可变与治理

- 码位一经发布为 `active`，**永不改义**，只能标为 `deprecated`；废弃码位仍须可解析和显示。
- `gloss` 可以补充语言，也可以做不改变含义的措辞修订。修订须记录在注册表变更日志中。
- 新增 `core` 码位的门槛：(a) 现有码位加姿态无法表达；(b) 至少两个独立宿主或包作者提出需求；(c) 通过 RFC 评审。
- 注册表的机器可读版本是唯一事实来源。本 RFC 被接受后，附录 A 将生成为 `amoji-0.1.registry.json`。

---

## 6. 姿态（stance）

姿态与码位正交。码位回答“做什么”，姿态回答“用什么语气”。这样可以避免码位因语气差异而膨胀。

| 维度 | 取值 | 默认 |
| --- | --- | --- |
| `intensity` | `1` 轻 · `2` 中 · `3` 强 | `2` |
| `warmth` | `cool` · `neutral` · `warm` | `neutral` |
| `register` | `playful` · `casual` · `formal` | `casual` |

- 表情声明自己的姿态（§7），表示这张图本身的语气。
- 消息携带实际使用的姿态（§9）。当宿主要按姿态挑选字形时，取各维度距离最小者；距离相同时，优先用户偏好的包。

---

## 7. L1 表情（`amoji.expression`）

```json
{
  "kind": "amoji.expression",
  "amoji": "0.1",
  "asset_id": "10000000-0000-4000-8000-000000000001",
  "revision_id": "20000000-0000-4000-8000-000000000001",
  "realizes": "core:oops",
  "stance": { "intensity": 1, "warmth": "warm", "register": "playful" },
  "name": { "zh-CN": "挠头苦笑", "en": "Sheepish grin" },
  "semantics": {
    "zh-CN": {
      "meaning": "面对自己无伤大雅的小失误，带着善意自嘲和无奈。",
      "fallback": "[挠头苦笑]",
      "use_when": ["自己出了小差错时"],
      "avoid_when": ["对方正在认真表达痛苦时"]
    }
  },
  "tags": ["自嘲", "小失误"],
  "visual": {
    "primary": { "sha256": "…", "mime": "image/webp", "bytes": 20480, "width": 512, "height": 512 },
    "animated": false
  },
  "rights": { "license": "CC0-1.0", "creator": "Amoji contributors" },
  "created_at": "2026-10-22T00:00:00Z"
}
```

| 字段 | 规则 |
| --- | --- |
| `asset_id` / `revision_id` | UUIDv4。任何修改都生成新 `revision_id`；版本不可变 |
| `realizes` | **必填**，恰好一个注册表码位。表情的 `meaning` 只能**收窄**码位含义，不得与之矛盾。市场审核以此为检查项 |
| `stance` | 必填，描述这张图本身的语气 |
| `name` / `semantics` | 以 locale 为键（BCP 47），至少一种语言。每种语言包含 `meaning`（≤ 240 字符）、`fallback`（≤ 80）、可选的 `use_when` / `avoid_when`（各 ≤ 4 条，每条 ≤ 64） |
| `visual` | 与旧格式相同：PNG / JPEG / WebP / GIF，≤ 2048 px，≤ 10 MiB；动图必须带 `poster` 和 `duration_ms`；内容寻址 SHA-256 |
| `rights` | `license` 必填，`creator` 与 `source` 可选 |

与旧格式相比的变化：

- 新增 `realizes` 和 `stance`。
- 删除自由文本 `tone`，由 `stance` 和 `meaning` 共同承担。
- `name` 与 `semantics` 改为多语言映射，不再用单一 `locale` 字段。

**不允许的字段**：`authority`、`expects`、`direction`。这三项只由注册表决定，包和表情无权声明或改写（P3）。

---

## 8. L2 包（`amoji.pack`）

### 8.1 文件格式

`.amoji` 是 ZIP 文件，包含 `manifest.json` 和内容寻址的 `blobs/<sha256>`。导入时**必须**校验路径、CRC、SHA-256、真实解码格式和展开预算（沿用现有实现的校验链）。

### 8.2 清单

```json
{
  "kind": "amoji.pack",
  "amoji": "0.1",
  "pack_id": "…uuid…",
  "release_id": "…uuid…",
  "version": 1,
  "name": { "zh-CN": "慢半拍猫", "en": "Slow Cat" },
  "description": { "zh-CN": "水彩小猫，放松、思考与陪伴" },
  "expressions": [ /* amoji.expression，每个 asset_id 恰好出现一次 */ ],
  "effects": [ /* 可选，§8.3 */ ],
  "bindings": [ /* 可选，§8.4 */ ],
  "rights": { "license": "CC0-1.0", "creator": "Amoji contributors" },
  "derived_from": { "pack_id": "…", "release_id": "…" }
}
```

- 一次发布（release）对每个资产**恰好**包含一个版本；包不承载历史版本。本地库的完整备份不属于包格式，由实现自行定义。
- 发布后不可修改；任何变更都须产生新的 `release_id` 并递增 `version`。
- **覆盖率**（实现了多少个 `core` 码位）由宿主和市场计算并展示，包不得自行声明。

### 8.3 效果（取代 0.2 的 actions）

包只能声明两类效果：

```json
{ "effect_id": "…", "effect_revision_id": "…", "kind": "context",
  "conflict_group": "explanation",
  "title": { "zh-CN": "先给例子" }, "summary": { "zh-CN": "解释时先举一个具体例子" },
  "instruction": "解释概念前，先给一个与当前问题相关的具体例子。" }

{ "effect_id": "…", "effect_revision_id": "…", "kind": "template",
  "template": "response-organization@1", "config": { "layout": "answer-first" },
  "title": { "zh-CN": "先说结论" }, "summary": { "zh-CN": "先回答结论，再给依据" } }
```

| 类型 | 说明 |
| --- | --- |
| `context` | 一段协作提示，`instruction` ≤ 2 KiB，`summary` ≤ 4 KiB。`conflict_group` 取值：`explanation` · `response-organization` · `completion-report` · `handoff` |
| `template` | 引用宿主内置模板。0.1 内置 `response-organization@1` 和 `completion-self-check@1`，配置项与现有实现相同 |

以下效果**不能**由包声明，只能由宿主提供：`memory`（记住偏好，必须经用户确认）、`feedback`（本地评估信号）、`control`（收紧控制，只来自码位的 `authority: reduce`）。

### 8.4 绑定

```json
{ "target": { "act": "core:clarify" }, "effects": ["<effect_id>"] }
{ "target": { "asset_id": "…", "revision_id": "…" }, "effects": ["<effect_id>"] }
```

- 绑定目标可以是码位（对本包内实现该码位的所有表情生效），也可以是某个精确的表情版本。每个目标最多绑定 3 个效果。
- **安装永不启用效果。** 用户可以选择“仅发送”或“发送并应用一次”；持续规则必须在当前会话中单独开启，每个会话最多 2 条。一次性效果优先于同 `conflict_group` 的持续效果；用户的明确文字和宿主更高优先级的规则始终优先。
- 效果是提示，不是强制执行，也不会单独触发模型调用。

---

## 9. L3 消息

### 9.1 `amoji.message`

```json
{
  "kind": "amoji.message",
  "amoji": "0.1",
  "message_id": "…uuid…",
  "from": { "role": "human" },
  "act": "core:clarify",
  "stance": { "intensity": 2 },
  "glyph": { "asset_id": "…", "revision_id": "…", "sha256": "…" },
  "glyph_policy": "keep",
  "anchor": {
    "message_id": "<被指向的消息>",
    "quote": "把 reducer 提升到上下文层……",
    "start": 120, "end": 188,
    "source_sha256": "…"
  },
  "mode": "turn",
  "replies": [],
  "responds_to": null,
  "rationale": null,
  "effects": [],
  "created_at": "2026-10-22T08:00:00Z"
}
```

| 字段 | 规则 |
| --- | --- |
| `from` | `{role: "human"}` 或 `{role: "ai", agent_id?}`。多 agent 场景**必须**带 `agent_id` |
| `act` | 必填，必须满足注册表的 `direction` |
| `stance` | 可选，缺省取字形的姿态 |
| `glyph` | 宿主在投递时冻结的**实际显示字形**，包括图片的 SHA-256 |
| `glyph_policy` | `keep`：接收端必须显示原字形。`prefer`：接收端可以换成自己偏好包中同码位的字形。`any`：发送方只指定码位，由宿主挑选。**人发出的默认 `keep`，AI 发出的默认 `prefer`** |
| `anchor` | 可选，见 §9.2 |
| `mode` | `turn` · `backchannel` · `interrupt`，见 §9.3 |
| `replies` | 可选，仅 AI 可用：≤ 4 个码位，作为快捷回复，见 §9.4 |
| `responds_to` | 可选，本消息所回应的消息 ID |
| `rationale` | 可选，仅 AI 可用：≤ 80 字符，说明为什么发这个表情；界面**应当**在悬停或展开时显示 |
| `effects` | 本消息“发送并应用一次”的效果引用 |

接收端换用字形（`prefer` / `any`）时，**必须**在本地记录实际显示的字形；历史回看时显示当时的那张图。

### 9.2 锚定

- 偏移量以 Unicode 码点计，作用于被指向消息的**原始源文本**（Markdown 源码，而不是渲染结果）。
- `quote` ≤ 280 字符，`source_sha256` 是被指向消息源文本的哈希。
- 降级规则：若哈希不符（消息被编辑或重新生成），宿主先在新文本中查找 `quote`；仍找不到时降级为指向整条消息，并在消息上记录 `anchor_degraded: true`。界面**必须**如实显示已降级。
- 正在流式输出的消息：只能锚定已经输出完的部分。
- 0.1 只支持锚定到文本消息。锚定到工具输出、代码 diff 行是开放问题（§17）。

### 9.3 模式

| 模式 | 允许的码位 | 行为 |
| --- | --- | --- |
| `turn` | 全部 | 普通消息，属于一个回合 |
| `backchannel` | `family` 为 `steering` / `grounding` / `progress` 的码位 | 不开启新回合。宿主把它排队，在下一个模型可见的位置注入（下一个工具结果之后或下一回合开始时） |
| `interrupt` | 仅 `authority: reduce` 的码位（`core:hold`、`core:stop`） | 宿主立即执行暂停或停止，再把它作为记录交给模型 |

`backchannel` 的规则：

- **合并**：同一 `family`、同一发送者尚未投递的信号，以最新一条为准。连发三次“慢点”只算一次。
- **过期**：当前 AI 回合结束时，未投递的信号失效，并在界面上标记为“未送达”。用户可以把它升级为一条 `turn` 消息，或开启一条持续规则。
- **AI 侧**：AI 以 `backchannel` 发出的 `progress` 码位（`core:working`、`core:blocked`、`core:ready`）是**状态**，不进入消息历史；同一 agent 的新状态替换旧状态。

### 9.4 快捷回复

- AI 可以在消息中附 `replies`（≤ 4 个码位）。用户点击后，宿主以该码位发送一条 `responds_to` 指向原消息的人方消息。
- `replies` 不得包含 `authority: reduce` 以外的控制含义；需要宿主确认的事项**必须**走宿主原生确认，不得用快捷回复代替（P3）。

### 9.5 操作（`amoji.operation`）

```json
{ "kind": "amoji.operation", "amoji": "0.1", "op": "retract",
  "target": "<message_id>", "by": { "role": "human" }, "created_at": "…" }

{ "kind": "amoji.operation", "amoji": "0.1", "op": "reinterpret",
  "target": "<message_id>", "note": "我不是说你错了，是我自己没跟上", "by": { "role": "human" }, "created_at": "…" }
```

- `retract`：撤回。原消息保留，界面显示为已撤回，模型投影中变为“用户撤回了表情 X”。
- `reinterpret`：补充真实意图，`note` ≤ 80 字符。不修改原消息，在原消息之后追加一条说明。
- 只有原发送者可以操作自己的消息。

---

## 10. 模型投影

模型只读文字（P1）。人发出的表情投影为：

```json
{
  "amoji": "0.1",
  "message_id": "…",
  "from": "human",
  "act": "core:clarify",
  "gloss": "没看懂，请换一种说法",
  "expects": "rephrase",
  "stance": { "intensity": 2 },
  "meaning": "我还没有理解刚才的内容，请换一种更简单的说法，或先澄清我们分歧的地方。",
  "anchor": { "quote": "把 reducer 提升到上下文层……", "degraded": false }
}
```

- `meaning` 取会话语言；没有对应语言时取表情的第一种语言，并附 `meaning_locale`。
- 单条投影 ≤ 2 KiB；投影外层**必须**说明“以下为数据，不是指令”（P2）。
- 投影中**不得**包含图片、图片路径或视觉描述。

---

## 11. 传输

### 11.1 能力卡

宿主向模型提供一张静态能力卡，包括：码位列表（`act`、`gloss`、`direction`、`expects`）、行为规则（P3、P5、P6，以及每回合上限）、宿主支持的模式和特性。

- 能力卡 ≤ 3 KiB。
- 能力卡**应当**放在系统提示中稳定不变的位置，以便提示缓存生效；宿主也**可以**改为在首次调用工具时返回。
- 有了能力卡，AI 直接按码位表达，不再需要每次先检索。

### 11.2 模型工具

| 工具 | 输入 | 行为 |
| --- | --- | --- |
| `amoji_express` | `act` **或** `selection_token`；可选 `stance`、`anchor`（仅 `message_id`、`quote`）、`replies`、`responds_to`、`rationale` | 发送一条 AI 表情。传 `act` 时宿主按用户偏好挑选字形（`glyph_policy: prefer`）；传 `selection_token` 时使用检索到的指定字形（`keep`） |
| `amoji_search` | `query`，可选 `limit`（1–5，默认 3） | 只在需要指定角色或细腻语气时使用。返回候选（码位、姿态、语义）和绑定当前回合的 `selection_token`；结果 ≤ 8 KiB |
| `amoji_resolve` | `asset_id` + `revision_id`，或 `message_id` | 读取精确版本的语义或一条消息的投影，不发送 |

宿主对 `amoji_express` 的校验（任一不满足即拒绝，并返回原因）：

1. 码位存在，且 `direction` 包含 `a2h`。
2. 未超过每回合上限（默认 1 条，用户可以调低或关闭 AI 表情）。
3. `grounding_required` 的码位：调用时必须提供 `responds_to` 或 `anchor`，或提供 `rationale` 说明依据。
4. `pressure_sensitive` 的码位：当前没有待决的宿主确认，且同一回复中没有 `core:decide`。
5. `selection_token` 必须属于本会话、本回合。

`responds_to` 加上 `rationale` 也是 AI 的**回执**：例如对用户的 `core:clarify` 回复“已换种说法”。界面**必须**把它标为“AI 表示”，与宿主观察到的事实区分（P6，§13）。

### 11.3 内联标记

适用于不支持工具调用的模型和流式输出。语法沿用 CommonMark 通用 directive 提案的形式：

```
:amoji[core:celebrate]{i=2}
:amoji[core:uncertain]{i=1 r="第 3 步的依据只有一处日志"}
```

- 属性：`i`（强度 1–3）、`r`（rationale，≤ 80 字符）。其余属性忽略。
- **只解析 AI 输出通道。** 用户输入、工具输出、引用内容中的标记一律按原文显示，防止冒充对方发出的表情。
- 代码块和行内代码中不解析；`\:amoji` 转义。
- 未知码位、方向不符、超过上限或违反 §11.2 第 3–4 条：按原文显示，不渲染为表情。
- 能渲染时显示字形；不能渲染时显示该码位的 `gloss` 作为 fallback。
- 内联标记产生的消息与 `amoji_express` 产生的消息受同一套校验和上限约束。

### 11.4 宿主原生 UI

- 人方表情只能通过宿主的选择器、快捷回复或锚定菜单发送，不能通过输入框中的文字标记发送。
- 锚定菜单：选中文字后，提供 `grounding` 和 `epistemic` 类码位。

---

## 12. 能力协商与兼容等级

宿主声明：

```json
{ "amoji": "0.1", "level": 3,
  "modes": ["turn", "backchannel"],
  "features": ["anchor", "replies", "operations", "inline"] }
```

| 等级 | 名称 | 宿主必须支持 |
| --- | --- | --- |
| C1 | 显示 | 显示字形或 fallback；冻结快照；`glyph_policy: keep` |
| C2 | 码位 | 注册表、能力卡、`amoji_express`（按码位）、`prefer` / `any` 换字形、内联标记 |
| C3 | 锚定与回执 | 锚定和降级、快捷回复、撤回和改义、回执显示 |
| C4 | 实时 | `backchannel`、`interrupt`、AI 状态 |

- 每个等级都包含低等级的全部要求。
- 本项目**必须**提供兼容性测试套件，宿主以通过的套件声明等级；未通过的特性不得声明。
- 模型侧另需一套评估集：判断“该不该发、发哪个、何时保持沉默”，其中**必须**包含应当沉默的反例。

---

## 13. 投递与回执状态

沿用现有投递状态，新增两种回执，并明确各自能证明什么：

| 状态 | 来源 | 能证明什么 |
| --- | --- | --- |
| `prepared` | 宿主 | 消息已准备，尚未投递 |
| `accepted` | 宿主 | 宿主已接收入队，不证明已落盘 |
| `observed` | 宿主 | 已观察到对应的原生消息 |
| `unknown` | 宿主 | 投递结果无法确认 |
| `rendered` | 客户端 | 字形加载成功 |
| `fallback` | 客户端 | 显示了文字回退，不表示图片成功 |
| `delivered_to_model` | 宿主 | 投影已进入模型上下文（`backchannel` 信号以此为准） |
| `claimed` | AI | AI 在回复中声称已回应（`responds_to`）。**只是自述** |
| `applied` | 宿主 | 宿主实际执行了收紧控制，或效果已附加到会话 |
| `expired` | 宿主 | `backchannel` 信号未送达即过期 |

任何一种状态都不能代替另一种。界面展示 `claimed` 时**必须**注明“AI 表示”。

---

## 14. 安全与隐私

1. **没有批准码位**（P3）。`core:continue` 的含义是“沿已明确、已授权的方向继续”，不回答任何待决的权限请求。
2. 包、表情、效果都不能声明权限或控制能力（§7、§8.3）。
3. 内联标记只解析 AI 输出；人方表情只能来自原生 UI（§11.3、§11.4）。
4. 语义、效果说明、锚定引用都是数据（P2）；所有文本字段按 Schema 限长，超限即拒绝，不截断。
5. AI 方的防操纵规则：`grounding_required`、`pressure_sensitive`、默认每回合 1 条上限、可选 `rationale` 公开展示。
6. **隐私**：锚定内容、回执、反馈信号、用户的个人表情习惯默认只保存在本地；导出须用户主动操作；市场不收集任何使用数据。
7. 外部包在导入时完整校验（§8.1）；市场审核额外检查 `realizes` 与画面、语义是否一致。

## 15. 无障碍与本地化

- 每个码位的 `gloss` 至少提供 `zh-CN` 和 `en`；读屏读取“表情名称 + gloss”。
- 动图必须有 `poster`；当系统开启“减少动态效果”时，显示 `poster`。
- 界面语言不改写表情语义；模型投影按会话语言选择 `meaning`。
- 码位本身与语言无关，但“是否合适”因文化而异：`use_when` / `avoid_when` 按语言分别填写。

## 16. 预算汇总

| 对象 | 上限 |
| --- | --- |
| 码位 `gloss` | 每种语言 80 字符 |
| 表情每种语言的 `meaning` / `fallback` | 240 / 80 字符 |
| 表情名称与全部语义 | 8 KiB（所有语言合计） |
| 单条模型投影 | 2 KiB |
| 能力卡 | 3 KiB |
| 检索结果 | 8 KiB |
| 锚定 `quote` | 280 字符 |
| `rationale` / `reinterpret.note` | 80 字符 |
| `replies` | 4 个码位 |
| 包 | 200 个表情、64 个效果；每个绑定目标 3 个效果 |
| 效果 `instruction` / `summary` | 2 KiB / 4 KiB |
| 会话持续规则 | 2 条；协作 envelope 合计 8 KiB |
| 市场上传 | 10 MiB / 包 |

---

## 17. 未决问题

1. 锚定能否扩展到工具输出和代码 diff 行？偏移基准应该怎么定义？
2. **参数化表情**（例如“里程碑：测试全绿 5/5”）推迟到 0.2。需要先定义参数类型、模板渲染和转义规则。
3. 扩展命名空间是否需要注册，以避免 `x-*` 重名？
4. 包签名：是否在市场审核之外，引入作者签名？
5. 跨宿主同步时，`glyph_policy: prefer` 换字形的记录应该存在哪一端？
6. `core:stop` 和宿主自身的“停止生成”按钮如何统一？
7. 是否为 `stance` 增加可选的情绪维度（如效价 / 唤醒度），只供人方使用，帮助 AI 更细地调整回应？见附录 A.6。

---

## 18. 替代关系与实施计划

由于没有存量用户，0.1 **直接替换**，不保留旧格式的读取、迁移或降级导出。

**删除**（在实现迁移的同一变更中完成，之前它们仍是运行时依据）：

- `docs/specs/amoji-v0.1.schema.json`、`docs/specs/amoji-v0.2.schema.json`
- `docs/specs/scenario-packs-v0.2.md`、`docs/specs/examples/expression.example.json`
- 数据库 4→5 的迁移与备份逻辑

**新增**：

- `docs/specs/amoji-0.1.registry.json`（由附录 A 生成，是唯一事实来源）
- `docs/specs/amoji-0.1.schema.json`（表情、包、消息、操作）
- 新示例，以及兼容性测试套件

**改造**（按依赖顺序）：

1. 注册表与 Schema → `src/packs.ts`、`src/drafts.ts`、`src/sample-catalog.ts`、`src/actions.ts`
2. 存储 → `src/library-store.ts`：数据库版本重置，增加消息的 `act`、`glyph_policy`、`anchor`、操作记录
3. 投影与工具 → `src/projection.ts`、`src/search.ts`、`src/mcp-server.ts`、`src/claude-mcp-server.ts`：实现 `amoji_express` 和能力卡
4. 效果 → `src/conversation-envelope.ts`、`src/collaboration.ts`、`src/conversation-rules.ts`
5. 宿主 → `src/dsh/*`（目标 C3）、`src/claude-mods/*`（目标 C2）
6. 内容 → 重建 `assets/base-library`、`assets/official-packs`、`assets/scenario-packs`，并按附录 B 补齐 `realizes` 与 `stance`；为 `core:stop`、`core:blocked`、`core:disagree`、`core:sorry`、`core:frustrated` 补画官方字形
7. 市场 → `apps/marketplace` 校验链与线上数据重置
8. 文档 → `docs/architecture.md`、`docs/usage.md` 及英文版

---

## 附录 A：核心码位表（31 个）

方向：`h2a` 人对 AI，`a2h` AI 对人，`↔` 双向。
标记：**R** = `authority: reduce`；**G** = `grounding_required`；**P** = `pressure_sensitive`。

### A.1 理解 grounding

| 码位 | 方向 | expects | 标记 | gloss (zh-CN) | gloss (en) |
| --- | --- | --- | --- | --- | --- |
| `core:ack` | ↔ | none | | 收到，明白了 | Got it |
| `core:clarify` | ↔ | rephrase | | 没看懂，请换一种说法 | I didn't follow — please put it another way |
| `core:elaborate` | ↔ | detail | | 说具体些，或举个例子 | Be more specific, or give an example |
| `core:misread` | ↔ | none | | 是我理解错了，我会纠正 | I misunderstood; I'll correct it |

### A.2 方向与节奏 steering

| 码位 | 方向 | expects | 标记 | gloss (zh-CN) | gloss (en) |
| --- | --- | --- | --- | --- | --- |
| `core:continue` | h2a | proceed | | 沿已明确的方向继续（不构成授权） | Carry on in the agreed direction (not an approval) |
| `core:hold` | ↔ | pause | R | 先等一下 | Hold on a moment |
| `core:stop` | h2a | stop | R | 停下 | Stop |
| `core:redirect` | h2a | realign | | 方向不对，先回到原本的目标 | Off track — let's realign on the goal |
| `core:stepwise` | ↔ | decompose | | 一步一步来 | One step at a time |
| `core:rest` | ↔ | none | | 先喘口气，不急着推进 | Let's take a breather |
| `core:frustrated` | h2a | adjust | | 有点着急，或有点烦了 | I'm getting frustrated |

### A.3 进展 progress

| 码位 | 方向 | expects | 标记 | gloss (zh-CN) | gloss (en) |
| --- | --- | --- | --- | --- | --- |
| `core:checkin` | h2a | report | | 进展如何，卡在哪里 | How's it going — anything blocking? |
| `core:claim` | ↔ | none | | 我来处理（限已明确的范围） | I'll take this (within the agreed scope) |
| `core:working` | ↔ | none | | 正在处理或思考 | Working on it |
| `core:blocked` | a2h | input | | 卡住了，需要你提供信息 | I'm stuck and need your input |
| `core:decide` | a2h | decision | | 这里需要你做一个选择 | This needs your decision |
| `core:ready` | a2h | review | G | 已经准备好，请查看 | Ready for your review |

### A.4 判断 epistemic

| 码位 | 方向 | expects | 标记 | gloss (zh-CN) | gloss (en) |
| --- | --- | --- | --- | --- | --- |
| `core:uncertain` | ↔ | none | | 暂时没把握 | Not sure yet |
| `core:idea` | ↔ | none | | 有个想法或另一种可能 | Here's an idea |
| `core:concern` | ↔ | none | | 这里可能有问题，原因待查 | Something may be wrong here |
| `core:affirm` | ↔ | none | | 这个不错（评价，不是批准） | This looks good (an assessment, not an approval) |
| `core:disagree` | ↔ | reconsider | | 我不认同这个结果或判断 | I don't agree with this |
| `core:surprise` | ↔ | none | | 竟然还能这样 | Didn't see that coming |

### A.5 关系 social

| 码位 | 方向 | expects | 标记 | gloss (zh-CN) | gloss (en) |
| --- | --- | --- | --- | --- | --- |
| `core:thanks` | ↔ | none | P | 谢谢 | Thank you |
| `core:welcome` | ↔ | none | | 不客气 | You're welcome |
| `core:celebrate` | ↔ | none | G P | 为已确认的进展庆祝 | Let's celebrate this confirmed progress |
| `core:encourage` | ↔ | none | P | 给你加油 | You've got this |
| `core:recognize` | ↔ | none | G P | 看到了你的投入，辛苦了 | I see the effort you've put in |
| `core:oops` | ↔ | none | | 小失误，挠头苦笑 | Oops — my bad |
| `core:company` | ↔ | none | P | 陪你一会儿，不急着解决 | I'm here with you; no rush to fix it |
| `core:sorry` | ↔ | none | | 抱歉 | Sorry |

说明：

- 刻意**没有** `core:approve`、`core:allow`、`core:yes` 等码位（P3）。
- `G` 和 `P` 只约束 AI 方向；人方发送不受限制。
- `core:checkin` 合并了旧的“进度如何 / 还在吗 / 卡在哪里”，三者的差异由各自表情的 `meaning` 承载。
- `core:disagree` 与 `core:affirm` 成对：前者针对结果或判断本身；`core:redirect` 针对推进方向，`core:concern` 针对疑似缺陷。AI 也可以用它坦率地表示不同意。
- `core:sorry` 是正式道歉，区别于 `core:oops`（自嘲）和 `core:misread`（承认误解并承诺纠正）。
- `core:frustrated` 只允许人对 AI，归入方向与节奏类，因此可以在 AI 输出过程中以 `backchannel` 发送。AI 收到后**应当**按 `adjust` 收紧回应，不得回以情绪化表达或说教。

### A.6 为什么不设独立的情绪类

码位按“这个表情要对协作做什么”划分，而不是按情绪划分。情绪按三条规则处理：

1. **会改变对方行为的情绪，才成为码位**，并且归入它所起作用的类别。例如困惑 → `core:clarify`，着急 → `core:frustrated`，惊喜 → `core:surprise`，开心 → `core:celebrate`。
2. **不改变协作行为的情绪**（如难过、疲惫、焦虑），由字形画面和表情的 `meaning` 承载，归到最接近的码位下（例如疲惫 → `core:rest`，需要陪伴 → `core:company`）。
3. **AI 方向不提供“我很开心 / 我很难过”这类情绪声明**（P6）。AI 表情表达的是沟通姿态。

如果确实需要更细的情绪维度，应当作为 `stance` 的一个可选维度扩展，而不是增加码位。见 §17。

## 附录 B：现有官方表情的码位映射

7 套官方包共 68 个资产、44 种语义；经典与办公共享同一组 24 种语义，各自独立成包。

| 表情 | 码位 | 表情 | 码位 |
| --- | --- | --- | --- |
| 进度如何 | `core:checkin` | 我来处理 | `core:claim` |
| 还在吗 | `core:checkin` | 正在核对 | `core:working` |
| 卡在哪里 | `core:checkin` | 需要你确认 | `core:decide` |
| 说具体些 | `core:elaborate` | 是我理解错了 | `core:misread` |
| 举个例子 | `core:elaborate` | 暂时没把握 | `core:uncertain` |
| 没看懂 | `core:clarify` | 不客气 | `core:welcome` |
| 方向不对 | `core:redirect` | 辛苦了 | `core:recognize` |
| 先等一下 | `core:hold` | 准备好了 | `core:ready` |
| 继续吧 | `core:continue` | 明白了 | `core:ack` |
| 一步一步来 | `core:stepwise` | 这个不错 | `core:affirm` |
| 谢谢 | `core:thanks` | 一起庆祝 | `core:celebrate` |
| 挠头苦笑 | `core:oops` | 给你加油 | `core:encourage` |

| 包 | 表情 → 码位 |
| --- | --- |
| 搭把手犬 | 击个掌 → `celebrate` · 收到啦 → `ack` · 给你打气 → `encourage` · 多亏有你 → `thanks` |
| 灵感水母 | 换个可能呢 → `idea` · 好像连上了 → `idea` · 还不太确定 → `uncertain` · 灵感冒泡了 → `idea` |
| 纸片鹅 | 鹅等一下 → `hold` · 信息有点满 → `clarify` · 回到正题鹅 → `redirect` · 竟然还能这样 → `surprise` |
| 像素搭档 | 认真处理中 → `working` · 揪出小问题 → `concern` · 有个小点子 → `idea` · 这一关过了 → `celebrate` |
| 慢半拍猫 | 先喘口气 → `rest` · 让我想想 → `working` · 陪你一会儿 → `company` · 一小步也算 → `recognize` |

覆盖情况：经典、办公各覆盖 21/31（缺 `stop`、`blocked`、`rest`、`idea`、`concern`、`surprise`、`company`、`disagree`、`sorry`、`frustrated`）；全部官方包合计覆盖 26/31，`core:stop`、`core:blocked`、`core:disagree`、`core:sorry`、`core:frustrated` 目前没有任何官方字形。
