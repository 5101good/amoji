# Amoji Studio

[Amoji 协议 0.1](../../docs/specs/amoji-0.1-rfc.md) 的表情包创作 skill。它让 AI 把一个想法，例如“一套写代码时用的瞌睡水獭”，做成通过校验的整套 `.amoji` 制品。

整个流程分五步：
1. 规划码位；
2. 撰写多语言固定语义；
3. 指导出图；
4. 打包、校验；
5. 生成预览图。

## 内容

| 路径 | 作用 |
| --- | --- |
| `skills/amoji-pack/SKILL.md` | 创作流程与硬性规则 |
| `skills/amoji-pack/references/protocol-core.md` | 作者需要的协议核心规格：字段、上限、国际化 |
| `skills/amoji-pack/references/registry.json` | 码位注册表，由 `scripts/build-act-registry.mjs` 从 RFC 附录 A 生成，请勿手改 |
| `skills/amoji-pack/references/semantics-guide.md` | 如何为每个码位写语义，含推荐套装和示例 |
| `skills/amoji-pack/references/art-direction.md` | 出图提示模板、动作表现、文化与版权注意事项 |
| `skills/amoji-pack/scripts/amoji_pack.py` | `acts` / `init` / `build` / `check` / `preview` 命令行工具 |

## 要求

- **运行环境**：Python 3.9+ 与 Pillow（`python3 -m pip install pillow`）。
- **出图**：skill 本身不绑定任何图像生成服务。宿主有出图工具时 AI 直接使用；没有时，它会给出提示词和文件名，由用户自备图片。

## 安装

- **Claude Code**：把本目录作为插件安装。
- **其他支持 Agent Skills 的环境**：直接复制 `skills/amoji-pack` 目录即可。

## 维护

修改 RFC 附录 A 的码位表后，运行下面的命令，同步 `docs/specs/amoji-0.1.registry.json` 和本 skill 的注册表副本：

```sh
node scripts/build-act-registry.mjs
```

`npm test` 会检查两份副本与 RFC 是否一致，并端到端运行一次打包与校验。

---

**English.** An agent skill that turns an idea into a validated Amoji 0.1 expression pack. It plans the acts, writes multilingual semantics, directs the art, then builds, checks and previews the `.amoji` file. It needs Python 3.9+ with Pillow. Install the directory as a Claude Code plugin, or copy `skills/amoji-pack` into any Agent Skills–compatible environment. After editing Appendix A of the RFC, regenerate the registry copies with `node scripts/build-act-registry.mjs`.
