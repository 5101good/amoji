# Security policy

[中文](SECURITY.md)

## Reporting

If the repository's [Security](https://github.com/5101good/amoji/security) page offers private vulnerability reporting, use it. Otherwise open an Issue requesting a private contact channel only, without exploitation details, credentials, databases, or conversations. The project does not currently commit to a response-time SLA.

Include Amoji/dsh/Node versions, OS/architecture, affected boundary, minimal reproduction, and redacted logs. Reproduce in an isolated data directory without modifying someone else's instance.

## Current boundaries

- The core is a local loopback service using service identity, local capabilities, and connection/session bindings. It is not a public API for untrusted networks.
- Everyday model tools receive text projections without arbitrary image paths, target sessions, or semantic overrides. Library management is not an unrestricted model-write interface.
- AI suggestions reuse dsh's model service and credentials, sending only text intent and generation instructions, without images or chat history. People must review meaning and rights. Host/provider data-retention policies remain their own.
- `.amoji` imports validate ZIP paths, CRC, schema, hashes, actual decoded media, and resource budgets. They are not executable plugin packages.
- Runtime directories contain personal libraries, messages, assets, and service discovery information that may include access secrets. File permissions are not content encryption. Do not attach these directories to public diagnostics.

Software uses host networking and local dependencies. Package managers download dependencies during archive installation. Amoji's MIT license neither replaces their licenses nor guarantees third-party components are vulnerability-free. Security fixes target the currently maintained dsh version; legacy Codex/Claude Code has no separate security-support commitment.
