# Amoji

[中文](README.md) · [Get started](#install) · [Documentation](docs/README.en.md) · [Download 1.0](https://github.com/5101good/amoji/releases/tag/v1.0.0)

**Working with AI needs room for expression.**

AI-native expressions: people see the artwork; AI reads its fixed meaning. A shared way to express gratitude, uncertainty, encouragement, and care.

<p align="center">
  <img src="assets/samples/source/celebrate.png" alt="Celebrating together" width="140" />
  <img src="assets/samples/source/wry.png" alt="A sheepish smile" width="140" />
  <img src="assets/samples/encourage-poster.png" alt="Cheering you on" width="140" />
</p>

## Why we are building this

In human conversation, an expression can make gratitude warmer, confusion easier to admit, and a reminder less abrupt. As AI becomes part of everyday work, those needs remain. We still want to say “I don't understand” without friction, celebrate progress together, and have our effort acknowledged with a thoughtful “You've worked hard.”

**We believe emotional expression is a basic need in human–AI collaboration. It should remain available whether a model supports images or visual inference is affordable.**

Amoji makes that possible through text. You express a feeling or intention with an image; AI reads the meaning attached to it. AI can also choose an appropriate expression in return. Understanding what an expression means can follow a text-only path.

## What makes an expression AI-native?

One expression supports two ways of reading it:

| Reader | What they receive | What it helps them do |
| --- | --- | --- |
| People | Artwork, gestures, and facial expressions | Feel the tone and express themselves quickly |
| AI | Explicit meaning, tone, and guidance on when to use or avoid it | Understand intent and choose an appropriate response |

Traditional stickers primarily rely on a viewer interpreting the picture. Amoji adds an **explicit, directly readable meaning** alongside the artwork. A character scratching its head might convey confusion, self-deprecation, or embarrassment; its creator can specify which meaning this expression carries.

Users can write that meaning themselves or ask AI for a suggestion, then edit, review, and confirm it. A confirmed revision keeps its semantics fixed, and past messages retain the revision that was sent. The model does not need to infer the meaning from pixels each time, and it cannot rewrite a sent expression's meaning on the fly.

## What it looks like in collaboration

| Moment | Expression | Intended meaning |
| --- | --- | --- |
| An explanation is too complicated | You → AI: I don't understand | Please explain it more simply; we have not reached a shared understanding yet. |
| AI's help was useful | You → AI: Thank you | Your help made a difference, and I want to acknowledge it. |
| You have just thanked AI | AI → you: You're welcome | I hear your thanks. Glad I could help. |
| The evidence is still insufficient | AI → you: I'm not sure yet | There is not enough evidence for a confident judgment; the uncertainty needs explaining. |
| You have put substantial effort into something | AI → you: You've worked hard | I recognize the time and effort you have invested. |

An expression can accompany an explanation or result, making the tone clearer. You can choose the more restrained Office artwork, adjust how often AI uses expressions, or pause AI expression replies.

## What this makes possible

- **Participation from text-only models.** The information needed to understand an expression arrives as text, without requiring vision capability for that image.
- **No visual inference just to read the expression.** Models can search and read concise semantics instead. Normal text inference and tool-call costs still apply.
- **Meaning you can inspect.** You can see what AI will read and define the tone and usage boundaries, reducing the need to guess what the same picture means to each side.
- **Expression in both directions.** People can convey feedback and emotion; AI can acknowledge thanks, express uncertainty, or offer encouragement with an appropriate expression.
- **A vocabulary you define.** Create your own, import artwork, confirm its meaning, and share it through `.amoji` files. Build an expression library that feels like yours.

## Starting with dsh

Our vision is an expression system that can travel across models and clients. **Version 1.0 starts with native dsh integration**, bringing selection, sending, interpretation, and library management into one workflow:

- **Native expressions in both directions:** click to send from the composer; AI searches and chooses through text tools. Images appear directly in the conversation.
- **Classic and Office artwork:** the same 24 meanings across 48 assets, covering both human-to-AI expression and AI replies.
- **One field to start creating:** describe your intent and choose a host model for wording suggestions, defaulting to the current conversation model. You adopt, edit, and confirm the result.
- **A local personal library:** drafts, revisions, archiving, personal copies, complete pack import/export, and AI usage preferences.
- **Chinese and English UI:** follows dsh's language setting without rewriting stored expression semantics. Built-in meanings are currently Chinese; the examples above explain them in English.

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

## Help shape this vocabulary

Through an open format and an open-source implementation, we want more people to help define expression in the age of AI. That expression can be warm or playful, serious or restrained. Share a need from your own collaboration, create new artwork and meanings, or help improve the interaction and host integrations.

Start by [trying Amoji](#install), [sharing an idea](https://github.com/5101good/amoji/issues), or [contributing code and assets](CONTRIBUTING.en.md).

## Develop

```sh
npm ci
npm run typecheck
npm test
npm run test:dsh
```

`test:dsh` builds the plugin and checks pinned dsh npm contracts. Output is written to `adapters/dsh`. Read [development](docs/development.en.md), [architecture and protocol](docs/architecture.en.md), [contributing](CONTRIBUTING.en.md), and [security](SECURITY.en.md).

Code and technical documentation use [MIT](LICENSE). Built-in artwork, fixed semantics, and generation prompts use [CC0-1.0](assets/base-library/LICENSE); see [asset provenance](assets/base-library/README.en.md). Third-party dependencies and user content retain their own licenses; see [NOTICE](NOTICE).
