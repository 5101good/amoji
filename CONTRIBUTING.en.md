# Contributing

[中文](CONTRIBUTING.md)

Use [Issues](https://github.com/5101good/amoji/issues) for reproducible bugs, feature discussions, or documentation improvements. Version 1.0 primarily maintains dsh; explain use cases and compatibility boundaries before proposing a new host or substantial behavior change.

Read [development](docs/development.en.md) and [architecture](docs/architecture.en.md). Keep changes focused, add meaningful regression coverage for behavior changes, and run type checking, core tests, and relevant dsh tests. For documentation, check links and language consistency; prose-only changes do not need new runtime tests.

PRs should describe the problem, final behavior, verification commands/results, untested platforms, and live model-call scope. UI changes should include actual Chinese/English and relevant viewport evidence. Automated screenshots or mocks do not establish host acceptance that did not occur. Do not commit personal data, credentials, private raw conversations, or generated caches.

Preserve fixed semantics, exact revisions, and historical messages. Asset contributions must document source, generation method, license, and restrictions; being an expression pack does not establish redistribution rights. Contribute code/technical documentation under MIT, and original built-in artwork/semantics under the directory's CC0-1.0 license. Retain explicit third-party licenses.

Follow the [security policy](SECURITY.en.md) for vulnerabilities; do not put exploitation details or secrets in public Issues. Communicate respectfully through concrete problems, evidence, and actionable improvements.
