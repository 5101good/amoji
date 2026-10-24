# Release scope, process, and known limitations

[中文](release.md) · [Documentation](README.en.md)

## Version 2.0.0 scope

Amoji 2.0.0 implements the [Amoji 0.1 protocol](specs/amoji-0.1-rfc.md): an act registry, multilingual fixed meanings and translation provenance, packs and optional effects, act-based AI expression, correction signals and interrupts while the AI works, decision options and quick replies. Product `2.0.0`, protocol `0.1`, registry `0.1-r3`, shared API `3` and database `1` are maintained separately.

Distribution targets **dsh 0.1.5-rc.2** and Mods-capable **local Claude Desktop Code sessions** (Claude Code baseline **2.1.295+**), both requiring **Node.js >=24**. The [GitHub Release](https://github.com/5101good/amoji/releases/tag/v2.0.0) provides `amoji-dsh-2.0.0.tgz` and `amoji-claude-mods-2.0.0.zip`. Dependencies are resolved during installation; archives do not bundle Node, the host or native dependencies. This is not an offline installer or a commitment to npm registry publication.

Both adapters offer two-way expressions, the personal library, draft confirmation, revisions and archiving, pack transfer, AI preferences and wording suggestions, plus a reviewed pack marketplace, account pairing, publishing and optional collaboration guidance. Classic and Office have 24 expressions each, realizing the same 22 acts; seven official packs are distributed as separate `.amoji` assets. The Chinese/English interface displays multilingual meanings through locale fallback without automatically translating user content. See the [2.0.0 release notes](releases/v2.0.0.md) for full scope and installation commands.

## Breaking changes and upgrades

Amoji 0.1 replaces all earlier formats without a compatibility layer. Version 1.x `.amoji` packs cannot be imported, and 1.x databases have no in-place migration. Restarting database numbering at `1` does not imply compatibility. Version 2.0.0 uses `library-0.1.sqlite` in the existing directory, preserving the old `library.sqlite` and continuing to use `blobs/`; an empty directory is not required. Close all old clients, wait for the service to exit and back up the complete directory before upgrading. Use another `AMOJI_DATA_DIR` for an isolated trial if desired. Never delete the old library, rename database files, edit schema numbers or run old and new services against the same directory simultaneously. dsh and Claude Mods sharing a library should both use 2.0.0. See [upgrade and rollback](dsh-installation.en.md#upgrade-from-1x-to-200).

The marketplace service separately requires migration `0010-amoji-0.1.sql` and compatible pack releases. Publishing the plugin does not establish that the production marketplace has been migrated or deployed. See [marketplace operations and recovery](marketplace-operations.en.md).

## Known limitations

- dsh cannot detect pending confirmations in the host, so withholding pressure-sensitive acts during a pending confirmation only applies after `core:decide`.
- The adaptive frequency allowed by the RFC is not implemented; AI expressions use a fixed per-response-window cap.
- The dsh UI does not offer a menu to anchor an expression to exact message text; the protocol and service support anchors.
- All 20 English meanings in the five character packs have been reviewed and confirmed by the maintainer, labeled as machine-translated and human-reviewed (`method: "machine-reviewed"`). The [review record](releases/v2.0.0-english-review.md) is separate from production marketplace review.
- Historical live-host records exist for macOS arm64; Linux, Windows and other dsh versions lack a complete live matrix. Historical results do not establish acceptance of this candidate archive.
- Native AI image validation targets direct tools. Nested Code Dispatch / PTC calls may lose visual metadata; rendering is not guaranteed.
- Some models have host/provider compatibility problems when continuing after tools. A historical Flash route returned HTTP 400 for missing `reasoning_text`; Amoji does not guarantee complete tool turns for every model.
- Wording suggestions depend on host model services and credentials. Timeout, cancellation, quota, model-discovery and output-format errors are surfaced without automatic retries or disguised local-template results.
- Claude Mods uses local paths for file input and still covers for animation. Ordinary Chat, Cowork and cloud sessions are outside its scope. See the [Mods guide](claude-mods.en.md).
- Independent human usability research is not claimed as complete. Older Codex/Claude hook adapters remain legacy.

## Evidence layers

Source implementation, automated tests, archive integrity, installation exit codes, browser/native rendering, complete real-model turns and production deployment establish different facts. Each needs its own evidence. The final archive should trace to its commit, tag, Actions workflow, asset digests and acceptance record; a local build does not prove public release.

Historical material includes the [1.0 release audit](release-audit.en.md), [1.1 release notes](releases/v1.1.0.md) and [historical Claude native checks](claude-mods.en.md#historical-native-verification). Their installation, model, backup, recovery and public-network results retain their original scope and do not establish acceptance of 2.0.0.

## Maintainer release process

1. Align root `package.json` and its lockfile, the dsh package and the Claude Mods manifest at `2.0.0`. Update both language guides and `docs/releases/v2.0.0.md`. Maintain product, protocol, API and database versions separately; preserve historical release files.
2. From the final candidate commit, run type checking, core tests, the full dsh suite, Claude Mods strict validation/control tests and archive tests. Inspect official packs, build manifests, dependency licenses, privacy and personal paths.
3. Install the final candidate and perform applicable UI/model acceptance. Record passed, failed and unverified paths separately. Keep paid requests within the agreed scope; mark English meanings as human-reviewed only after actual human confirmation.
4. Build the combined assets: `node scripts/release-artifacts.mjs` reads `docs/releases/v2.0.0.md` from the root version; `node scripts/append-claude-release.mjs` verifies and adds the Claude ZIP, with unified `SHA256SUMS` and `BUILD_PROVENANCE.json`. Local checks do not replace the remote workflow.
5. Push the matching `v2.0.0` tag. The official [CI and release workflow](../.github/workflows/ci.yml) builds, verifies and publishes the tgz, ZIP, seven official packs, licenses, release notes, checksums and provenance (commit, tag and Actions run URL) from the same commit.
6. Inspect the actual [Actions](https://github.com/5101good/amoji/actions) result, download the Release assets and check their SHA-256, tag commit and provenance. A workflow definition alone does not prove publication. A plugin Release does not establish marketplace deployment or third-party catalog updates.

Code and technical documentation are MIT; official artwork, fixed meanings and prompts are CC0-1.0. The actual build supplies dependency-license inventories; Sharp/libvips and other dependencies retain their own licenses. See [NOTICE](../NOTICE) and [the official packs](../assets/official-packs/README.en.md).
