# dsh 产品体验重构 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans，主代理持续实现，最终一次独立审查。

**Goal:** 完整重做dsh的表情交互、管理和协作内容，达到真实可验的产品化体验。
**Architecture:** 复用不可变共享库与可靠投递，仅拆分UI组件；UI选择器/管理共用单元与主题样式；对话展示只替换可信插件语义。基础库作为有版本的内容发布与迁移。
**Tech Stack:** React19 / TypeScript / dsh0.1.5-rc.2 / Node24 / JSDOM / CUA。
**Spec:** docs/superpowers/specs/2026-09-21-dsh-product-experience.md

## Global Constraints
- 中文界面，宿主主题，模型纯文本语义，未知投递不自动重放。
- 不改旧revision，不删除用户数据，其他端暂停，Flash费用受限。
- 用户已授权自主设计/实施/验证；记录block不因可独立绕开的阻碍停止开发。

## Review Focus
- 弹层在小高度视口/缩放/滚动后关闭和发送仍可触达。
- 未知发送关闭/切换再打开仍使用原requestId。
- 插件语义旁有正常文字、图片附件时不能误删。
- 数据升级时个人修改、归档和旧历史必须保留。
- AI发送进度类表达不得编造任务事实或把表情当执行授权。

### Task 1: 选择器和对话表达
Files: src/dsh/{picker-popover,client,media,messages,ai-messages,ui}.tsx, expression-message.ts; tests/dsh-product-ui.test.ts。
Interfaces: 保留createComponents/rpc合同；PickerPopover增加onDismiss；AmojiImage增加thumbnail展示；仅精确插件语义可移除。
- [ ] 写行为测试：入口二次点击、Escape/外部关闭与焦点、整图可选、纯表情无重复语义/普通混合保留、关闭不重放。
- [ ] `node_modules/.bin/tsx --test tests/dsh-product-ui.test.ts`，Expected: 新交互断言失败。
- [ ] 实施主题tokens、同一按钮图文单元、固定首尾/滚动中区、可信图片独立消息、语义详情渐进披露。
- [ ] 同命令+既有native/reliability/final-fix回归，Expected: 全通过；CUA真实QA检查桌面与小视口。
- [ ] 提交完整任务切片，更新ledger，不宣称整个目标完成。

### Task 2: 管理与创作体验
Files: src/dsh/{manager,library-controls,draft-editor,preferences,pack-controls,ui}.tsx; tests/dsh-management-ui.test.ts。
- [ ] 行为测试先验证库详情关闭/切换、搜索、草稿保留，记录失败。
- [ ] 实现导航/详情分栏，基本字段与高级语义分层，统一控件/空态/错误文案。
- [ ] 运行管理邻接测试；CUA新建/编辑/预览/冲突/偏好/包操作，Expected: 功能保留且主动作清晰可达。
- [ ] 提交并写ledger。

### Task 3: 协作表情内容与升级
Files: assets/base-library/*, scripts/build-base-library.mjs, 相关shared/store基础包初始化代码，内容测试。
- [ ] 确定约12–16项图文定义和发送者约束；检查现素材；需要的新图使用imagegen skill，不能直接改旧含义。
- [ ] 内容/升级测试覆盖旧内置归档、历史保留、用户资产不动、新库新目录一致；先失败。
- [ ] 实施内容包与确定性迁移，审阅全部图片/含义，不保留无意义凑数项。
- [ ] 测试纯文本投影、包验证、升级/历史；有必要时仅少量Flash重点场景。
- [ ] 提交并写ledger。

### Task 4: 最终实际安装与视觉交付
Files: docs/validation/dsh-product-experience.md, 分发产物与状态页。
- [ ] typecheck/build/相关完整回归，修复实际失败，不刷无关模型矩阵。
- [ ] 安装最终包到QA，CUA桌面/窄屏/明暗/键盘/历史/错误逐项检查；必要的真实UI修正继续迭代。
- [ ] 一次独立最终review，处理重大问题；安装日常profile前备份并核对范围，不停其他用户会话。
- [ ] 报告验收证据、包摘要、保留风险与block；全量目标未证实则不关闭goal。
