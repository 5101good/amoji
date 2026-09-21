# Amoji

[中文](README.md) · [Documentation](docs/README.en.md) · [Installation](docs/dsh-installation.en.md)

**Expressions for people and AI. People see artwork; AI reads fixed meaning.**

Amoji adds a native expression picker, two-way message rendering, and a personal expression library to dsh. Each expression has an explicit meaning, tone, usage guidance, and text fallback. Models search and select through text without image recognition.

- **Two-way expression:** click to send; AI uses `amoji_search`, `amoji_resolve`, and `amoji_emit` with the same fixed semantics.
- **Two appearances:** Classic and Office cover the same 24 meanings, totaling 48 assets. Switching appearances preserves old messages.
- **Create your own:** upload artwork and enter semantics, or describe your intent in one field for AI text suggestions. Choose a model, defaulting to the current conversation model. Adopt, edit, save, and confirm a loaded preview before publishing to your library.
- **Local management:** drafts, revisions, archiving, personal copies, complete `.amoji` import/export, and AI expression preferences.
- **Chinese and English UI:** follows the dsh interface language. UI translation does not rewrite stored semantics; built-in meanings are currently Chinese.

<p align="center"><img src="assets/samples/source/celebrate.png" alt="Amoji Classic character celebrating together" width="160" /></p>

## Install

1. Use **Node.js 24 or newer**. The verified baseline is **dsh 0.1.5-rc.2 on macOS arm64**.
2. Download `amoji-dsh-1.0.0.tgz` from [GitHub Releases](https://github.com/5101good/amoji/releases) and check its SHA-256 against `SHA256SUMS` from the same release.
3. Install into your dsh profile, restart that profile, select a workspace, and open Expressions in the composer.

```sh
npx @deepseek-ai/dsh@0.1.5-rc.2 plugin --profile amoji add ./amoji-dsh-1.0.0.tgz --ignore-scripts
npx @deepseek-ai/dsh@0.1.5-rc.2 --profile amoji
```

`amoji` is an example profile name; substitute your existing profile if appropriate. For source installation, follow the [build steps](docs/dsh-installation.en.md). Successful installation alone does not prove runtime activation.

## Use

Search and click an expression to send it, or use its details button to read the fixed meaning first. Open Manage expressions to change appearance, AI tone and frequency, and personal content. AI expressions can be paused independently.

When creating an expression, describe the sender, recipient, situation, intended meaning, and tone, then select a model and generate a suggestion. Only your text intent and generation instructions go to that model, without artwork or conversation history. Provider charges follow your host model configuration. Manual entry is also available. Suggestions never automatically save or enter the library.

The [user guide](docs/usage.en.md) covers draft confirmation, revisions, import/export, reconnection, and delivery states.

## Verification and limits

Version 1.0 primarily supports dsh. Existing evidence includes local installation and browser use on macOS arm64, plus one successful live Flash text-suggestion request. This does not establish support for every model, platform, or host version. In one AI expression test, the expression was displayed successfully but the provider's tool continuation returned HTTP 400 over `reasoning_text` compatibility; the whole model turn was not successful.

Linux, Windows, and other dsh versions have not completed live host acceptance. Images are not guaranteed for nested Code Dispatch / PTC tools. Codex and Claude Code implementations remain legacy and are outside the 1.0 live-validation and compatibility scope. See [release scope and known limitations](docs/release.en.md).

## Develop and contribute

```sh
npm ci
npm run typecheck
npm test
npm run test:dsh
```

`test:dsh` builds the plugin and checks pinned dsh npm contracts. Output is written to `adapters/dsh`. Read [development](docs/development.en.md), [architecture and protocol](docs/architecture.en.md), [contributing](CONTRIBUTING.en.md), and [security](SECURITY.en.md).

Code and technical documentation use [MIT](LICENSE). Built-in artwork, fixed semantics, and generation prompts use [CC0-1.0](assets/base-library/LICENSE); see [asset provenance](assets/base-library/README.en.md). Third-party dependencies and user content retain their own licenses; see [NOTICE](NOTICE).
