# Amoji 市场账号服务

[English](README.en.md)

Cloudflare Workers / Static Assets + D1，内嵌 Better Auth。此包提供账号、可信上传和创作者投稿页面与 API；公开发现与审核由独立模块提供。

## 本地运行

Node.js 24 或更高版本：

```sh
npm ci
node -e 'require("fs").writeFileSync(".dev.vars", "BETTER_AUTH_SECRET="+require("crypto").randomBytes(32).toString("hex")+"\n", {mode:0o600})'
npm run build
npx wrangler d1 migrations apply amoji-marketplace --local
npm run dev
```

打开 `http://localhost:8787`。仅本地配置开启 `LOCAL_TEST`，线上严禁开启。账号没有邮件确认或邮件找回；邮箱不是所有权证明。

## 验证

`npm run typecheck && npm test && npm run build` 使用锁定 workerd 的真实 D1 binding。测试覆盖安全 cookie、登录/退出/停用、请求预算、共享限流和隔离审核事务样例。样例入口 `test/transaction-probe.ts` 不进入生产 bundle，不能对公众部署。

本地测试不证明云端免费 CPU 额度、内存或延迟满足生产要求。密码使用 Better Auth 默认 scrypt，不配置弱化参数。

## 部署

部署前提供自己的 D1 database ID、production origin，使用 `wrangler secret put BETTER_AUTH_SECRET --env production` 设置随机秘密，先向明确选定的数据库应用迁移，再执行 `npm run deploy`。配置中的占位 ID 刻意不能部署。production 不继承本地测试开关。服务商权限或额度不足时停止，不自动升级付费。D1 认证读写不启用 read replicas。

认证仅暴露 `/v1/auth/csrf`、`register`、`login`、`logout` 与 `/v1/me`。浏览器不接收脚本可读 session token；没有管理员注册端点。cookie 最长 12 小时、不自动刷新。CSRF token 有效 5 分钟，同时检查精确 Origin。

D1 原子限流：注册每 IP 5 次 / 15 分钟、登录每 IP 20 次 / 15 分钟、同一邮箱每操作 10 次 / 15 分钟；使用服务器 HMAC 保护标识，定时删除过期计数。生产只信任 Cloudflare 提供的 `CF-Connecting-IP`，拒绝缺失边缘来源上下文的认证写请求。请求体最大 8 KiB。

## 免费 DO 与私有 R2 直传

上传使用三段公开 HTTP：`POST /v1/uploads {pack_id?}` 预留服务端身份；客户端构造最终 0.2 manifest 后，`POST /v1/uploads/:id/authorize {length,sha256}` 签发最长 300 秒的精确 staging PUT；`POST /v1/uploads/:id/complete {}` 冻结并完成可信验证。所有写入带会话、Origin、CSRF 和 UUID `Idempotency-Key`；GET 可查恢复状态。授权与完成各自保存独立操作 key，重试需复用；首次变更需发送 GET 返回的 `row_version` 为 `If-Match: "版本"`，过期版本返回412。客户端遇到已过期预留时创建新操作，允许重新选择同一文件。浏览器直接 PUT R2，普通 Worker 不接收包主体。新发布快照保留表达 identity/固定语义和原素材；本地 0.1 的原有限额未修改。

SQLite DO `FreeRuntime` 通过私有 binding 执行完整认证与上传控制 API，单实例串行处理，最多排队 8 个请求。普通 Worker 仅转发请求和静态资源；可信边缘 IP 标记由入口覆盖，客户端无法伪造。CSRF、会话、签名和验证计算都在 DO 内，嵌套计算不递归 RPC。scrypt 保留 Better Auth 1.7.5 的 N16384/r16/p1/dkLen64、NFKC、32位hex盐字符串格式，验证采用常数时间比较。DO不保存密码。D1会话与账号停用逻辑沿用账号服务。每天应用最多 2000 次密码计算、128 次验证、128 次预留、256 次签发；每owner最多3个未完成上传；未回收上传最多100条、已预留存储1 GiB。这些是应用保守阈值，并不代表Cloudflare账户的剩余额度，也不能限制预签名URL被攻击者重放的全部S3尝试。

归档最多10 MiB、展开16 MiB、manifest512 KiB、256条目；仅manifest和SHA命名素材。每素材1 MiB/1024边/60帧/10秒/800万累计像素。ZIP解压检查中央目录、本地头、描述符、路径、重叠、实际长度、CRC；Rust WASM全量解码PNG/JPEG/GIF/WebP，GIF另检查完整子块与终止位置。WASM没有imports，最大线性内存64 MiB，单个解码分配24 MiB；线性内存不是整个isolate的峰值内存。DO默认平台CPU预算为每请求30秒；预算终止或I/O故障保留可重试状态，不改为客户端自证。

冻结对象写入客户端不可签名的 `sealed/`，条件写防覆盖；实际字节SHA与预留一致才验证。校验后公开/审核必须引用sealed对象与manifest digest，禁止引用staging。15分钟清理任务先CAS过期再删除；有效引用阻止过期。签名到期取5分钟与上传剩余期限的较小值，不跨越清理期限；剩余不足1秒时拒绝签发，避免删除后重放复生。操作记录至少保存7天（当前保留，不自动删除）；清理D1失败后可重入。

部署前运行根依赖安装及本目录 `npm ci`、`npm test`、`npm run typecheck`、`npm run build`。`wrangler.jsonc` 用SQLite迁移，不启用Paid/Containers，上传默认 `UPLOAD_ENABLED=false`。需真实账户Free确认、共享用量检查、bucket限定R2 S3 Object Read & Write凭据、私有桶和实际Origin CORS后才启用。服务端配置 `R2_ACCOUNT_ID`、`R2_BUCKET`；`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`须secret bindings。不要将secret、预签名URL或密码打印日志。`r2-cors.json` 针对当前验收站点；Origin改变须同步精确替换，不能用 `*`；`web/_headers` 的 CSP connect-src 同样需精确指向自己的 R2 account endpoint。

真实部署必须分别验证旧账号、DO计量、实际S3的签名长度/类型/篡改/过期/竞态/回收、最大包和真实浏览器上传。本地workerd与R2 binding fixture不证明S3签名或浏览器CORS，也不证明当前套餐与整isolate内存。禁止因S3凭据未配置或validator不可用而声称上传完成。清理临时验收对象，保留正式资源。

## 创作者投稿

登录后选择一个包，在设备本地确认说明、各项许可和可选动作，再上传到 R2。默认中文，可切换英文。所有图文、原始语义语言、完整动作/config、示例和来源均能预览；完整 manifest 可展开核对。上传校验通过后，显式确认分发权才进入待审，审核公开由独立审核流程完成。

草稿的所选文件、编辑内容和操作 ID 以账号分区保存在本机 IndexedDB；不保存密码、会话或上传签名。恢复按钮先核对 operation/上传状态；过期上传需返回编辑并重新上传。仅上传所选包，不读取 dsh 会话或整库。编辑表达/动作许可会产生新 identity 并保留来源；未修改内容保留精确版本。旧本地 AI 建议及模型选择不受影响。

当前投稿支持 `CC0-1.0`、`CC-BY-4.0`、`CC-BY-SA-4.0`，每项需要创作者署名，衍生包需要来源声明。未知或不支持公开分发的许可拒绝，不自动改成 CC0。声明与审核不能替代真实权利人授权。

- `GET /v1/uploads/:id/preview`、`/media/:sha256`：仅当前 owner，读取可信冻结对象并核对摘要；素材返回正确 MIME、no-store、nosniff。
- `POST /v1/submissions {upload_id,rights_confirmed:true}`：需要上传的 `If-Match`，原子写入不可变内容、引用和幂等结果。
- `GET /v1/me/submissions`、`/:id`：本人状态/理由；默认20条、最多50条，使用响应的游标继续。
- `POST /v1/submissions/:id/withdraw {}`：仅 owner 的 pending，携带投稿 `If-Match`。
- `GET /v1/operations/:operation`：本人投稿/撤回结果对账。操作 UUID 保留至少7天（目前不自动删除），重放无额外队列副作用，同键异内容409，过期版本412。

每账号最多10待审，每UTC日10新投稿；撤回不恢复当日额度。投稿与上传控制分别限制30写请求/15分钟。D1 trigger在事务中复核上传有效性、账号停用、归属和额度；内容identity冲突回滚整个提交。withdraw不删除已提交快照，后续修订重新预留release和递增版本。部署须按顺序应用新增0005迁移，然后更新Worker和静态资源。
