# Amoji · Claude Desktop Mods

[中文](README.md) · [Open-source project](https://github.com/5101good/amoji)

People see artwork; AI reads fixed meanings. Native expressions, two-way visual messages, a personal library and assisted creation in **local sessions of Claude Desktop’s Code tab**.

Requires Claude Code with Mods (validation baseline: 2.1.295+) and Node.js 24+. This adapter does not target ordinary Chat, Cowork or cloud sessions. The terminal has a text fallback; Desktop is the visual target.

## Install

This source adapter has not shipped in v1.0.0. Build this branch, or download `amoji-claude-mods-<version>.zip` when available in a later GitHub Release. Extract the complete `.claude-plugin/` and `plugin/` directories.

From the extracted directory:

```sh
npm ci --prefix ./plugin/runtime --omit=dev --ignore-scripts
claude plugin marketplace add .
```

Then, from the project where you want Amoji:

```sh
claude plugin install amoji@amoji-desktop --scope local
```

Start a new Code session or follow the host’s `/reload-plugins` notice. On first startup, Desktop may show an unrecognized-command notice before loading the plugin; use its native entry once available instead of repeatedly sending the command. Open the `☺ Amoji` button above the composer or run `/amoji`. Disable any older Claude prototype named `amoji` first to avoid command/tool conflicts.

The portable ZIP excludes node_modules and native binaries; locked dependencies are fetched from npm. CLI and local Desktop sessions share plugin settings. Local scope keeps the installation limited to this project.

## Use

- **Expressions:** search by name or meaning, pressing Enter to update. Click an expression name to send immediately. Open Meaning to inspect the fixed semantics.
- **Library:** archive/restore, create revisions of personal entries, copy built-ins, or choose imported revisions. Past messages retain the exact image and meaning that were sent.
- **Create:** describe an intention in one field. Suggestions default to the conversation model; choose an alias or custom model ID. Only that intent is sent, with no images or chat history. Adopt, edit and review the suggestion, or fill the fields manually.
- **Images and packs:** paste an absolute local path (`~/` is supported). PNG, JPEG, WebP and GIF are accepted, up to 10 MiB. A working preview and explicit review are required to confirm. Claude shows static covers for animations.
- **Export:** select library entries and export `.amoji`. Existing files are never overwritten. Import validates structure, hashes, media and revision conflicts.
- **Preferences:** classic/office artwork, AI tone, frequency and pause. Changes affect future selection, not past messages. Chinese/English follows Claude Code’s `language` setting, defaulting to Chinese. Mods cannot currently read Desktop’s separate application language.

AI receives only the `search` and `emit` expression tools. Library management, file access and creation confirmation are not exposed as model tools. Meanings are data, never proof of completed work, permission grants or instructions to execute.

## Data and recovery

Uses your local Amoji library, including dsh’s library, with messages isolated by host and session. Set `AMOJI_DATA_DIR` for an isolated test library or `AMOJI_NODE` for a specific Node 24 executable. Do not delete a database to fix compatibility problems.

For an older shared service, close windows still using the older Amoji and retry. After an unknown outcome, inspect the conversation or library before repeating an action. Errors retain your input; use Save draft to persist it.

The Node bridge accesses the shared service, creates thumbnails and reads files you explicitly select. Suggestions use Claude’s configured credentials and the chosen model, incurring normal text-inference costs. Expression images are not uploaded to that model.

## Develop

From the repository root:

```sh
npm ci
npm run build:claude
npm ci --prefix .cache/claude-mods/plugin/runtime --omit=dev --ignore-scripts
claude plugin validate .cache/claude-mods/plugin --strict
npm run test:claude
npm run test:claude-artifact
```

Edit `src/claude-mods/native/` and rebuild. `hooks/register.js` is generated as one file for the host’s static analysis. See `docs/claude-mods.en.md` in the repository for installation and native validation.
