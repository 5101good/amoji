# Development and verification

[中文](development.md) · [Documentation](README.en.md)

Use Node.js >=24 and run from the repository root:

```sh
npm ci
npm run typecheck
npm test
npm run test:dsh
```

| Command | Scope |
| --- | --- |
| `npm run typecheck` | TypeScript checking |
| `npm test` | Core and non-dsh automated tests; excludes `dsh-*.test.ts` |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run build:dsh` | Build Host, browser bundle, assets, and dependency-license inventory |
| `npm run prepare:dsh` | Check pinned local dsh npm contracts |
| `npm run test:dsh` | Build, prepare contracts, and run all dsh automated tests |
| `npm run test:file -- tests/<name>.test.ts` | Run one test; build/prepare contracts first for dsh tests |

`scripts/dsh/baseline.json` records the public-package baseline; the lockfile pins full dependencies. The Client loads through the host module loader and uses host-provided React. Installing a separate copy does not substitute for host-owned services.

## Directories

- `src/`: shared service, SQLite library, protocol, pack and media validation.
- `src/dsh/`: Host, Client, picker, manager, and AI suggestions.
- `assets/base-library/`: reviewable manifest, provenance, dual-appearance pack, and CC0.
- `adapters/dsh/`: plugin entry point, metadata, and generated output.
- `tests/`: behavior, contract, packaging, isolation, and resource-limit tests.
- `docs/`: current bilingual guides, release audits, and runtime schemas.

`dist/`, `.cache/`, and generated runtime/client files come from scripts. Edit source and rebuild instead of patching bundles. Isolate runtime data with `AMOJI_DATA_DIR`; do not test migrations against a daily-use library.

## What verification establishes

Automated tests establish only their asserted behavior. Before release, check the final archive in a real profile: installation, activation, picker, user delivery, AI direct-tool rendering, creation preview/confirmation, pack import/export, and reconnection. For UI changes, inspect Chinese/English and narrow layouts. For model changes, record actual input boundaries, responses, and errors rather than presenting mocks as live calls.

Live requests may incur charges. Use an explicitly selected test model and dedicated conversation, recording request count and validated paths. Do not change global models to hide provider incompatibility. Ordinary tests require no credentials; legacy probes under `scripts/probes/` may use host login state and real models, so run them explicitly only after understanding their effects.

## Build a distribution

```sh
npm run build:dsh
mkdir -p .local/release
npm pack ./adapters/dsh --ignore-scripts --pack-destination .local/release
```

Expected content includes Host/Client, core runtime, built-in assets, `BUILD.json`, `LICENSE`, `NOTICE`, `THIRD_PARTY.json`, and `THIRD_PARTY_LICENSES/`. Personal data, credentials, `node_modules`, and native binaries are excluded. The dependency inventory describes the build machine's resolved packages, not identical dependency resolution on every platform.

See [contributing](../CONTRIBUTING.en.md) and [release process](release.en.md).
