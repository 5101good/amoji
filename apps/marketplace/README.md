# Amoji 市场账号服务

[English](README.en.md)

Cloudflare Workers / Static Assets + D1，内嵌 Better Auth。此包提供首期账号页面与 API；完整市场仍由后续模块提供。

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

对外只暴露 `/v1/auth/csrf`、`register`、`login`、`logout` 与 `/v1/me`。浏览器不接收脚本可读 session token；没有管理员注册端点。cookie 最长 12 小时、不自动刷新。CSRF token 有效 5 分钟，同时检查精确 Origin。

D1 原子限流：注册每 IP 5 次 / 15 分钟、登录每 IP 20 次 / 15 分钟、同一邮箱每操作 10 次 / 15 分钟；使用服务器 HMAC 保护标识，定时删除过期计数。生产只信任 Cloudflare 提供的 `CF-Connecting-IP`，拒绝缺失边缘来源上下文的认证写请求。请求体最大 8 KiB。
