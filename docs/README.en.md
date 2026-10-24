# Amoji documentation

[中文](README.md) · [Project](../README.en.md)

These are the user and developer guides for Amoji 2.0.0, covering dsh and local Claude Desktop Code sessions. Older Codex/Claude hook adapters remain legacy; each host guide describes its validation scope.

| Goal | Guide |
| --- | --- |
| Install, upgrade from 1.x, back up, recover | [dsh installation](dsh-installation.en.md) |
| Native expressions in Claude Desktop Code | [Mods adapter guide](claude-mods.en.md) |
| Send, create, customize, import/export | [Usage](usage.en.md) |
| Understand fixed semantics, revisions, delivery | [Architecture and protocol](architecture.en.md) |
| Read the current expression protocol | [Amoji 0.1 RFC](specs/amoji-0.1-rfc.md) |
| Create complete 0.1 packs with AI | [Amoji Studio skill](../plugins/amoji-studio/README.md) |
| Build, test, contribute | [Development](development.en.md), [Contributing](../CONTRIBUTING.en.md) |
| Check compatibility, release process and unverified paths | [Release scope and limitations](release.en.md) |
| Read the current release notes | [v2.0.0](releases/v2.0.0.md) |
| Inspect historical releases | [v1.1.0](releases/v1.1.0.md), [v1.0.0](releases/v1.0.0.md), [1.0 release audit](release-audit.en.md) |
| Report security issues | [Security](../SECURITY.en.md) |
| Review assets and licenses | [Official packs](../assets/official-packs/README.en.md), [NOTICE](../NOTICE) |

The product version is **2.0.0**, implementing the [Amoji 0.1 protocol](specs/amoji-0.1-rfc.md) (act registry `0.1-r3`); the shared API is `3` and the database `1`. These version numbers have different meanings. The [JSON Schema](specs/amoji-0.1.schema.json) and [act registry](specs/amoji-0.1.registry.json) are used by runtime validation. There is no direct migration for 1.x packs or databases. Version 2.0.0 uses `library-0.1.sqlite` alongside the preserved `library.sqlite`; stop the old service and back up the full directory before upgrading, or use a separate directory for an isolated trial.

Current public guides have Chinese defaults and English counterparts. Historical release and acceptance records retain their original scope; they do not establish that the final 2.0.0 archive passed the same checks. Use the corresponding commit, tag, workflow and acceptance record for current evidence. The [research and experiment inputs](plans/amoji-0.1-backlog.md) describe follow-up work, not completed findings.
