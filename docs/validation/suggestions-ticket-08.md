# 票据 08：文字语义建议验证

日期：2026-09-16。基线：`f2653d0dcb3a221d1f194fc7881f86b5059f9ba4`。本文记录共享服务、共用面板 DOM 和三端构建合同证据；不代表系统浏览器像素显示或真实 Codex / Claude Code / dsh 宿主模型已经验收。真实 Codex 产品旅程统一保留给票据 19。

## 实现结果

- 共享服务新增 `text-suggestions-v1` 管理能力和 `suggestText(intent, notes?)`。输入只有文字意图与可选逐行说明，未知字段、非文字、空白和越界输入明确拒绝；不接受图像、blob、文件路径、草稿身份、宿主目标或 revision。
- 实际建议器为 `local-deterministic-v1`：在本机按感谢、鼓励、庆祝、道歉、陪伴、无奈等有限文字模式整理名称、含义、替代文本、语气、语境和标签。返回值明确说明未调用模型且不读取图像，不要求供应商密钥，不宣传为模型结果。
- 建议调用无数据库写入。建议先显示在独立可编辑待选区；用户修改后点击“采用到草稿”才复制到表单，仍需另行保存、预览、图像加载成功和确认。拒绝或放弃不撤销手工内容。
- 当前草稿、版本、手工表单、意图或说明变化，切换/新建草稿、取消、页面关闭和后发请求都会取消旧请求资格。迟到结果不能显示或覆盖；不可用时保留全部输入并继续原手工流程。
- 最终字段仍经过票据 07 的 Schema、Unicode code point、4 KiB、完整媒体及真实图片 `load` 门禁。建议器不自动保存、不自动确认、不修改已确认 revision，也没有新增模型工具。
- API 2、数据库 2、资产协议 0.1 保持不变；Codex、Claude Code、dsh 的 BUILD 管理能力同步包含 `create-drafts-v1` 和 `text-suggestions-v1`，dsh 运行时清单纳入 `suggestions.js`。

## 测试先行与合同证据

首次运行 `npm run test:file -- tests/suggestions.test.ts tests/suggestions-panel.test.ts` 为 0/3，通过前分别失败于缺少共享能力、`SharedClient.suggestText` 和 DOM 建议工作台。实现后 3/3 通过。

共享服务测试连接实际隔离服务，验证候选不改变草稿和资产列表，精确保留 240 个 Unicode 字符并拒绝空白、非文字及越界输入。DOM 测试挂载实际 `index.html` / `panel.js` 并连接真实面板 HTTP：覆盖迟到结果、编辑失效、可编辑候选采用、拒绝、取消、传输故障和故障后上传素材、预览、图片 `load`、确认生成固定版本。JSDOM 只证明真实组件和 DOM 行为，不冒充系统浏览器画面。

票据 07 受影响回归命令覆盖持久草稿、保存未知结果恢复、预览/确认图片门禁、面板检索及共享服务生命周期，共 22/22 通过；建议功能没有削弱媒体或图文确认门禁。

## 实际执行命令

```sh
npm run typecheck
npm run build
node scripts/build-plugin.mjs
node scripts/build-claude-plugin.mjs
npm run build:dsh
npm run test:file -- tests/suggestions.test.ts tests/suggestions-panel.test.ts
npm run test:file -- tests/create.test.ts tests/create-panel.test.ts tests/create-recovery.test.ts tests/panel-ui.test.ts tests/shared-service.test.ts
npm run test:file -- tests/plugin-artifact.test.ts
npm run test:file -- --test-name-pattern='打包dsh Host提供会话校验' tests/dsh-host.test.ts
```

类型检查、核心构建及三端构建均退出 0；票据 08 测试 3/3、07 受影响回归 22/22、Codex/Claude 独立产物 3/3、dsh 打包 Host 限定检查 1/1 通过。构建产物确认 API 2、DB 2 和两项管理能力；没有运行旧模型探针或整套产物矩阵。

## 能力限制与待验

- 本地规则只能按有限关键词和用户逐行说明整理结构，不能推断图片内容，也不声称理解复杂语用。用户必须检查并可完全修改候选；复杂或越界输入应继续手工填写。
- 未调用真实模型、未更改用户安装或配置、未推送或发布。系统浏览器目前因 Mac 锁屏未做画面检查。
- 真实 Codex 中“文字建议 → 修改采用 → 图文预览 → 确认 → 发送”的用户旅程与可见画面证据仍归票据 19；Claude Code / dsh 真宿主验收继续保持待验。
