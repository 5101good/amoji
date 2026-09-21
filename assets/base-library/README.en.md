# Amoji built-in expression library

[中文](README.md)

`base.amoji` is a standard Amoji schema `0.1` ZIP pack. Classic (`classic`) and Office (`office`) each cover the same **24 fixed meanings**, totaling **48 assets/revisions and 49 media blobs**, including a separate animation poster. Fresh libraries show 24 items for the selected appearance, plus any personal content.

Classic uses the original cream-colored rounded character; Office uses a gray-blue paper character. Matching expressions across appearances share identical semantics. AI reads text rather than interpreting artwork. Appearance changes do not rewrite exact revisions referenced by old messages.

- `manifest.json`: complete revisions, semantics, rights, and hashes, matching the ZIP manifest.
- `definitions.json`: creation definitions; `generation.json`: recorded prompts.
- `provenance.json`: generator, visual intent, sources, and hashes; not a complete generation transcript.
- `builtin-policy.json`: pack identity and exact migration rules for old defaults.

Original artwork was created for the project with Codex's built-in imagegen; provenance records references and processing. Original artwork, fixed semantics, and prompts use [CC0-1.0](LICENSE). Provenance does not guarantee exclusive output or third-party rights. Imported user content retains its own license.

Upgrades archive only exact old default references specified by policy, retaining revisions, artwork, messages, and personal content. Migration for the same pack identity does not overwrite deliberate archive/restore choices on every start. Changed releases require a new pack identity; do not overwrite immutable revisions under an old identity.

Plugin builds copy the reviewed pack without generating images. Maintainers can run `npm run build`, then `node scripts/build-collaboration-library.mjs <source-directory>` to package existing generated artwork. Supply `classic/<slug>.png` and `office/<slug>.png` for every entry in `definitions.json`. The script does not call a model; it preserves the original encouragement animation and validates its output through the production import validator. Original authoring directories are not shipped in the release; normal installation does not rebuild assets. Asset updates must align manifests, hashes, provenance, migration rules, and asset/import regression checks.
