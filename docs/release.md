# 发布范围、流程与已知限制

[English](release.en.md) · [文档首页](README.md)

## 2.0.0 范围

Amoji 2.0.0 实现 [Amoji 0.1 协议](specs/amoji-0.1-rfc.md)：码位注册表、多语言固定语义与翻译来源、表情包与可选效果、AI 按码位表达、AI 工作时的纠偏信号与中断，以及决策选项和快捷回复。产品版本 `2.0.0`、协议 `0.1`、注册表 `0.1-r3`、共享 API `3` 和数据库 `1` 分别维护。

支持的分发目标是 dsh **0.1.5-rc.2** 与支持 Mods 的 **Claude Desktop Code 本地会话**（Claude Code 基线 **2.1.295+**），均需要 **Node.js >=24**。[GitHub Release](https://github.com/5101good/amoji/releases/tag/v2.0.0) 提供 `amoji-dsh-2.0.0.tgz` 和 `amoji-claude-mods-2.0.0.zip`。依赖在安装时解析，发行包不捆绑 Node、宿主或原生依赖；这不是离线安装器或 npm registry 发布承诺。

两套适配器提供双向表情、个人库、草稿确认、版本与归档、包导入导出、AI 偏好和文字建议，并接入审核制表情包市场、账号连接、分享投稿和可选协作提示。经典与办公各 24 个表情、实现相同的 22 个码位；七套官方包作为独立 `.amoji` 附件分发。中英界面按语言回退显示多语言语义，不自动翻译用户内容。完整范围和安装命令见 [2.0.0 发布说明](releases/v2.0.0.md)。

## 破坏性变更与升级

Amoji 0.1 取代此前全部格式，不提供兼容层。1.x 的 `.amoji` 包不能导入，1.x 数据库没有就地迁移路径；数据库从 `1` 重新编号不表示旧库兼容。2.0.0 在原目录使用 `library-0.1.sqlite`，保留旧 `library.sqlite`，继续使用 `blobs/`，不要求空目录。升级前关闭所有旧客户端、等待共享服务退出并备份完整目录；需要隔离试用时可另设 `AMOJI_DATA_DIR`。不要删除旧库、改数据库文件名或版本号，也不要同时运行共用同一目录的新旧服务。共享库的 dsh 与 Claude Mods 应同时使用 2.0.0。详见[升级与回退](dsh-installation.md#从-1x-升级到-200)。

市场服务另需迁移 `0010-amoji-0.1.sql` 并发布兼容的包版本；插件发行不证明生产市场已完成迁移或部署。运营操作见[市场运营与恢复](marketplace-operations.md)。

## 已知限制

- dsh 尚不能识别宿主中的待决确认，因此 pressure_sensitive 码位的“待决确认时禁用”只在 `core:decide` 之后生效。
- RFC 允许的自适应频率未实现；AI 表情按每个回应窗口的固定上限限制。
- dsh 界面尚未提供锚定到消息原文的选择菜单；协议与服务端支持锚定。
- 五套角色包全部 20 条英文已由维护者人工审校确认，标为机器翻译后人工审核（`method: "machine-reviewed"`）；[审校记录](releases/v2.0.0-english-review.md)与生产市场审核分别维护。
- macOS arm64 有历史真机记录；Linux、Windows、其他 dsh 版本没有完整真机矩阵。历史结果不能代替本次候选包验收。
- AI 原生图片以 direct tools 路径为验证目标。Code Dispatch / PTC 嵌套调用可能丢失视觉元数据，不保证渲染。
- 部分模型的工具续答存在宿主/提供方兼容问题；历史 Flash 路由曾因缺少 `reasoning_text` 返回 HTTP 400。Amoji 不保证所有模型完成完整工具回合。
- 文字建议依赖宿主模型服务与凭据。超时、取消、配额、模型列表和输出格式错误会明确失败，无自动重试或伪装成本地模板结果。
- Claude Mods 的文件输入采用本地路径，动画显示静态封面；普通 Chat、Cowork、云端会话不在其适配范围。详见 [Mods 指南](claude-mods.md)。
- 独立真人易用性研究未作为已完成项；旧 Codex/Claude hook 适配器仍为 legacy。

## 证据分层

源码实现、自动测试、发行包完整性、安装退出码、浏览器/原生绘制、完整真实模型回合和生产服务部署是不同结论，分别提供证据。最终发行包应能追溯到对应提交、标签、Actions 工作流、附件摘要及实际验收记录；本地构建不证明已公开发布。

历史材料包括 [1.0 发布审计](release-audit.md)、[1.1 发布说明](releases/v1.1.0.md)与 [Claude 历史真机记录](claude-mods.md#历史真机验证记录)。其中的安装、模型、备份、恢复与公网结果只对应原记录，不能转用为 2.0.0 的验收结论。

## 维护者发布流程

1. 将根 `package.json` 与锁文件、dsh 包和 Claude Mods 清单同步为 `2.0.0`，更新中英指南与 `docs/releases/v2.0.0.md`。产品、协议、API 和数据库版本分别维护；历史发行文件不重写。
2. 从最终候选提交执行类型检查、核心测试、完整 dsh 测试、Claude Mods strict 校验/控件测试和制品测试；检查官方包、构建清单、依赖许可、隐私与个人路径。
3. 对最终候选执行实际安装和适用的 UI/模型验收，分别记录通过、失败与未验证项。费用型请求保持在明确范围内；英文语义只有经过真人确认后才可标为人工审校。
4. 构建统一附件：`node scripts/release-artifacts.mjs` 按根版本读取 `docs/releases/v2.0.0.md`，`node scripts/append-claude-release.mjs` 校验并加入 Claude ZIP，生成统一的 `SHA256SUMS` 和 `BUILD_PROVENANCE.json`。本地检查不能替代远端工作流。
5. 推送对应 `v2.0.0` 标签，由仓库官方 [CI and release 工作流](../.github/workflows/ci.yml)从同一提交构建、校验并发布 tgz、ZIP、七套官方包、许可、发布正文、摘要和 provenance（提交、标签、Actions 运行地址）。
6. 检查对应 [Actions](https://github.com/5101good/amoji/actions) 的实际结果；下载 Release 附件，核对 SHA-256、标签提交与 provenance。工作流文件存在不代表成功发布，插件 Release 也不代表市场服务已部署或第三方目录已更新。

代码及技术文档为 MIT；官方表情包的素材、固定语义与提示为 CC0-1.0。依赖许可清单以实际构建为准，Sharp/libvips 等依赖保留自身许可。参见 [NOTICE](../NOTICE) 与[官方表情包](../assets/official-packs/README.md)。
