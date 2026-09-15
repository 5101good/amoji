# 06 动图播放、暂停与替代呈现

日期：2026-09-16。固定基线 `6050f34`。状态：媒体合同、共享服务、共用面板和 dsh Client 的本地实现及检查完成；安装版 Codex 的播放、暂停、历史回放与实际请求检查留票据 19 集中执行。本记录不把 JSDOM、共享客户端或自建 MCP 客户端称为真实宿主验证。

## 公共媒体接缝

`src/media.ts` 暴露 `MEDIA_LIMITS`、`validateMediaBlob(bytes, declaration, expected)` 和 `validateExpressionMedia(expression, readBlob)`。`SampleCatalog.load` 已改为经过整体接缝，因此当前真实持久库种子和以后复用该入口的创建/导入会采用同一规则。

验证顺序如下：

1. 解码前核对 10 MiB 大小、SHA-256、声明尺寸和允许 MIME，拒绝 APNG 标记及 SVG/HTML 等未约定容器。
2. 以一亿输入像素、最多四通道、顺序读取及警告即失败的限制读取真实 metadata，核对实际格式、逐帧尺寸和声明。
3. 在分配完整像素输出前核对 2048 边长、200 帧、10 秒及一亿累计解码像素。
4. 强制全部帧转为 raw 像素并核对完整输出尺寸，使可读 metadata 但像素截断的文件不能通过。
5. 整体核对静态定义无时长/封面，动图时长精确匹配，并要求摘要不同、实际静态的独立封面。

正例用真实 PNG、运行时转码的 JPEG/静态 WebP、真实 GIF 以及仓库中两帧一秒的 animated WebP 与 PNG 封面完成解码。反例覆盖伪造 MIME、像素截断、错误时长、同摘要封面、动态封面、APNG/SVG、10 MiB/2048/200 帧/10 秒/一亿像素超限。

## 视觉与失败行为

共用面板和 dsh Client 使用同一规则：未请求减少动态效果时显示主动画并提供“暂停动图”，暂停后切到该精确版本的静态封面；请求减少动态效果时默认显示封面并提供“播放动图”，偏好运行中切为 reduce 会再次暂停。静态图不显示动画控制。

面板历史直接渲染 `message.revision` 快照；dsh 历史 RPC 用 `messageId + ref + visualHash + posterHash + alt` 核对同一会话的精确版本。播放状态不写回版本或语义。浏览器 `error` 显示原 fallback 与“浏览器无法解码图片”，服务端缺失/损坏显示原 fallback 与对应错误码；两者都记录 fallback/failed 展示事实，不调用模型或替换同名图片。

共享面板 blob 边界在返回字节前继续调用 `blobPath` 的保留字节完整性检查。缺失素材返回 404，摘要损坏返回 422；测试实际破坏临时数据根中的已保留文件，确认没有 200 图片体。

## 已执行检查

| 范围 | 命令与结果 |
|---|---|
| 红灯检查 | 公共完整解码、目录载入、面板 DOM、dsh Client DOM、共享面板错误状态均先在旧实现失败；分别暴露 metadata-only、两端默认策略不一致、模糊 fallback 及统一 500 |
| 受影响回归 | `npm run build:dsh && npx tsx --test tests/media.test.ts tests/samples.test.ts tests/panel-ui.test.ts tests/panel.test.ts tests/shared-panel.test.ts tests/shared-service.test.ts tests/dsh-client.test.ts tests/dsh-host.test.ts tests/mcp.test.ts tests/projection.test.ts`：39/39 通过，退出码 0 |
| 类型检查 | `npm run typecheck`：退出码 0 |
| 构建 | `npm run build`：退出码 0 |

未重复票据 01/02 的真实模型矩阵或完整三端产物套件，未修改用户安装/配置，未调用真实宿主模型。正常模型工具仍只产生固定文字投影；Codex 已验证的 `emit.display_markdown` 入口未改变。

## 待票据 19

在实际安装版 Codex 中统一观察：主动画真实播放、显式暂停后静态封面、恢复会话仍使用原消息快照的主图/封面、素材失败时 fallback 和错误状态，以及实际请求中没有图片内容块或额外模型调用。完成这些证据前，不宣称票据 06 的全部真实宿主门槛关闭。
