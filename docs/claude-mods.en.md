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
src/application: interaction use cases, pagination, confirmation and suggestion constraints
          ↓ public client / ports
SharedClient → shared service → LibraryStore / immutable assets and messages
```

The shared layer imports no Claude `$`, controls, events, markers or model SDK. A future Codex adapter can reuse the use cases while implementing its own identity, presentation, submission and generation. dsh retains its validated protocol without migrating user data.

Mods statically follows `$` only inside one file, so readable modules in `src/claude-mods/native/` are bundled into `hooks/register.js`. Domain and Node code remain outside that restricted environment.

## Two-way messages

Human sending first creates a frozen, request-idempotent shared-service message, then calls `$.prompt.submit`. Only a text marker and fixed meaning enter the conversation. AI tools accept a query or a selection token from the current turn; session and turn identity come from host events. Subagents cannot borrow the main turn.

Rendering resolves only persisted markers from the same session and direction, preserving surrounding prose. Unknown, forged, cross-session or altered human payloads retain their original text. History uses frozen revisions regardless of appearance changes, archiving or later edits.

Images use local SVG thumbnails of at most 8,500 characters, six per page; no image is sent to the model. Animations use static covers. Submission refusal, unknown outcomes and conflicts are surfaced without automatically repeating a possibly completed action.

## Validation and limitations

- `npm test`: shared use cases, persistence, isolation, media and bridge behavior.
- `npm run test:claude`: official Mods strict validation and control/event tests, with no model requests.
- `npm run test:claude-artifact`: installs the package’s locked dependencies and starts a real isolated service to read the built-in collection and thumbnails.
- Native acceptance separately observes picking, sending, real AI tool replies, images on both sides, draft review/confirmation, preferences and pack IO in Claude Desktop. Harness tests do not prove painted pixels.

Mods exposes no file chooser, so file input uses local paths. UI language follows `settings.language`, defaulting to Chinese; Desktop’s separate application language is not exposed here. Model selection offers the current model, Claude aliases and a custom ID validated by the host, not a purported complete model directory.

`.cache/claude-mods` is a local marketplace. The portable ZIP carries locked dependencies without embedding Sharp/libvips. CI builds and validates it before adding it to GitHub Release checksums and provenance. Publishing occurs only when a version tag is explicitly pushed.


## Current acceptance status

On 2026-10-11, an isolated local project and Amoji library in Claude Desktop 2.31226.1 / embedded Claude Code 2.1.295 were tested with Haiku 5.5 at low effort:

- Composer entry, two-column thumbnails and named-button sending; human messages display images and the model responds to fixed text semantics.
- Real `search` → `emit` calls produce a short reply with an expression. Both human and assistant images still render after plugin reload.
- Creation defaults to the current conversation model. One intent generates a suggestion, explicitly adopted before editing; drafts save and resume, then image/meaning review gates confirmation into the library.
- Concurrent-write conflict recovery: inspect the latest content, save local text and the original image separately, and verify the other writer’s draft remains unchanged.
- Search, `.amoji` export, readable file errors and corrected retry, duplicate import without duplicate revisions, archive and restore.
- Office appearance applies to the picker while existing classic messages keep their original images. Code’s Chinese/English setting switches the interface.

The test transcript confirms human expression input contains text and zero image blocks. AI expression replies also use text tool results and markers. Claude Code still sends its own system context; this is not a fixed token or cost promise for the whole conversation. AI drafting sends only the intent and fixed system prompt.

Sending uses named buttons, with keyboard support. This Mods version permits text-only `Button` children, has no `Svg` click callback, and excludes `Svg` from `Client` elements. Overlay experiments hit part of an image but introduced truncated text, so they are not enabled in the product. Direct image clicking, a native file picker and animation playback are outside the current supported scope. Simulated control tests do not establish native rendering or hit testing.
