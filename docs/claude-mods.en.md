# Claude Desktop Mods

[中文](claude-mods.md) · [Documentation](README.en.md)

Targets **Claude Desktop → Code → local sessions**, using native AbovePrompt, Pane and message rendering with the shared local Amoji library. Ordinary Claude Chat/MCP Apps is a separate host surface and is not covered by this adapter.

See the [plugin guide](../plugins/amoji-claude-mods/README.en.md) for installation and use. The adapter exists in this source branch; the published v1.0.0 release still contains only dsh. Do not expect the Claude package in that old tag.

## Layer boundaries

```text
Claude native UI / Mods events / model completion
          ↓ JSON over stdin, trusted session and turn identity
src/claude-mods: bridge, markers, thumbnails and explicit local file IO
          ↓
src/application: interaction use cases, range browsing, confirmation and suggestion constraints
          ↓ public client / ports
SharedClient → shared service → LibraryStore / immutable assets and messages
```

The shared layer imports no Claude `$`, controls, events, markers or model SDK. A future Codex adapter can reuse the use cases while implementing its own identity, presentation, submission and generation. dsh retains its validated protocol without migrating user data.

Mods statically follows `$` only inside one file, so readable modules in `src/claude-mods/native/` are bundled into `hooks/register.js`. Domain and Node code remain outside that restricted environment.

## Two-way messages

Human sending first creates a frozen, request-idempotent shared-service message, then calls `$.prompt.submit`. Only a text marker and fixed meaning enter the conversation. AI tools accept a query or a selection token from the current turn; session and turn identity come from host events. Subagents cannot borrow the main turn.

Rendering resolves only persisted markers from the same session and direction, preserving surrounding prose. Unknown, forged, cross-session or altered human payloads retain their original text. History uses frozen revisions regardless of appearance changes, archiving or later edits.

Native Markdown renders AVIF/WebP raster images directly, with no SVG. Gallery images retain a longest edge of 152 pixels for 76 CSS pixels at 2x; message and detail images retain up to 192 pixels, without upscaling small originals. The host shares a 100k text budget across each pane, so each gallery AVIF is capped at 3,350 bytes by adjusting encoding quality, not by reducing dimensions further. Original files remain intact. The gallery scrolls continuously without page controls. The Claude adapter reads ahead up to 64 items into session memory and draws at most 20 visible thumbnails while reserving the complete scroll height. Scrolling within the buffer launches no local process; a new search, list change or refresh reads fresh data. No image is sent to the model. Animations use static covers.

Gallery and detail pixels for both built-in appearances are generated at build time, so the first switch needs no on-demand encoding. Personal media uses a persistent cache keyed by the original digest, display profile and encoder version; corrupt cache entries are rebuilt. An appearance switch uses one local request, preserves the current gallery until the replacement is ready, and ignores repeated selections of the current appearance.

Submission refusal, unknown outcomes and conflicts are surfaced without automatically repeating a possibly completed action.

## Delivery feedback and message layout

Clicking an image immediately shows a sending state. After the host accepts it, the UI says “Sent · Waiting for Claude” until that message’s own main turn completes. Other turns and subagents cannot clear the receipt early. Errors remain visible and are never retried automatically. Model response time is separate from local delivery time.

Expression messages follow Claude’s native alignment: human messages on the right, AI messages on the left, without additional “You” or “Claude” labels. Expression names are shown once. The compact picker removes its duplicate title, close control, and repeated send rows. Search distinguishes loading, errors and empty results; empty results offer Show all and Create expression. Click a picture or its name to send; inspect meanings in Manage expressions. The name button also supports the keyboard. The picker stays open after sending, avoiding Desktop’s empty expanded-tile behavior on programmatic close. Use the host close/collapse controls when needed.

The bridge returns the frozen message’s presentation with the send result. Concurrent history reads are coalesced, with at most 128 cached messages per session. Model input remains text only. Subagent views ask you to return to the main conversation before sending.

## Workflow aligned with dsh

- **Picker**: open Expressions, switch Classic/Office artwork, filter by collaboration context, and click a picture or its name to send. The gallery scrolls continuously without pagination.
- **Manage expressions**: a separate workspace for Library, Create and drafts, AI preferences, and Import/export. Expanded panes have left navigation; narrow docks use a section menu. Returning to the picker preserves search and context.
- **Create and drafts**: explicitly create or resume a draft, describe one intent, choose a model and generate a suggestion. Adopting it shows a meaning summary; Edit meaning and source reveals the fields. Saving, previewing and reviewing still gate confirmation. Switching drafts lets you save, explicitly discard or keep editing unsaved changes.
- **Host differences**: Claude owns fonts, native control colors and the pane shell. Files use local paths, animations use covers, and the picker remains open to avoid Desktop’s programmatic-close issue for expanded panes. Web popovers, file choosers and automatic collapsing are not claimed as supported Mods features.

## Validation and limitations

- `npm test`: shared use cases, persistence, isolation, media and bridge behavior.
- `npm run test:claude`: official Mods strict validation and control/event tests, with no model requests.
- `npm run test:claude-artifact`: installs the package’s locked dependencies and starts a real isolated service to read the built-in collection and thumbnails.
- Native acceptance separately observes picking, sending, real AI tool replies, images on both sides, draft review/confirmation, preferences and pack IO in Claude Desktop. Harness tests do not prove painted pixels.

Mods exposes no file chooser, so file input uses local paths. UI language follows `settings.language`, defaulting to Chinese; Desktop’s separate application language is not exposed here. Model selection offers the current model, Claude aliases and a custom ID validated by the host, not a purported complete model directory.

`.cache/claude-mods` is a local marketplace. The portable ZIP carries locked dependencies without embedding Sharp/libvips. CI builds and validates it before adding it to GitHub Release checksums and provenance. Publishing occurs only when a version tag is explicitly pushed.


## Native verification scope

On 2026-10-11, an isolated local project and Amoji library in Claude Desktop 2.31226.1 / embedded Claude Code 2.1.295 were tested with Haiku 5.5 at low effort:

- Composer entry, expression thumbnails and native Send controls; human messages display images and the model responds to fixed text semantics.
- Native image hit tests passed at the center and corners, after redraws, and for right-click/drag-out cancellation. After the interaction revision, one click on “还在吗” persisted one text-only user message in about 0.38 seconds and displayed the waiting receipt. The model replied about four seconds later; the receipt cleared and the picker stayed open. This is one measurement, not a latency guarantee.
- Post-redesign retest: a physical click on the “谢谢” image in a Haiku 5.5 / low-effort session showed an accepted submission and waiting receipt at the next UI observation, about 1.1 seconds later. One human image message and Claude’s text reply appeared on the right and left, and the receipt cleared. The 1.1 seconds includes computer-control and screenshot overhead; it is not transport latency or a performance guarantee. This layout acceptance pass used only this one model turn.
- Raster-only retest: Classic/Office switching rendered correctly, continuous scrolling reached the 25th expression, and clicking the “谢谢” image sent it directly. The human image appeared clearly on the right, Haiku 5.5 replied on the left, and the waiting receipt cleared. This pass used one model turn; its expression input contains text and no image blocks in the transcript. Installed files were checked against the local build.
- Human expressions are right-aligned, while Claude’s prose stays on the left. The redesigned grid supports one to four columns. This native pass observed the three-column dock, four-column expanded view and fast scrolling in both directions without the previous blank thumbnail-loading regions. Long captions are shortened; image alt text and details retain full names. Empty search results, Show all, image-to-detail navigation, selection/cancellation, grouped preferences and saved draft recovery were checked in the native app. Keyboard tab switching was verified in an earlier native pass.
- Real `search` → `emit` calls produce a short reply with an expression. Both human and assistant images still render after plugin reload.
- Creation defaults to the current conversation model. One intent generates a suggestion, explicitly adopted before editing; drafts save and resume, then image/meaning review gates confirmation into the library.
- Concurrent-write conflict recovery: inspect the latest content, save local text and the original image separately, and verify the other writer’s draft remains unchanged.
- Search, `.amoji` export, readable file errors and corrected retry, duplicate import without duplicate revisions, archive and restore.
- Office appearance applies to the picker while existing classic messages keep their original images. Code’s Chinese/English setting switches the interface.

The test transcript confirms human expression input contains text and zero image blocks. AI expression replies also use text tool results and markers. Claude Code still sends its own system context; this is not a fixed token or cost promise for the whole conversation. AI drafting sends only the intent and fixed system prompt.

Desktop supports clicking an image directly to send. The main UI’s `Markdown` draws the image directly; a transparent `Client` in the same positioned container handles a complete left-button press and release, posting through `surface.post` → `ui.message` to the existing send use case. Both roots use explicit 9×4 cell dimensions because Desktop currently collapses percentage-height roots to one row. Right clicks, modifiers, drags and leaving the region cancel activation. Redraws preserve the instance, scroll-window changes replace target identities, and accepted submissions reject late duplicate events. The host adapter accepts only current-session, pane, module and visible-target events; client data cannot supply expression semantics. The shared application layer has no dependency on these UI APIs.

The expression-name button remains available for keyboard and terminal use, and as a fallback if the image Client fails. The current SDK exposes no pointer cursor setting. Markdown image links have unstable callbacks after redraws and are not used for sending. See the [Mods API reference](https://code.claude.com/docs/en/plugins/mods/reference) and the [redraw event issue](https://github.com/anthropics/claude-code/issues/99211).

The picker now remains open after sending to avoid Desktop’s empty expanded layout after `$.ui.close`. Use the host’s close/collapse control when needed. The public Mods API has no expand/collapse control.

A native file picker and animation playback remain outside the supported scope. Simulated controls, native rendering, hit testing and model replies require separate verification.

Desktop can expire native Button handles during focus redraws, logging `ui_press not handled`. The redesigned entry, navigation and action controls retain native appearance and keyboard access, while a keyed Client captures complete pointer gestures and dispatches through the current page’s action map. Stale pages and forged actions are rejected. A Client fault restores native buttons; Enter remains available. Inputs and selects continue to use the host controls. See [Claude Code #99211](https://github.com/anthropics/claude-code/issues/99211).
