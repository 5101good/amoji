# Install, upgrade, and recover on dsh

[中文](dsh-installation.md) · [Documentation](README.en.md)

## Requirements

- Node.js >=24. The live host baseline is dsh 0.1.5-rc.2 on macOS arm64.
- Configure models in dsh. Sending a user expression starts a normal host conversation; AI suggestions use configured text models.
- Linux/Windows path handling exists but has not completed live host validation. A successful build does not establish platform compatibility.

## Install a release

The first command initializes the custom `amoji` profile from the official Web template and prints help without starting a server. Initialize this template before installing into a new custom profile.

Download `amoji-dsh-1.0.0.tgz` and `SHA256SUMS` from the same [release](https://github.com/5101good/amoji/releases). Verify SHA-256, then run from your download directory:

```sh
npx @deepseek-ai/dsh@0.1.5-rc.2 --profile amoji --from-default-profile web --help
npx @deepseek-ai/dsh@0.1.5-rc.2 plugin --profile amoji add ./amoji-dsh-1.0.0.tgz --ignore-scripts
npx @deepseek-ai/dsh@0.1.5-rc.2 --profile amoji
```

This example uses a separate `amoji` profile. Substitute your existing profile when appropriate, after saving work and exiting it. The official plugin command installs the package and resolves dependencies through the host package manager. The archive includes neither `node_modules` nor native binaries; dependency installation requires network access. It is not an offline installer.

Restart, select a workspace, and open Expressions in the composer. A new conversation needs no preliminary text message. A fresh library shows 24 built-in expressions for the selected appearance; existing personal content may increase that count. Exit code 0 establishes installation only: check the UI entry point, image loading, and delivery separately.

## Install from a public URL

If you already use the `web` profile, install the version-pinned release directly:

```sh
dsh plugin --profile web add https://github.com/5101good/amoji/releases/download/v1.0.0/amoji-dsh-1.0.0.tgz --ignore-scripts
```

Restart that profile after installation. Downloading and installing require neither GitHub authentication nor a separate Amoji API key. If `dsh` is not on your PATH, replace it with `npx @deepseek-ai/dsh@0.1.5-rc.2`.

## Plugin markets

Submissions to [Awesome DSH Plugin / dshmarket.com](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5624) and [dsh.market](https://github.com/2BingLing/dsh-market/issues/179) are pending review or synchronization. Check the actual public catalogs for availability; use the public URL above while waiting.

Market entries must install the prebuilt Release package. The repository root is a development package, and the `adapters/dsh` source directory does not include every generated file. Do not install the repository root Git URL as a plugin.

The current entry is pinned to v1.0.0; automatic market upgrades are not promised. After a new release, update the catalog tarball link and verify the upgrade. Do not combine `releases/latest/download/` with an old versioned asset filename.

## Build from source

```sh
git clone https://github.com/5101good/amoji.git
cd amoji
npm ci
npm run typecheck
npm test
npm run test:dsh
mkdir -p .local/release
npm pack ./adapters/dsh --ignore-scripts --pack-destination .local/release
```

`test:dsh` includes `build:dsh` and pinned public-contract preparation. Use `npm run build:dsh` for a build alone. The archive name comes from `adapters/dsh/package.json`; version 1.0.0 produces `amoji-dsh-1.0.0.tgz`. Install the newly generated archive, avoiding stale cached files. Root `package-lock.json` pins source dependencies; the host profile lockfile records actual installed dependencies.

## Data and backups

| Platform | Default directory |
| --- | --- |
| macOS | `~/Library/Application Support/Amoji/prototype` |
| Linux | `$XDG_DATA_HOME/amoji`, or `~/.local/share/amoji` when unset |
| Windows | `%LOCALAPPDATA%/Amoji`, or `AppData/Local/Amoji` under the user home when unset |

The historical `prototype` name preserves old image references. Override it with `AMOJI_DATA_DIR`; use a separate directory for tests. The library primarily uses `library.sqlite` and `blobs/`. Service discovery files may contain local access credentials. Do not publicly upload the data directory.

Save drafts before upgrading and retain dsh profile sessions and lockfiles. Use a consistent SQLite backup, or close every connected client, wait for the shared service to exit, and copy the complete directory. Copying a single live SQLite file is not a reliable backup. Expression exports contain selected revisions and media, not a complete backup of conversations, drafts, or preferences.

## Upgrade and uninstall

Keep the new archive at a unique path, run `plugin ... add` again for the same profile, and restart. To uninstall:

```sh
npx @deepseek-ai/dsh@0.1.5-rc.2 plugin --profile amoji remove @amoji/dsh
```

Uninstalling does not proactively delete the shared library. Preserve its directory when reinstalling instead of deleting it to fix a connection. The shared service exits after a default 60 idle seconds once the last client disconnects; other connected clients keep it running.

The adapter requires shared API 2, database 4, and the `dsh-native-delivery-v1`, `dsh-reliable-delivery-v1`, `library-management-v1`, and `packs-v1` capabilities. Incompatible services are rejected without automatic database downgrade. Exit all clients using an old core before reconnecting; do not force a second writer or kill a stale PID.

## Recovery

- Lost connection: reconnect and reconcile through the picker or manager. Reconnection does not automatically resend.
- Unknown delivery: retain the original selection and reconcile the original conversation/request. Do not select and send a different expression as a retry.
- Image failure: fixed fallback text remains available. Text/tool success does not establish successful image display.
- Unknown draft save: reconcile the original draft before editing again; save inputs before reloading the page.
- No suggestion models: configure a model in dsh, then refresh the list. Provider connectivity, quotas, and tool-continuation errors need host/provider investigation.

See [architecture](architecture.en.md) for state definitions and [release scope](release.en.md) for validation limits.
