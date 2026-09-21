# 1.0 release audit

[中文](release-audit.md) · [Documentation](README.en.md)

Audit date: 2026-09-21. Scope: Amoji dsh 1.0.0, with a live baseline of dsh 0.1.5-rc.2, macOS arm64 and Node 24. This does not validate other hosts or a complete model matrix.

## Local verification

- Typecheck passed; core tests 111/111, dsh tests 95/95 and release validation regressions 3/3 passed.
- Internationalization tests use the published dsh LocaleRuntime and cover live language changes, fields/accessibility copy, dynamic status, errors, preserved input and coexistence with the host message dictionary.
- The 1.0 candidate was installed using the official plugin CLI. In Edge, switching dsh settings Chinese → English → Chinese updated the picker, manager, creator and chat expression labels. Unsaved input survived; the suggestion model still defaulted to the current conversation model. The manager showed the project GitHub link.
- Fixed semantics and user content were unchanged. No new paid model requests, test messages or personal-draft confirmations were made. A previously successful Flash wording workflow is not represented as a fresh model test in this audit.
- Release validation checks the actual tarball, versions, runtime entries, built-in pack, dependency licenses, personal-path/credential patterns and SHA-256. The library contains 24 meanings, 48 visual assets and 49 blobs.

## Open-source checks

- Gitleaks 8.30.1 was downloaded from its official Release and verified against the published checksum. Scans of all 64 Git commits present at audit time and the proposed working tree found no matching leaks. This is a scanner result, not proof that no secret exists. Reports remain in an ignored local directory; runtime configuration and raw logs are not uploaded.
- esbuild was updated to 0.28.2. The complete dependency audit against the official npm registry reported zero known vulnerabilities. Locked download URLs now use the official registry.
- Code/documentation use MIT. The base collection and project-generated development artwork use the CC0-1.0 licenses in their respective directories. Historical rights strings in test manifests remain unchanged; development samples are excluded from the dsh distribution.
- The tgz excludes node_modules, native binaries, personal libraries and conversations. Each build produces THIRD_PARTY.json and license texts for its actual resolved dependencies; platform-specific optional dependencies retain their own licenses.
- Current public-facing documentation is bilingual, Chinese first. Outdated research, planning and stage-acceptance files were removed at the maintainer's request. Runtime Schema, example JSON and test assets remain. Existing Git history was not rewritten.
- Security reporting guidance, contribution instructions, bilingual Issue templates and monthly Dependabot checks are configured. Package metadata and the UI link point to the project repository.

## Release and repository state

GitHub Actions reruns verification for version tags and publishes only validated artifacts. The Release provides the plugin, base pack, licenses, SHA256SUMS and BUILD_PROVENANCE.json recording the commit, tag and Actions run URL. Official actions are pinned to commit SHAs. Verification has read-only permissions; only the publishing job receives contents:write. Interrupted draft releases can resume; published assets are never overwritten by a rerun.

Check cloud execution and download results through [Actions](https://github.com/5101good/amoji/actions) and the [v1.0.0 Release](https://github.com/5101good/amoji/releases/tag/v1.0.0). This local audit does not itself establish a successful cloud release. Making the repository public is confirmed separately. At audit time it was private, and GitHub returned 403 for branch protection under its current plan. Required CI checks and private vulnerability reporting can be enabled after visibility changes.

See [release scope](release.en.md) for model continuation and platform limitations.
