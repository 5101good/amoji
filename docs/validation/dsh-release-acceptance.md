# dsh 分发候选验收

日期：2026-09-20。目标：Amoji 0.1.0-dev.1、dsh 0.1.5-rc.2、Node 24、macOS arm64。按用户确认的 [dsh 优先范围](../planning/dsh-focus-2026-09-19.md)，旧票中的主验证宿主改为 dsh；Codex/Claude Code 新增适配和真机矩阵暂停。此文是候选交付与补验表，不宣称完整 v0.1 或外部发布完成。

## 本次实现与自动验证边界

共享 `/connect` 首行握手后默认每15秒输出 NDJSON 心跳；每连接独立计时器，断开清理，遇背压不积压。客户端兼容忽略后续保活帧。没有增大 Node fetch 默认超时，没有每五分钟重启要求。SharedClient 显式重连重新检查身份、API和必需 capability；并发恢复合并，旧绑定作废，任何原操作都不会自动重放。卸载关闭自身连接，多客户端共享核心不因一个客户端退出停止。

dsh 新增 `dsh-reliable-delivery-v1` 必需能力。提交先由共享核心原子记录 attempted，再调用原生 prompt：已接受/已观察到的同 requestId 返回原消息；attempted但无法找到原生结果则显示未知，不再次调用 prompt。双适配器争用也只有一次 prompt。未知窗包括“attempted 已保存、尚未来得及 prompt”，为避免重复同样停止自动发送。用户必须核对原会话，不应重新选择制造新 requestId。

状态含义：prepared=尚未提交；accepted=宿主接纳且后置 flush 成功；observed=匹配原生 user/message.source.rpcId 的消息已可观察；unknown=已尝试但结果无法确定。消息的 legacy delivery=pending 不代表模型已经收到。presentation 独立：只有匹配 messageId/hash 的浏览器 load 才是 rendered；图片失败用固定文字 fallback。模型真实收到/理解仍须出站请求和实际回复证明。

Picker 会对当前原消息最多自动核对60秒，也提供“核对投递状态”。“重新连接并核对”恢复同一共享库并读原会话，不提交新消息；响应完全丢失时保留原选择，再点击原发送操作使用相同 requestId 查询其结果。服务连接错误使用中文操作提示；加载失败清空失效候选并暂停发送。管理窗口提供“重新连接共享库”，保留编辑输入；已确认草稿可直接切换下一次编辑。

自动检查见 `tests/shared-reliability.test.ts`、`tests/dsh-reliability-ui.test.ts`、`tests/dsh-host.test.ts`：真实HTTP心跳、真实服务关闭/重启、原绑定失效与请求/已消费凭据去重、丢失提交响应、并发原子投递、原生rpcId核对、取消/卸载、中文恢复UI。JS DOM不证明真实浏览器像素、六分钟空闲或付费模型质量。

## T01–T20 与 AC01–AC20 映射

沿用原验收顺序，T编号对应同号AC；主宿主均为dsh。D1–D4已有真实记录不会冒充最终D5包验收。

| 场景 | 已有实际/自动证据 | 当前结论与剩余边界 |
|---|---|---|
| T01 用户单发表情 | D1真实零文字输入/自然回复；1bf2dac暂停下手动A1/A2各completed | 真实Host通过；最终修补选择器切会话路径待验 |
| T02 AI自主检索发送 | D1完整search→emit→回复；30组中7次自主发送；D4主流图/展开去重 | 功能通过，1个固定含义主客体错误纳入最终提示修补 |
| T03 模型文字路径 | D1真实wire；正式79请求及生命周期3请求均0图像；旧A1续聊 | 已观察路径通过；强制上下文压缩后请求尚未验 |
| T04 固定语义不可覆盖 | Host/shared严格字段反例，历史快照与精确ref合同 | 自动检查通过 |
| T05 创建/建议/确认 | D4浏览器上传、建议修改采用、预览load与明确确认 | 主旅程通过；清空可选字段的最终修补待针对复验 |
| T06 建议不可用手工继续 | 自动故障与保留输入合同通过 | 真机UI建议故障尚未验 |
| T07 原素材需补语义 | 草稿严格字段校验、预览确认门禁自动检查 | 真机UI缺语义反例尚未验 |
| T08 完整包/重复/损坏 | D3原子/损坏校验27项；D4真实浏览器导出与重复导入 | 正常与重复真机通过，损坏路径为自动服务合同证据 |
| T09 新目录恢复 | D4浏览器导出文件经安装runtime导入全新目录，固定字段与blob哈希一致 | 新数据目录恢复通过；不声称全新机器安装 |
| T10 编辑后旧历史 | 1bf2dac真实Host A1→A2更换文字和图；A1历史与字节hash保持，续聊正确 | Host/模型通过；浏览器新版本编辑、重开旧图尚未验 |
| T11 个人副本 | D4 builtin→local/derived_from、原版不变，归档恢复 | 真实UI通过；外部包同类路径有公共合同证据 |
| T12 自主/暂停/恢复 | 30组自主选择；D4偏好UI；暂停下人仍可发、AI只文字；公开API恢复原偏好 | 已执行路径通过；恢复后再次AI发送未新增模型复验 |
| T13 频率与去重 | 自动可信零工具回合/冷恢复/并发保护；真实同request无新模型请求 | 合同与真实重查通过；所有频率档位未逐档真机 |
| T14 同机共享 | 公共服务独立客户端；真实两个dsh Session同设置 | 同Host双会话共享通过；第二独立dsh Host退出保留另一端未真机 |
| T15 隔离/切换/重连 | 真实A/B原生消息隔离；自有核心退出后原Host显式重连成功 | Host通过；跨UI会话未知身份漏洞最终修补中 |
| T16 用户入口/AI展示 | D1/D4原生输入区选择器、主对话图去重 | 已真实通过；最终Client构建待装载复核 |
| T17 开箱24项 | 基础包24版本/25素材；真实安装默认库，正式模型使用纯24库 | 库及静态/动画素材通过 |
| T18 私有与导出 | 包白名单检查；实际导出文件仅manifest+所选blob | 通过；最终tarball另核对分发内容 |
| T19 动图/封面/历史 | D1真实静态/动图预览与暂停；D4对话动图；自动失败fallback | 基础展示通过；冷恢复可见及实际缺图fallback剩余UI待验 |
| T20 故障与未知 | 同Host闲置370042ms；真实退出核心→显式恢复；官方remove/reinstall数据一致 | 核心恢复通过；最终跨Session未知/管理写入丢响应修补待验 |

证据层级必须保留：自动合同、真实Host、模型wire和浏览器UI各证明自己的部分。无需因纯文档或无关包哈希变化重跑已证行为，也不能将一个层级的成功补成另一个层级的通过。最新[30组质量成本](dsh-semantic-benchmark-2026-09-20.md)和[真实生命周期](dsh-lifecycle-live-2026-09-20.md)是本表的补充。

## root 最终实际操作

1. 使用唯一目录里的候选tgz，通过官方CLI安装到独立profile。关闭自有旧QA Host及Client后，按 serviceId 安全停止仅该QA核心；不要杀其他端或用户3080服务。启动后记录BUILD、核心PID完整命令路径，必须来自已安装包 runtime，不能复用工作树核心。
2. 同一Host空闲至少六分钟再执行catalog/search/管理，记录起止时间、租约流错误及服务身份；不得以短时钟测试替代。
3. 两个真实Session交错发送，保留requestId/messageId/native rpcId。提交前断线应可恢复原选择；prompt接纳后断线应核对原消息，不再次prompt；找不到原生结果应保留unknown。切换会话不改原目标。
4. 使用准确QA实例关闭/重启核心和Host，确认冷恢复原生事件合法、A1历史仍为A1、图片load回执正确。实际移除一个客户端后另一端继续工作；重装/升级前后对照条目、blobs、消息和设置。默认用户库激活另外检查能力，不能用隔离QA代表已激活。
5. 30个独立语境的质量/成本对照已完成执行：60会话、59completed、1网关超时；79真实模型请求全无图像，7次表情有1次语义不合适。原失败保留，见模型对照报告；最终提示改动只复验明确失败例，不刷整批覆盖旧结果。

性能已有独立证据无需重跑：root在Node24.19/M4/16GiB，公共包导入构建1000 current entries，warmup10、samples60，真实HTTP search p50=14.589ms、p95=15.384ms、max=18.138ms，≤150ms目标通过，0模型请求。此结果不是浏览器300ms渲染验收。

实际网关早前openai-responses的reasoning_text 400/stream终态缺失与测试主动预算中止均保留在D1证据。低成本Flash成功路径仅针对该网关的openai-completions兼容配置；插件不改模型、协议或凭据，不推断DeepSeek官方或其他provider是否支持Responses。

## 本地最终自动检查记录

D5核心回归 `npm test`：100 tests / 100 pass / 0 fail / 0 skipped，23.69秒。首轮94/100中的六项未隐藏：草稿丢响应后须显式重连；旧Claude三样本测试未显式选样本库；两个独立插件产物测试连续发送触发新的克制默认策略；ZIP清理测试误比较整机tmp；Node24按name过滤仍计文件导致pass1假设失效。修复仅更新相应fixture、临时目录隔离和错误分类，未删除/跳过行为检查。

`npm run test:dsh`：52 tests通过，包含真实npm合同、build、Native Session及UI检查。最终自审补了迟到核对不得覆盖新选择的反例，随后重跑dsh集合；没有因纯文档或包哈希变化重复模型请求。`npm run typecheck`及`git diff --check`通过。实际tgz检查确认52文件，包含MIT/CC0/来源、16个实际安装依赖的许可证据、Sharp/libvips版本；无node_modules、原生二进制、历史开发样本、个人库或服务凭据。最终安装以提交后重新build/pack的唯一产物及其SHA256为准，不把提交前候选哈希冒充最终包。

D5 fix1：SharedClient 的每次RPC捕获所属lease，迟到异常只终止旧代，不再取消已恢复的新连接。实际createRpc提交传输异常产生DSH_OUTCOME_UNKNOWN时，Picker分别保留投递未知与连接不可用状态：失效候选清空、改选冻结，原ref/requestId跨关闭重开仍保留；重连不重放提交，原请求核对到accepted/observed后才解除未知冻结。即使原版本已不在新候选列表，仍保留原请求核对身份。两项真实反例先红后绿；聚焦可靠性7/7、重建实际Client产物回归3/3，typecheck/build通过。本轮没有重复此前100/52全量，也没有新增真实模型或安装验收结论。

## 当前收尾门槛

整支最终审查确认3 Important、3 Minor，集中修补范围为：跨会话保存未知投递身份、可选字段清空、管理写入响应丢失分类、分发遗漏web资源、陈旧状态文档、草稿版本变化使旧建议失效；另修模型可见主体关系与limit默认值说明。最终bbcd0cc已经完成唯一限定复审，原六项全部关闭、Spec/Quality通过、0残余；25项聚焦与邻接、类型/构建通过。官方CLI已将最终tgz安装到QA和日常web，installed runtime/Client摘要核实。

浏览器仍被“结束当前编辑？”原生确认框阻碍点击，已请求用户手动取消；只读页面和后台Host可用。没有用其他自动化绕过受阻的原生应用控制，也没有把待验UI记为通过。用户日常web profile已实际安装并启动于3080，认证只读catalog27通过。应用内浏览器打开3080报ERR_BLOCKED_BY_CLIENT，未绕过该拒绝；仍未声明日常浏览器点击验收完成。

## 最终本地候选与运行状态

产品提交：`bbcd0cceb840d85a8b073c14de614740b86f5fb6`。包：`.local/release-preparation/final-fix-bbcd0cc/amoji-dsh-0.1.0-dev.1.tgz`；SHA256 `ff9712125b3f20a1d46cc371301a65be1f2dd78dccaf704ad5e2a605a5034dc0`；Client SHA256 `8f46fb24858a77ae14d0d87c769c0b60dbcf75f3ab29de8eebd9f07d926def74`。最终包55文件、实际解包首页/CSS/JS200、16依赖许可清单通过；不再沿用D5早期52文件数字作为最终包结果。

2026-09-20 官方CLI add --profile web exit0，日常Host启动3080、默认共享核心API2/DB4及必需capabilities存在。认证只读管理与catalog27成功，无测试prompt或模型调用。原cordis.patch.yml/cordis.yml/pnpm-workspace.yaml摘要未变，package.json仅新增本地Amoji依赖；原配置私有备份在`.local/dsh-focus/user-web-preinstall`，默认库启动前备份在`user-data-preactivation`，原11个非数据库文件均逐字节保留。旧3张开发表情没有自动删除。证据`D5/user-web-installed.json`。

独立QA Host与核心已正常关闭，日常web Host保留运行供用户使用；没有关闭其他客户端。付费QA累计107次Flash请求后冻结，不留后台模型重试。代码及证据保留在codex/v0.1-completion，main未合并、无remote/推送/外部发布。完整实施裁决见[裁决记录](implementation-rulings-v0.1.md)。

最终支持结论：**dsh 0.1.5-rc.2 / macOS arm64 / Node24的原生表情与管理能力已实现、已安装，并有真实双向模型和主要UI证据；完整v0.1浏览器验收尚未全部完成。** 其他版本/OS/PTC、新版Codex/Claude无新增通过声明。上表尚未观察的UI、强制压缩恢复、独立双Host生命周期等部分不得自行变成通过；现有公共合同证据仍有效。
