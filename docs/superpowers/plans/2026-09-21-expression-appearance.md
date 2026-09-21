# Expression appearance implementation

Spec: docs/superpowers/specs/2026-09-21-expression-appearance.md

## Global Constraints
- 所有工作在当前隔离工作树，不修改 main 或提交其他人的文件。不得派生子代理。
- 不变语义、不改历史精确引用；快速双击不重复发；恢复不确定请求不得换身份。
- 切画风与 AI style 独立。仅对 builtin 应用主题过滤，用户资产保留。
- 此任务允许本地可逆实现与测试，不重启用户服务、不运行有费用模型、不推远端。

## Task 1: 双画风数据行为及 dsh 点选发送

在 src 和必要测试、打包模块清单中实现 spec 的代码部分。负责 src/library-management.ts、src/library-store.ts、src/dsh/*、相关 tests，若新增 runtime 模块则更新打包脚本清单。不编辑 assets 或 build-collaboration-library.mjs；根代理负责素材。

精确契约：PersonalPreferences.appearance?: 'classic' | 'office'，缺省读为 classic、写入缺省保留现值；与 AI style 分开，picker提供画风选择立即保存并刷新catalog，设置 CAS 错误可恢复。管理库明确可切换画风，不同时重复显示同 family 的两套。tags 使用 amoji:appearance:classic/office 和 amoji:family:<slug>，仅 builtin 生效。list/catalog/AIsearch 选偏好画风；receive/emit 以所有未归档精确版本检查可发资格。保留在途 token。

新 pack 策略 retired_samples 只接受 assets/samples/manifest.json 里三个固定原始 asset/revision 引用，可以归档这些确切开发样本（来源可以 imported），不能归档改版或副本。普通 retired 仍仅 builtin 来源。素材包稍后从当前 14 变为 32（16×2），功能测试用自行构建两画风 fixture，避免依赖尚未生成素材。旧硬编码14的库打包测试待 Task2 更新。

发送重构：表情按钮一次点击即send(expression,requestId)，同步 ref 锁避免渲染前双点击，未知状态保留请求id及核对原会话机制。详情独立可访问按钮，不嵌套按钮。移除正常发送所选表情步骤，但保留需要的错误恢复按钮。选择器提示“点击即发送”。主入口精确高度28px（后由根代理真实宿主测量调整），min-height覆盖通用36，font-size12、图标16且padding与原生协调，不改管理控件。

验证覆盖上述边界；运行相关 tests 和 typecheck，允许剩余旧素材数量断言待Task2处理。完成自查后只提交所负责文件；报告写入 plan workspace/task-1-report.md，列出 commit、测试命令结果和具体限制。最后简报 DONE/DONE_WITH_CONCERNS。

## Task 2: 同语义素材包

根代理生成 16 语义 classic/office 包。经典复用原三图其余新增；办公全部新生成，真透明。保留原14 semantics，增加 wry 和 encourage（后者名给你加油）。记录 prompts/provenance；新uuid namespace，retired合并 v1及v2 defaults，retired_samples固定三样本defaults。更新相关素材测试。运行包验证、全套测试。

## Task 3: 集成验收

代码任务评审、素材视觉检查；打包并在QA实际Edge验证native按钮高度、一点击一次、切画风、历史保留；备份且空闲时更新日常已安装插件。只必要低成本Flash验证，记录费用请求数。完成新验收文档，不额外扩展其他host。
