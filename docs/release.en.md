# Release scope, process, and known limitations

[中文](release.md) · [Documentation](README.en.md)

## Version 1.0 scope

The primary host is dsh 0.1.5-rc.2, requiring Node.js >=24. The primary distribution is `amoji-dsh-1.0.0.tgz` on [GitHub Releases](https://github.com/5101good/amoji/releases), installed with the official dsh plugin CLI. This is not a commitment to npm registry publication or an offline installer bundling Node, dsh, or native dependencies.

Features include two-way fixed-meaning expressions, 24 meanings in each of Classic/Office, native picker and rendering, personal libraries and drafts, explicit preview confirmation, revisions and archiving, pack import/export, AI preferences, and text suggestions from a selected host model. The UI follows dsh's Chinese/English language; built-in semantics remain Chinese.

## Evidence layers

Historical evidence includes actual installation, browser selection and two-way display, lifecycle recovery on macOS arm64, and one successful Flash text-suggestion request followed by editing, adoption, and draft saving. These are development observations, not a substitute for acceptance of the final 1.0 archive; see the current [release audit](release-audit.en.md). Earlier records remain in Git history.

The final 1.0 archive requires evidence from its corresponding workflow and release acceptance record. Source implementation, automated tests, installation exit code 0, browser rendering, and a successful complete live model turn establish different things.

## Known limitations

- macOS arm64 has live host evidence. Linux, Windows, and other dsh versions lack a complete live matrix.
- AI image validation targets direct tools. Nested Code Dispatch / PTC calls may lose visual metadata; rendering is not guaranteed.
- On one provider's Flash route, AI search, emission, and display succeeded, but the following model request returned HTTP 400 requiring `reasoning_text`. This is a host/provider continuation compatibility boundary; Amoji cannot guarantee complete tool turns for every model.
- Suggestions depend on host model services and credentials. Timeout, cancellation, quota, model discovery, and output-format failures are surfaced without automatic retries or disguised local-template fallbacks.
- UI language changes do not translate stored names, meanings, tags, or user text. Unsaved draft input does not survive page reloads.
- Codex and Claude Code source remains legacy and is not currently validated. Older adapters may be incompatible with a core requiring newer capabilities.

## Maintainer release process

1. Align root and dsh package versions and update both language guides and release notes. Maintain product, schema, API, and database versions separately.
2. Run type checking, core tests, and the full dsh suite from the candidate commit. Inspect package contents, asset counts, licensing, privacy, and personal paths.
3. Install the final candidate and perform relevant UI/model acceptance. Record failures and unverified paths. Keep paid requests within the explicitly agreed scope.
4. Push the corresponding `v1.0.0` tag. Official repository GitHub Actions builds, verifies, and publishes the matching archive, `SHA256SUMS`, release notes, and `BUILD_PROVENANCE.json` with the commit, tag, and Actions run URL. See [Actions](https://github.com/5101good/amoji/actions).
5. Verify Release assets, SHA-256, tag commit, and downloaded package. A workflow definition alone does not prove successful publication.

Code and technical documentation are MIT; built-in assets, semantics, and prompts are CC0-1.0. The actual build supplies a dependency-license inventory. Sharp/libvips and other dependencies retain their own licenses. See [NOTICE](../NOTICE) and [built-in assets](../assets/base-library/README.en.md).
