# Amoji official expression packs

[中文（默认）](README.md)

One coherent collection, one companion with its own character. People see artwork; AI reads fixed text semantics. Expressions work in both directions of a conversation.

| Pack | Style and purpose | Expressions |
| --- | --- | --- |
| [Classic](classic.amoji) | Cream-white characters for gratitude, encouragement and everyday collaboration | 24 |
| [Office](office.amoji) | Quiet paper characters for confirmations, progress and handoffs | 24 |
| [Slow Cat](slow-cat.amoji) | Watercolor, rest, reflection and companionship | 4 |
| [Good Dog](good-dog.amoji) | Felt, acknowledgement, encouragement and thanks | 4 |
| [Pixel Pal](pixel-pal.amoji) | Pixel art, focused work, debugging and milestones | 4 |
| [Orbit Jelly](orbit-jelly.amoji) | Glass, exploration, connections and honest uncertainty | 4 |
| [Paper Goose](paper-goose.amoji) | Paper cutouts, humor and considerate reminders | 4 |

Seven packs contain 68 expression assets. Classic and Office retain the same original 24 meanings as separate complete collections; the five new collections add 20 meanings. Scenarios are filter tags. The three former small groupings remain for immutable-version compatibility and protocol tests, but are excluded from the new directory.

Import any `.amoji` in dsh's Import and export area, or use the marketplace to install a pack or collect individual expressions. New characters remain discoverable regardless of the built-in Classic/Office preference. Existing optional guidance is retained in Classic and Office; importing or sending expressions never enables it automatically. The five new packs contain expressions only.

`catalog.json` records identities, counts and SHA-256 digests. Each matching `manifest.json` exposes all semantics and media references. Every archive independently meets the marketplace's 10 MiB budget. “Official” describes project-authored content, not a verification badge that community uploaders can obtain by copying an attribution name.

Canonical semantics are Chinese. Bilingual names and descriptions do not rewrite them. Artwork, semantics and generation prompts use [CC0-1.0](LICENSE). Classic/Office retain [base-library provenance](../base-library/README.en.md). New artwork was generated individually with built-in Codex imagegen; `generation.json` records prompts and character-reference relationships, and `provenance.json` records source digests and encoding. Distributable transparent WebP artwork lives in `images/`.

Run `npm run build && node scripts/build-official-packs.mjs` to rebuild from checked-in artwork without model calls. When preparing new art, optionally supply a private source directory containing `<pack>/<expression>.png`. The builder checks alpha, standardizes to 512px, validates complete archives and writes deterministic ZIPs. Content changes require a version increment and a new release identity; published versions must not be overwritten.

Repository archives, local previews and the production marketplace are separate delivery stages. The preview loads these seven packs, and the GitHub Release build attaches their downloadable archives. Production publication still follows upload, independent review and publication. Building does not mutate production data or bypass review.
