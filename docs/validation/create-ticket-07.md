# 票据 07：手工创建验证

日期：2026-09-16。基线：`c50ea55b284e08d4468f7d537ae42176603269cb`。本文记录源码、真实本地服务、实际产物和 DOM 合同证据；**不代表真实 Codex / Claude Code / dsh 宿主模型已经验收**。创建后在真实 Codex 会话发送的完整旅程保留给票据 19。

## 结果

- 无模型配置即可创建。独立持久草稿没有资产/版本身份；原图和表单可保存、恢复，并跨共享服务重启保留。
- 保存中的语义错误不成为可发送定义。确认前公共 `search` 无候选，`receive` 拒绝草稿身份，正常模型工具没有上传或改义参数。
- 预览/确认验证完整 Schema、未知字段、空白、Unicode code point、列表边界、4 KiB UTF-8 预算与真实日历日期。48 个补充平面字符合法、49 个拒绝，HTML 没有以 UTF-16 计数的 `maxlength`。
- PNG/JPEG/WebP 与 GIF/animated WebP 复用票据 06 媒体验证器；上传动图自动生成独立静态 PNG 封面，确认主图、封面和语义保持同一 revision。非法素材不覆盖原草稿。
- 确认在同一事务生成 UUID v4 小写资产和 revision、库条目、本机来源及幂等记录。并发确认、服务重启后的重试返回同一版本；已确认草稿不可改写，旧预览版本不能确认新内容。
- SQLite 1→2 升级保留旧用户库、素材、消息和去重记录；API 2 保持兼容，新增创建能力明确握手。来源归属由服务写入，输入不能冒充作者类别。
- 实际挂载面板 DOM，经真实 HTTP 上传动图、保存、恢复、触发字段/媒体错误、预览播放/暂停、返回修改、明确确认、选中并发送；最后断言消息等于确认版本及固定文字语义。JSDOM 不证明浏览器真实像素绘制；媒体完整像素解码由 sharp 实际执行。
- Codex / Claude 独立构建产物从临时目录启动真实 MCP 与共享服务；Claude 使用真实 Hook 脚本。通过面板管理 HTTP 确认新资产后，真实适配器工具检索并 emit 同一新 revision，模型 content 始终只有 text，Codex `display_markdown` 保留。
- dsh 真实源码 `defineTool`、`SlotCore`、loader 产物和打包 Host 加载通过；Picker 管理按钮经可信会话 RPC 生成共用面板链接，面板写入的资产由实际 dsh 工具检索并 emit。会话切换不保留旧管理链接；卸载关闭面板。没有新增 AI 管理工具。

## 执行命令

```sh
npm run typecheck
npm run build:dsh
npm run prepare:dsh
npm run test:file -- tests/create.test.ts tests/create-panel.test.ts tests/shared-migration.test.ts tests/shared-claude-ticket.test.ts tests/panel-ui.test.ts tests/panel.test.ts tests/shared-panel.test.ts tests/shared-mcp.test.ts tests/media.test.ts
npm run test:file -- tests/plugin-artifact.test.ts
npm run test:file -- tests/dsh-host.test.ts tests/dsh-client.test.ts
```

首轮创建合同 3 项在缺少 `createDraft` 时失败；面板 DOM 在缺少创建入口时失败；dsh Host/loader 在缺少 manage 入口时失败；确认前动画预览检查在缺少播放按钮时失败。实现后通过：公共服务/迁移/媒体/共用面板组 27 项，独立产物 3 项，dsh 组 16 项。新增动图预览后单独复验创建及面板 DOM 8 项通过。最终重新类型检查和构建，并执行创建、面板、共享服务及 dsh 相关组合 36 项，全部通过。

## 公开接口与边界

公共管理合同为 `SharedClient.createDraft/listDrafts/getDraft/saveDraft/previewDraft/confirmDraft`，细节见 [共享服务合同](../specs/shared-service-v0.1.md)。人类面板代理相同接口；dsh 仅增加人类 RPC `amoji/manage`。正常 `search/resolve/emit` 仍只读取已确认库与固定版本，图片字节不进入模型投影。

未实现票据 08 建议器、09 编辑、10 导入、删除或安装升级。草稿显式点击保存或预览时持久化；尚未保存的浏览器输入不会声称已落库。失败后保留用户界面输入及上次成功保存的草稿。素材先落盘、事务后失败所留下的孤立字节暂不清理。

BUILD 元数据统一从核心真实常量读取 API、DB、创建能力，修复票据 04 留存的 dsh BUILD 数据库/API 硬编码漂移。此处的实际 Host、MCP 与 DOM 检查不提升三宿主真实模型/画面门槛；票据 19 仍需实际用户创建并发送的集中证据。

## 第一轮审查修补：慢请求与真实预览就绪

媒体管理 `saveDraft/previewDraft/confirmDraft` 使用独立的 60 秒有界预算，普通 RPC 保持 5 秒。超时或连接丢失不会被当作确定写入失败：保存/确认返回 `DRAFT_OUTCOME_UNKNOWN`，只读预览返回 `DRAFT_PREVIEW_UNAVAILABLE`。没有自动循环重试。

每次保存以原草稿版本、完整字段和上传内容的规范化 JSON 计算 SHA-256 请求指纹，与保存结果一同持久化到草稿 `last_save`。原样重试在 CAS 之前核对该指纹，返回已经保存的同一版本；若其他窗口随后保存了不同内容，则返回 `DRAFT_CONFLICT`，不得返回过时成功或覆盖他端。这个本地状态字段不进入资产或模型投影，也不增加 DB/API 版本。面板遇到未知保存结果保留原请求载荷、锁定编辑并显示“核对保存结果”；用户点击后重试相同请求，而非重新从旧版本拼装保存。确认响应丢失仍复用原草稿/版本的确认幂等合同。

确认按钮及其处理器都检查当前草稿、版本、输入快照、预览 generation 和图片加载状态。只有当前图片 `load` 成功（或已完成且具有有效解码宽度）才获得资格。未加载、`error`、播放/暂停换图、新预览、换草稿、输入变化和返回修改均取消资格；旧图片的迟到 `load` 不会启用新预览。

新增 `tests/create-recovery.test.ts` 在真实共享 HTTP 和真实 writer/decoder 后受控延迟 save、preview、confirm 各 5.2 秒，覆盖超过旧 5 秒上限后结果与持久状态一致；另对已提交的响应实施一次传输丢失，验证显式未知状态、原样重试、服务重启、其他窗口 CAS 和确认去重。DOM 检查派发受控 `load/error` 及旧图片迟到事件，并直接调用确认处理器验证慢加载期间没有确认请求；另验证浏览器保存/确认响应丢失时保留载荷和显式核对，不自动重试。受控事件证明就绪门禁，仍不代替票据 19 的真实浏览器显示验收。

本轮限定执行 `npm run typecheck`、`npm run build:dsh`；创建、慢恢复及共用面板相关 15 项通过；单独打包 dsh 管理入口 1 项通过。没有重跑旧三端模型或全部适配矩阵。
