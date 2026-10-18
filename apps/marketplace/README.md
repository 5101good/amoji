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

## 网页入口与界面验证

- **发现表情** `/`：真实图片封面、关键词和组合筛选；筛选保存在 URL 中，可分享并通过浏览器后退恢复。首页服务端直接输出公开摘要，匿名浏览不加载创作归档工具。
- **场景包详情** `/packs/:pack/releases/:release`：切换经典/办公等包内画风、放大图片、阅读固定语义、下载精确版本和复制 dsh 包 ID。选择画风不会修改语义，安装不会自动启用动作。
- **创作工作台** `/?view=studio`：选择内容 → 说明与许可 → 可选动作 → 预览投稿。草稿保存在当前设备，上传中断可恢复；投稿后由审核者公开。
- **内容审核** `/?view=review` 仅审核者和管理员可用；**账号与内容管理** `/?view=account` 集中管理内容、举报、角色及账号删除。设备配对有独立确认页。

界面默认中文，可切换英文并记住选择。切换界面语言不会翻译或改写创作者的固定语义。布局适应手机和平板，支持键盘焦点、对话框 Escape 关闭与回焦、减少动画偏好。首屏主视觉以仓库 CC0 基础表情为参考生成，来源与许可见 [品牌素材说明](web/art/README.md)；示例表情来自基础表情库，品牌图来自 `assets/brand/amoji-logo.png`。图片使用优化后的 WebP，无第三方字体或图片服务。

首页的交互展台并排呈现表情图片与固定含义；点击示例只切换本地展示，不发送消息或调用模型。示例文字逐字取自仓库的中文/英文预置定义，界面语言切换时选择对应语言的独立示例。账号页把身份信息、内容管理、举报、角色和删除选项分区呈现。

本地浏览器回归（先在仓库根目录和本目录安装锁定依赖）：

```sh
npm run build
npx playwright install chromium
npm run test:ui
# 使用本机已有 Edge 时：
PLAYWRIGHT_CHANNEL=msedge npm run test:ui
```

测试自动启动仅绑定本机的隔离服务。`4173` 使用状态样例检查空态、错误、双语、角色、焦点与响应式；`4174` 使用真实本地 workerd、D1、R2 完成上传、可信验证、投稿、批准与公开下载，只有 S3 网络直传使用模拟。浏览器测试还运行 axe 无障碍规则。截图保存在 `.cache/design`，失败 trace 在 `.cache/browser-results`，均不提交；测试入口不进入生产包。以上不替代云端 S3、免费额度、性能或真实 dsh 验收。

## 部署

部署前提供自己的 D1 database ID、production origin，使用 `wrangler secret put BETTER_AUTH_SECRET --env production` 设置随机秘密，先向明确选定的数据库应用迁移，再执行 `npm run deploy`。production 已配置真实资源 ID，每次远程操作前核对目标，并保留既有 secrets。production 不继承本地测试开关。服务商权限或额度不足时停止，不自动升级付费。D1 认证读写不启用 read replicas。

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

私有冻结包读取（预览、素材与投稿校验）统一受 D1 共享计数约束：每账号每日1024次、应用每日4096次，达到阈值在 R2 GET 前返回429；计数可审计，不能视为账户实际剩余额度。

## 审核与公开发现

部署按序新增 `0006-review-publish.sql`。首个审核者由部署者通过私有 D1 管理凭据初始化：先核对注册账号对应的不可变 `market_account.id`，运行 `node scripts/bootstrap-reviewer.mjs ACCOUNT_UUID OPERATOR REASON` 生成参数化请求，再私下执行输出。唯一初始化记录永久保留操作者、理由、账号与时间，并原子授予 admin（可审核）。已有 admin/reviewer 时拒绝再次初始化；无公开自升权接口。后续角色运营管理属于单独功能。

审核工作台仅 admin/reviewer 可见；本人投稿禁止自审。查看已验证精确图文、许可、动作与上一公开版字段差异后，填写理由批准或退回。决定携带 `If-Match` 和 UUID 操作键；权限、owner、valid digest、pending 状态与 row version 在 D1 batch 内重新核验。状态更新、公开指针、审计、幂等结果原子提交；零行 CAS 不产生后续写，错误对外不显示 SQL。断连后可核对并安全重放原操作，操作记录至少保留七天。

匿名首页支持中文关键词、场景、语义语言、画风和有无动作筛选。`GET /v1/packs` 默认20、最多50条，以更新时间与稳定包 ID 游标分页。公开分享页路径 `/packs/:pack/releases/:release` 展示完整精确内容、许可、示例、作用域和宿主说明。包 ID 可回到 dsh 市场搜索。新待审版本不覆盖旧公开内容；每个批准版本保持独立精确下载。`archive` 响应提供 SHA-256、长度和 ETag；媒体和归档每次检查发布状态、引用与真实字节摘要，R2 无永久公共链接。公开读同样消耗共享冻结对象读取额度。下架版本返回410，待审直链返回404。

`test/reviews.test.mjs` 通过真实本地 workerd D1/R2 binding 覆盖四actor、退回修订、CAS/回滚/幂等、私有隔离及摘要一致。云端四actor浏览器、实际R2 S3和云D1故障证据需单独实测，不能由本地测试推定。

公开封面使用独立 `/cover` 路径。运行时只缓存校验后的图片字节（上限 8 MiB / 64 项，单项 1 MiB），每次命中仍检查发布状态。命中不读取整包或消耗 `sealed_reads`；冷读、淘汰和进程重启后仍受原额度与重任务队列限制。缓存不新增云端对象，浏览器响应保持 `no-store`，下架立即生效。

匿名公开读取统一按受信边缘 IP 限制每分钟120次，429附Retry-After；分享详情由 Static Assets 的 single-page-application fallback 支持直接访问。

设备授权使用新增迁移 `0007-device-authorizations.sql`，部署时先迁移再更新 Worker。dsh 配对由已登录网页显式确认；网页不接收设备 access/refresh token。Host 创建和领取接口拒绝浏览器 Origin/Cookie，审核接口拒绝设备 token。只存 SHA-256 凭据摘要；5 分钟配对、15 分钟 access、30 天旋转 refresh，重用 refresh 撤销 family。网页注销撤销本人全部设备与未领取授权。使用相同私有 D1、SQLite DO 和既有 R2 直传链路。

## 初始内容发布

[三套正式内容包](../../assets/scenario-packs/README.md)在仓库中提供完整0.2和纯表达0.1。使用独立、持久保留的创作者账号逐包投稿，由另一审核账号决定；不要删除正式内容作者，否则公开内容会下架。仓库构建不等于云端发布。动作不是强制控制，用户关闭后停止后续应用但历史保留。部署后分别记录匿名获取、真实dsh安装/发送、动作事件和模型完整回合，不能用一层证据替代另一层。

## 正式部署与恢复

正式来源为 `https://amoji.ai-web.ai`；production 已绑定现有 `amoji-auth-v0` Worker/D1。部署前核对实际资源，保留现有 secrets 和迁移记录。只读目录 metadata 有独立的 64 并发上限，不占用 8 个重计算排队名额；每 IP 请求限额继续生效。备份使用独立 DO 和私有 R2，由定时任务调用官方 D1 export，需经运营者明确批准的专用账号级 D1 Write token；D1 Read 实测不足以导出。完整的权限范围、停写、健康检查、备份恢复、费用与回退流程见[运营说明](../../docs/marketplace-operations.md)。
