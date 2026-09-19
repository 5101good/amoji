# Amoji 基础表情库

`base.amoji` 是普通 Amoji v0.1 ZIP 包，内含 24 个固定版本、25 份素材（23 张静态图、1 个两帧 WebP 动图及其独立 PNG 封面）。六组各四项：喜悦与庆祝、感谢与认可、鼓励与陪伴、疑惑与思考、无奈与调侃、日常关系表达。所有表情均有固定 fallback 文字；静态图以 primary 作封面，动图使用独立 poster。

`manifest.json` 是同一包的可审阅副本，`provenance.json` 保存制作提示、选择/弃用记录、历史提示和 ZIP 内素材位置。实际素材保存在 ZIP 的 `blobs/<sha256>`，摘要来自已选字节，不是占位值。既有开发样本的身份与 pending 许可保持原样；本基础包分配了独立、固定身份。

内容由 Amoji 项目使用 Codex 内置 imagegen 生成并编写语义，动画使用既有精灵图封装成果，未在本阶段重新生成。来源记录未记载外部 IM 表情或真人参考。AI 输出可能不独有；此记录不构成对所有第三方权利或任何司法辖区版权状态的保证。

本目录的原创视觉、固定语义和提示按 CC0-1.0 提供，完整文本见 LICENSE。声明只覆盖此基础库；不改变个人创建、导入内容或第三方依赖的许可。尚未执行外部公开发布。

运行时首次装载直接走完整包校验，来源由服务标记 builtin；用户从文件导入同一包时来源是 imported。已有库记录、归档、个人副本、当前版本和旧会话均保留，不额外初始化三个开发样本。

维护者重建：先 `npm run build`，再 `node scripts/build-base-library.mjs <authoring-directory>`。输入目录须包含已有 authoring.json、inventory.json、generation.json、legacy-generation.json 与 source 素材；脚本不调用模型。它先写临时 ZIP，执行与公共导入相同的完整校验，通过后才替换包。普通安装直接使用已提交包，无需本地制作目录。

D3 自动检查证明包完整性与共享服务使用能力；真实 dsh 挑选、收发和人类图文评审以 D4/D5 证据为准，不能由24项计数代替。
