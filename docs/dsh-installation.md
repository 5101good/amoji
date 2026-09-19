# dsh 安装、升级和恢复

候选版本 Amoji 0.1.0-dev.1，已固定 dsh 0.1.5-rc.2 的公开合同；Node >=24，当前实际构建环境 Node24.19/macOS arm64。其他操作系统与新版dsh待验，不承诺兼容范围外版本。三个模型工具仅文字；原生AI图使用direct tools，Code Dispatch/PTC嵌套meta不保证展示。

## 从源码准备本地候选

```sh
npm ci
npm run typecheck
npm test
npm run test:dsh
mkdir -p .local/release-candidate
npm pack ./adapters/dsh --ignore-scripts --pack-destination .local/release-candidate
```

`test:dsh`含build和固定npm合同准备。`package-lock.json`固定源码构建树，插件直接依赖固定版本；宿主profile的pnpm-lock.yaml记录其实际安装依赖，应保留该锁文件。构建生成真实Client模块清单、当前平台生产/原生依赖版本与许可；npm tarball不内嵌node_modules。安装机器应核对其实际解析依赖与候选 `THIRD_PARTY.json`，不同平台不能套用macOS arm64检查。产物路径应使用唯一目录避免file缓存，核对SHA256后再安装。

## 安装和激活

以下 `amoji-qa` 是可自行命名的独立profile；已安装同版本dsh时可用 `dsh` 替代固定版本npx入口。

```sh
npx @deepseek-ai/dsh@0.1.5-rc.2 plugin --profile amoji-qa add /绝对唯一目录/amoji-dsh-0.1.0-dev.1.tgz --ignore-scripts
npx @deepseek-ai/dsh@0.1.5-rc.2 --profile amoji-qa --port 65501 --no-open
```

官方plugin命令代理pnpm，add已实际成功；安装exit0不代表运行中Host已激活。启动后选工作区，输入区“表情”打开24项基础库，新Session无需先发送普通文字。不需要改默认模型。隔离QA可仅对启动命令设置 `AMOJI_DATA_DIR=/独立目录`；普通运行默认共享库为 `~/Library/Application Support/Amoji/prototype`。不要把QA目录当作日常默认库。

## 升级、卸载和重装

升级前保存草稿、让当前会话完成并退出要升级的profile；保留共享数据目录和宿主profile持久会话/锁文件。使用新唯一路径的tgz再次执行同一add命令，重启该profile。移除命令是：

```sh
npx @deepseek-ai/dsh@0.1.5-rc.2 plugin --profile amoji-qa remove @amoji/dsh
```

remove/重装的完整真实生命周期由[验收表](validation/dsh-release-acceptance.md)跟踪。插件清理只关闭自身连接，不删除共享库，不主动停止其他客户端。切勿删除数据目录、`library.sqlite`、`blobs`、旧消息或profile会话来“重装”。最后一个连接离开后核心默认空闲60秒退出；其他客户端仍连接则继续运行。重新add同一候选并重启profile后原资产和历史应保留，需实际核对。

本版本要求API2、数据库4、`dsh-native-delivery-v1`、`library-management-v1`、`packs-v1`及`dsh-reliable-delivery-v1`。若旧Codex或其他端仍使用缺少能力的核心，dsh明确拒绝。先确认全部相关客户端/会话闲置、退出旧核心的所有使用端，再等待核心自然退出或由有权限维护者按正确serviceId执行管理stop；stop在仍有连接时拒绝。不要按历史PID kill、强开第二个writer或降级数据库。用户授权“忽略其他端”不等于可以强制更新或关闭它们。

## 连接和投递恢复

选择器“重新连接并核对”恢复当前共享库，旧连接绑定作废；管理窗口“重新连接共享库”保留当前输入。操作不会自动重发，原会话与原请求保持不变。已发送条目用“核对投递状态”读对应native rpcId；响应丢失时保留同一选择，再点原发送操作使用同一requestId核对。不要改选后另发来处理unknown。

accepted仅表示宿主接纳并flush；observed表示对应用户消息已观察到；unknown表示无法确认，应检查原会话。rendered只来自匹配图片load，图片失败回退固定文字。页面重载前保存草稿；重载不会保留未保存的内存输入。版本不兼容时连接恢复按钮不会绕过能力检查或自动迁回旧DB。

特定llm-ai-web网关的已验证低成本Flash配置选择见[D1记录](validation/dsh-native-2026-09-19.md)：openai-completions，compat中 `thinkingFormat: deepseek`、`maxTokensField: max_tokens`、`supportsDeveloperRole: false`、`supportsStore: false`、`requiresReasoningContentOnAssistantMessages: true`，模型 `reasoningEfforts: {off: none, low: low}` 并使用off。这仅描述该网关成功路径；Amoji不写模型配置、凭据或修改原默认gpt-reserve。

## 许可与候选范围

代码和技术文档MIT；24项基础视觉、语义和提示CC0-1.0。来源、生成提示及非保证说明在assets/base-library/provenance.json和README。用户个人库默认私有，不会随源码或包导出而公开。`LICENSE`、`NOTICE`、`THIRD_PARTY.json`、`THIRD_PARTY_LICENSES/`随当前dsh包提供；Sharp/libvips实际macOS依赖明确记录各自许可，并未把原生动态库称作MIT。

源码、协议、基础包和dsh tgz仅为本地分发候选；无remote/push/外部项目创建。Codex和Claude Code保留现有实现，但新增适配与真机验收暂停。最终bbcd0cc候选已在隔离QA及日常web实际安装；六分钟空闲、核心重连、卸载重装、双会话版本隔离、30组模型对照及定点修补复验均已有分层证据。剩余真实浏览器及其他未观察路径仍见验收表，不把公共合同结果冒充UI通过。
