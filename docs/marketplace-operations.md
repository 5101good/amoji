# 市场运营与恢复

[English](marketplace-operations.en.md)

正式入口为 https://amoji.ai-web.ai。运营者承担人工审核、举报处理和恢复演练责任；面向全球用户，具体网络可达性以实测地区为准。没有邮件验证或邮件找回密码。普通用户可匿名浏览，投稿需要账号，审核者不能批准自己的内容。公网服务与 dsh 插件的发行分别验证，不代表插件市场收录。

## 部署和回退

使用锁定依赖、Node.js 24、`apps/marketplace/wrangler.jsonc` 中的 production 环境。顺序为新增 D1 迁移、Worker API/静态站点、最后客户端。现有 D1 已应用的迁移不得重跑；已有 SQLite DO 的 `free-runtime-v1` migration tag 不得改名或重新创建 class。只绑定 `amoji.ai-web.ai`，不得修改根域或其他服务。R2 CORS 仅允许这个正式来源。`UPLOAD_ENABLED=false` 是默认停写开关；只有确认共享额度、安全凭据和验收后才能开启。

Worker secrets 为 `BETTER_AUTH_SECRET`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` 和 `D1_BACKUP_API_TOKEN`，不写仓库、构建产物或日志。前面三个现有 secret 在更新时必须保留。备份 token 仅需此账号的 D1 Read，不需要 R2 管理权限；应用通过私有 R2 binding 写入。D1 Read 的平台授权范围为账号，不能宣称数据库级 token 隔离。轮换 token 前配置替代值并确认下一次成功备份。

发布前记录当前 Worker version/deployment、D1 migrations、域名路由和客户端 SHA；失败时回退到上一 Worker version 并核对 `/v1/packs`、登录和上传来源。新增兼容表无需删除。DB5 客户端回退必须停止所有宿主/共享服务写入，导出新数据并恢复升级前一致性备份；禁止旧二进制直接打开 DB5，禁止手改 user_version。

## 配额与诊断

不启用 Workers Paid、Containers 或自动升配。免费资源共享于整个 Cloudflare 账号，应用额度不能证明账号仍有余额。至少每日核对 Workers/D1/R2/SQLite DO 实际用量、失败率和存储量；先停新上传，再诊断，不能靠升级套餐掩盖超限。

现有应用限制包括每日 128 次预留和校验、256 次签名、2000 次密码计算、最多 100 个未回收上传和 1 GiB 预留存储；公开读取每 IP 每分钟 120 次、举报每小时 5 次。签名重放可能消耗额外 R2 请求，应用限额不是绝对账单上限。账号免费额度接近阈值时设 `UPLOAD_ENABLED=false` 并核对新上传拒绝；已发布读取与举报仍应可用。保留服务端错误码和请求 ID，不记录 cookie、token、完整 HTTP headers、SQL 或模型输入。

`GET /v1/health` 与目录共享每 IP 每分钟 120 次的持久限流，返回备份状态及最近成功快照时刻；缺失、失败或超过 24 小时时返回 503。运营者应监控非 200 状态。该时刻是导出开始时刻，保守反映快照年龄，不把延迟完成时间当成新快照。`Server-Timing: amoji;dur=…` 记录 API 服务端耗时，包含 Worker 到 DO 的开销，不含用户网络。

## 私有备份与真实恢复

现有每 15 分钟 cron 在独立备份 DO 中推进官方 D1 export，最早每 12 小时创建新快照，给重试留余量。导出 bookmark 只存在私有 R2；下载只允许 Cloudflare 实测导出域，禁止重定向。SQL 以固定长度流式传输并增量计算 SHA-256，单次上限 256 MiB，超限明确失败并保持旧备份。SQL 与状态在 `backups/` 下，最长保留 30 天，与业务清理分开；总备份预算 2 GiB，达到预算时先移除最旧备份，保留当前成功快照直到新快照完整写入。随机不可变对象键与状态内 SHA-256 绑定，写完 SQL 才切换成功指针。到期清理不依赖导出成功，最后一个备份到期也会删除并显示失败。容量超过限制必须重新评估，不能静默截断。

备份包含认证与私有稿件数据，只能由获授权运营者访问，不能提供公网下载。已公开版本引用的 sealed 对象保持不可变、按摘要验证；恢复时同时核对对象，不能只检查 SQL。私有内容与账号删除遵循产品保留政策，备份中残留数据最多保留 30 天。平台内备份不构成供应商级灾难隔离。

恢复演练必须：

1. 从私有 R2 取成功状态与指定 SQL，保存到权限 0700 的临时目录、文件 0600，不回显正文。
2. 运行 `node apps/marketplace/scripts/verify-backup.mjs SQL_FILE STATUS_JSON NEW_PRIVATE_DIRECTORY`，检查 SQL 摘要、SQLite 完整性、外键、精确 release 状态和公开指针。此工具只证明离线核验，不证明云端恢复。
3. 创建明确标识的隔离 D1/R2/Worker，向空库导入同一 SQL，复制所有恢复目标 sealed 对象并逐个核对摘要。确认审核、下架状态和目录指针与备份一致，再用恢复 Worker 匿名获取批准版本，拒绝待审与下架版本。
4. 分别记录快照时刻、恢复开始/完成和对象摘要；要求 RPO ≤24 小时、RTO ≤4 小时。完成后删除演练资源，保留脱敏摘要与正式备份。不因 Time Travel 或脚本存在而报告恢复成功。

## 性能验证

`apps/marketplace/scripts/catalog-load-fixture.mjs PRIVATE_OUTPUT.sql` 生成合成 10000 包数据，**只能写隔离性能数据库**，禁止导入正式目录。使用相同迁移/Worker 版本和真实 D1，记录 fixture 数量。运行 `measure-catalog.mjs HTTPS_ORIGIN NETWORK_LABEL PRIVATE_OUTPUT.json` 以 20 并发执行 100 次目录读取；验收服务端 metadata p95 ≤500ms、首屏 p95 ≤2s，明确客户端网络和地区。工具 HTTP 计时不替代浏览器首屏渲染证据，须另行核对实际页面。

真实用户与创作者研究需知情参与者，未完成时单独标记未验证，不用自动化代替。

隔离读取性能演练可用 `catalog-load-fixture.mjs OUTPUT.sql --metadata-only --start=1 --count=100` 先校准，再按明确的 `--start` / `--count` 分批加载。该模式保留生产目录表的全部列、主键、唯一索引和排序索引，只省略发布写入的外键依赖；每包仍保存完整正式样本 manifest。它验证目录读取，不代表真实发布 10000 次。必须先读取账号当日 D1 实际共享用量，每批检查 `rows_written` / `rows_read`，为生产至少预留 20000 次写入和 1000000 次读取；余量不明或不足立即停止。完整生产 SQL 的隔离云恢复另外验证，不得以这个夹具代替。
