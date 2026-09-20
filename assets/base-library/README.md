# Amoji 协作表情库

`base.amoji` 是普通 Amoji v0.1 ZIP 包，包含 14 个固定版本和 14 张透明 PNG，按进度、澄清、方向、反馈四个场景组织。内容定义见 `definitions.json`，可审阅版本见 `manifest.json`。每张图配有固定含义、适用/避免场景和 fallback 文字；模型只接收文字语义。

所有图片由 Codex 内置 imagegen 为本项目生成，采用统一的蓝色圆豆角色，没有使用外部 IM 图片或真人参考。`provenance.json` 记录生成器、原始文件摘要、视觉意图和包内素材位置；它不是完整的逐次生成对话。图片仅作统一 512px PNG 封装，保留透明度。本目录原创视觉和语义按 CC0-1.0 提供，见 LICENSE；不改变用户或第三方内容许可。

升级政策位于 `builtin-policy.json`：仅将旧内置库中身份和当前版本均精确匹配的表情归档，不删除历史版本、图片和消息。用户导入、个人副本以及不同当前版本保持原样；迁移每个包身份只执行一次，之后用户主动恢复或归档的状态不会被重启覆盖。新安装默认 14 项，已有用户内容保留，因此升级后的总数可能更多。

维护者重建：先运行 `npm run build`，再运行 `node scripts/build-collaboration-library.mjs <source-directory>`。输入目录须有 `definitions.json` 中各 slug 对应的透明 PNG。脚本不调用模型，打包后使用公共导入校验器验证。当前包身份不可用于发布修改过的内容；新内容发布需分配新的包身份和相应迁移政策。旧 v1 包仅作为 `tests/fixtures/base-library-v1` 的升级测试材料保留。

基础包和投影检查不能代替 dsh 中真实挑选、发送、回显和响应式页面验收。尚未外部公开发布。
