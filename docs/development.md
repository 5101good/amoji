# 开发与验证

[English](development.en.md) · [文档首页](README.md)

使用 Node.js >=24，从仓库根目录执行：

```sh
npm ci
npm run typecheck
npm test
npm run test:dsh
```

| 命令 | 范围 |
| --- | --- |
| `npm run typecheck` | TypeScript 静态检查 |
| `npm test` | 核心及非 dsh 自动化测试；不包含 `dsh-*.test.ts` |
| `npm run build` | 编译 TypeScript 到 `dist/` |
| `npm run build:dsh` | 构建 Host、浏览器包、资产和本次依赖许可清单 |
| `npm run prepare:dsh` | 核对锁定的本地 dsh npm 合同 |
| `npm run test:dsh` | 构建、合同准备及全部 dsh 自动化测试 |
| `npm run test:file -- tests/<name>.test.ts` | 单个测试；dsh 相关测试先构建并准备合同 |

dsh 公开包基线在 `scripts/dsh/baseline.json`，完整依赖在锁文件。Client 通过宿主模块加载器装载，React 由宿主提供。Host 提供的服务不能通过额外安装一个独立副本来替代。

## 目录

- `src/`：共享服务、SQLite 库、协议、包和媒体校验。
- `src/dsh/`：Host、Client、选择器、管理页、AI 建议。
- `assets/base-library/`：可审阅清单、生成来源、双画风基础包与 CC0。
- `adapters/dsh/`：插件入口、元数据及构建产物。
- `tests/`：行为回归、合同、打包、隔离和资源预算检查。
- `docs/`：当前中英指南、发布审计与运行时 Schema。

`dist/`、`.cache/`、构建生成的 runtime/client 等由脚本产生；修改来源代码后重建，不手工修补生成 bundle。用 `AMOJI_DATA_DIR` 隔离运行数据，不在日常库上试验迁移。

## 什么才算验证通过

自动化测试证明其断言覆盖的行为。发布前还应对最终 tgz 执行实际 profile 安装、插件激活、选择器显示、用户发送、AI direct tool 展示、创建预览确认、包导入导出和重连检查。若变更涉及 UI，检查中英界面和窄屏；若涉及模型，记录真正请求的输入边界、返回和错误，不用 mock 冒充真实调用。

真实模型请求可能产生费用，应使用明确选定的验证模型和专用会话，记录次数及所验证的路径。不要修改全局模型来掩盖提供方兼容问题。普通测试不要求凭据；legacy 实测探针 `scripts/probes/` 可能使用宿主登录状态与真实模型，仅在理解其影响后显式执行。

## 构建分发包

```sh
npm run build:dsh
mkdir -p .local/release
npm pack ./adapters/dsh --ignore-scripts --pack-destination .local/release
```

包应包含 Host/Client、核心 runtime、基础资产、`BUILD.json`、`LICENSE`、`NOTICE`、`THIRD_PARTY.json` 和 `THIRD_PARTY_LICENSES/`。不包含个人库、凭据、`node_modules` 或原生二进制。第三方清单反映构建机器实际解析结果，不保证其他平台安装依赖完全相同。

见[贡献指南](../CONTRIBUTING.md)和[发布流程](release.md)。
