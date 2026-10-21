# Amoji · Claude Desktop Mods

[中文](README.md) · [Open-source project](https://github.com/5101good/amoji)

People see artwork; AI reads fixed meanings. Native expressions, two-way visual messages, a personal library and assisted creation in **local sessions of Claude Desktop’s Code tab**.

Requires Claude Code with Mods (validation baseline: 2.1.295+) and Node.js 24+. This adapter does not target ordinary Chat, Cowork or cloud sessions. The terminal has a text fallback; Desktop is the visual target.

## Install

Starting with v1.1.0, GitHub Releases include `amoji-claude-mods-<version>.zip`; verify it with that release's `SHA256SUMS`, or build from source. v1.0.0 does not include this package. Extract the complete `.claude-plugin/` and `plugin/` directories.

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

- **Expressions:** search by name or meaning, pressing Enter to update. In Desktop, click an image to send it directly to the current conversation. No additional submission is needed. The name button supports keyboard sending. In Library, click a name to inspect its fixed meaning. Terminal users retain a Send button. Right clicks and dragging outside do not send.
- **Library:** archive/restore, create revisions of personal entries, copy built-ins, or choose imported revisions. Past messages retain the exact image and meaning that were sent.
- **Create:** describe an intention in one field. Suggestions default to the conversation model; choose an alias or custom model ID. Only that intent is sent, with no images or chat history. Adopt, edit and review the suggestion, or fill the fields manually.
- **Images and packs:** paste an absolute local path (`~/` is supported). PNG, JPEG, WebP and GIF are accepted, up to 10 MiB. A working preview and explicit review are required to confirm. Claude shows static covers for animations.
- **Export:** select library entries and export `.amoji`. Existing files are never overwritten. Import validates structure, hashes, media and revision conflicts.
- **Preferences:** classic/office artwork, AI tone, frequency and pause. Changes affect future selection, not past messages. Chinese/English follows Claude Code’s `language` setting, defaulting to Chinese. Mods cannot currently read Desktop’s separate application language.

AI receives only the `search` and `emit` expression tools. Library management, file access and creation confirmation are not exposed as model tools. Meanings are data, never proof of completed work, permission grants or instructions to execute.

## Expression market and sharing

These additions are in the current source. The existing v1.1.0 Claude release ZIP does not contain the new entries; build from the current source to try them.

1. Open **Manage expressions → Expression market** to search and filter packs, inspect artwork, fixed meanings, attribution, licenses and optional guidance. Install a pack or collect one expression without signing in. Downloads are verified; installation never enables guidance.
2. Installed content works offline. Review old and new meanings and guidance before adopting an update. Removing a pack or collection does not rewrite message history.
3. Open **Share and publish**, connect your market account, verify the device code in your browser, then choose **I authorized it — check connection**. The plugin never receives your account password. Device credentials remain in the shared service's private local directory.
4. Choose an imported 0.2 pack, or select library expressions and **Create a pack**. Save and review the artwork, fixed meanings and license. Saved pack drafts can be resumed.
5. Review the description, license, optional guidance and full preview. Upload and validate first, then confirm distribution rights and submit for review. Content uploads directly from your computer to R2. Drafts survive disconnection; reconcile unknown outcomes rather than submitting twice. Resume uploads, read review feedback, withdraw pending releases and create revisions.

**Collaboration guidance** is separate from fixed meaning. Explicitly enable up to two predefined conversation rules and confirm replacements within the same group. An installed expression's details also offer one-time guidance when available. Each submission revalidates exact source revisions; removed sources are disabled. Only user messages in the current main conversation receive guidance, never grants to other plugins, schedules or subagents. Re-enable after restarting or switching conversations.

Guidance is attached as user text through Claude's `prompt.submit.context`. It runs no arbitrary scripts, grants no tool permissions and cannot guarantee model compliance. Disabling it sends an empty guidance snapshot with subsequent user messages; existing model responses and historical context cannot be undone.

## Data and recovery

Uses your local Amoji library, including dsh’s library, with messages isolated by host and session. Set `AMOJI_DATA_DIR` for an isolated test library or `AMOJI_NODE` for a specific Node 24 executable. Do not delete a database to fix compatibility problems.

For an older shared service, close windows still using the older Amoji and retry. After an unknown outcome, inspect the conversation or library before repeating an action. Errors retain your input; use Save draft to persist it.

If concurrent edits conflict, view the latest saved draft before explicitly adopting it, or save your own text and image as a separate draft. Saving separately leaves the original draft unchanged.

The Node bridge accesses the shared service, creates thumbnails and reads files you explicitly select. Suggestions use Claude’s configured credentials and the chosen model, incurring normal text-inference costs. Expression images are not uploaded to that model. The interface displays raster images directly, without SVG; originals remain intact. Both built-in appearances ship with prepared display images, while personal media uses a local cache.

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

The picker stays open after sending and shows “Sent · Waiting for Claude”. Human expressions appear on the right; AI messages stay on the left, with no additional role labels, matching Claude’s native layout. Use the host’s close or collapse control when needed. Keeping the picker open avoids Desktop’s empty expanded-view behavior on programmatic close.

Desktop can expire native Button handles during focus redraws, logging `ui_press not handled`. The redesigned entry, navigation and action controls retain native appearance and keyboard access, while a keyed Client captures complete pointer gestures and dispatches through the current page’s action map. Stale pages and forged actions are rejected. A Client fault restores native buttons; Enter remains available. Inputs and selects continue to use the host controls. See [Claude Code #99211](https://github.com/anthropics/claude-code/issues/99211).

The picker and management workspace follow dsh: quick artwork/context filters, separate drafts, AI preferences and pack transfer, plus summary-first creation with editing on demand. See the [workflow guide](../../docs/claude-mods.en.md#workflow-aligned-with-dsh).
