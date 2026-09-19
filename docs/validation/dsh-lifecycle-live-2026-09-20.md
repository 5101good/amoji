# dsh 安装版生命周期实测

日期：2026-09-20。dsh 0.1.5-rc.2、Node24.19/macOS arm64、Amoji安装版1bf2dac，独立amoji-qa profile与数据目录。操作来自认证的公开Host接口和官方Session接口；不是浏览器按钮/像素验收。模型仅llm-ai-web/deepseek-v4-flash、Chat/Off、输出256、零重试。

## 暂停、双会话、版本与续聊

通过原生管理接口暂时将偏好paused=true；两个新Session读到完全相同的设置。A会话只发送已创建个人表情A1，B会话稍后发送同asset的新版本A2，最后回到A续聊。三个回合各一个模型请求，全部completed，所有真实wire均0图像内容块、0图像data URL，均未调用任何工具。用户仍能在AI暂停状态下手动发表情，AI理解固定含义并文字回答，没有AI表情记录。

A会话 `session-b0b91609-e23e-44c2-9959-2121d6c3a793`；B会话 `session-c0641c89-560b-4b64-8127-c345730d26ce`。A首次消息ID `26326f2d-b7a8-44e1-aa94-a0b51c5de800`，B消息ID `e8ba0c2c-a25d-40b2-b718-7fa9be0bbcb9`；原生source.rpcId各为amoji加对应messageId，分别观察到observed状态。相同requestId重查A返回原messageId，wire请求数不变；B历史没有A消息，A也没有B的新版本。

| 项目 | A1 旧版 | A2 新版 |
|---|---|---|
| asset_id | facf5bd8-ac43-47ca-a3ca-a8ad78cb8f22 | 相同 |
| revision_id | 0e63ec92-5310-4ab6-a844-932b847b8705 | 9f83caaf-a185-4edc-a081-c638d3dd1ce3 |
| 名称 | QA 一起弄明白 | QA 新版一起庆祝 |
| 固定含义 | 感谢对方耐心陪伴，共同把问题弄明白；不表示已经同意执行任何操作。 | 为已经完成的小进展开心庆祝。 |
| 图片SHA256 | 173385587a317ff55d2e5b84ea7215010e301b0de7a58a69fa042e74394a7645 | 5684c88497966b68b1081c18d0bd60667e020a9771558fdebf9defcf67fbb154 |

新版本经startRevisionDraft→saveDraft（新文字和新图片）→previewDraft→confirmDraft生成，没有直接修改数据库。确认后读A历史，完整旧Expression与A1逐字段一致；按messageId/ref请求旧图片，实际字节SHA256仍等于旧hash。A续聊询问刚才表情含义，模型回答：“你刚才表达了真诚的感谢，感谢我耐心陪伴你一起把问题弄明白。”没有把A2庆祝含义套到A1。

结束后通过公开管理接口恢复原偏好neutral/restrained/paused=false（CAS version5），恢复该QA作品归档状态。新版本、会话和原始证据保留；未改用户日常库。原始记录：`.local/dsh-focus/D5/lifecycle-live.json`，脚本`lifecycle-live.mjs`。

## 空闲保活、真实重连、卸载重装

- 安装版37ded97、同一QA Host连续空闲370042ms后，catalog由29到29，history仍一致；未靠重启Host或扩大fetch超时通过。早前D3在301395ms发生UND_ERR_BODY_TIMEOUT的失败记录保留。证据：`lease-acceptance.json`、`lease-observation.json`。
- 仅终止核对过命令路径和数据目录的自有QA核心，原Host返回中文CONNECTION_CLOSED；通过amoji/reconnect恢复新核心，catalog29/history1恢复。未杀用户进程或强开第二个writer。证据：`D5/real-reconnect.json`。
- 官方CLI remove @amoji/dsh exit0，依赖移除而27个数据文件/sqlite保留。add 1bf2dac独立候选exit0并启动installed runtime；catalog29/history1/settings JSON与卸载前相同。最初Host尚未完全退出时stop返回SERVICE_BUSY，等待自有Host退出后按正确serviceId成功；保护没有被绕过。证据：`D5/removed-check.json`、`D5/reinstalled-check.json`、`D5/before-remove.json`。

1bf2dac仅修改客户端RPC代际与选择器未知状态，心跳服务实现未变，因此不为包哈希变化重复六分钟测试。最终修补若影响对应行为，按具体变更补聚焦检查，不能自动推断完整最终UI通过。

## 仍未由本记录证明

原生浏览器确认框阻塞尚未解除，剩余新版本编辑按钮、多会话切换下未知状态恢复、冷恢复图片可见等操作不能用上述Host API结果冒充。视觉正确性有此前[D4真实界面记录](dsh-ui-live-2026-09-20.md)；30组质量与成本另见[模型对照](dsh-semantic-benchmark-2026-09-20.md)。当前此证据只针对隔离QA，不能声称已在用户日常web profile激活。
