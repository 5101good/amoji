# Three collaboration scenario packs

[中文（默认）](README.md)

These packs reuse 10 reviewed fixed meanings in both classic and office styles: 20 exact assets/revisions. Original semantics are Chinese. English descriptions and examples explain the content without rewriting immutable semantics. Changing style neither changes nor enables actions.

| Pack | Expressions | Optional guidance |
| --- | --- | --- |
| [Make it clear](make-it-clear.amoji) | I do not understand; be more specific; give an example; please confirm | Explain simply; example first; answer-first conversation habit |
| [Work well together](work-well-together.amoji) | What is blocking progress; checking; I will handle it | Evidence and unknowns; completion self-check conversation habit |
| [Collaborate comfortably](collaborate-comfortably.amoji) | Thanks for the effort; you are welcome; unsure for now | None; expression alone is complete |

Each manifest labels its human-to-AI and AI-to-human examples as examples. They are not model-validation or user-study results. AI selection and sending never activate associated actions.

Import a `.amoji` file in dsh expression management, or obtain an independently reviewed public marketplace release. Repository artifacts do not establish publication. Marketplace publication assigns separate pack/release identities. Main files contain complete schema `0.2`; `.expressions.amoji` uses `0.1`, retaining exact expression revisions, media and licenses while omitting actions and bindings.

Choose **Send only** or **Send and apply** for action-bearing expressions. One-time guidance affects the linked input turn. Conversation habits require explicit activation in the current conversation. Disable one habit or all habits to stop future application. Disabling does not delete history or guarantee forgetting. Installation, collection, style changes, AI sends and new conversations never authorize actions. Guidance is not enforcement, grants no privileges and creates no independent inference calls.

Reused visuals and fixed meanings retain [CC0-1.0](../base-library/LICENSE), with sources and original digests in [provenance.json](../base-library/provenance.json). Descriptions, actions and examples here are also CC0-1.0. Original expression objects and blobs remain unchanged, with no new image generation; tests compare each object to the base library.

Rebuild with `npm run build && node scripts/build-seed-scenarios.mjs`. The script makes no model calls and validates market budgets, media and integrity through the actual codec. Changed content requires new identities/revisions rather than overwritten releases. See the [contributor guide](../../docs/development.en.md) and [bilingual protocol](../../docs/specs/scenario-packs-v0.2.md).
