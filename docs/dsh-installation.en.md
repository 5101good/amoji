# Install, upgrade, and recover on dsh

[中文](dsh-installation.md) · [Documentation](README.en.md)

## Requirements

- Use Node.js 24+. The main branch tests the SDKs published to npm latest and the macOS desktop nightly channel.
- Configure models in dsh. Sending a user expression starts a normal host conversation; AI suggestions use configured text models.
- Linux/Windows path handling exists but has not completed live host validation. A successful build does not establish platform compatibility.

## macOS Desktop

Paste the release URL below into the desktop plugin manager. Once installed, enable `@amoji/dsh`.

[amoji-dsh-2.1.0.tgz](https://github.com/5101good/amoji/releases/download/v2.1.0/amoji-dsh-2.1.0.tgz)

Build from a checkout containing desktop support. Run these commands at the repository root and paste the absolute path printed at the end into the desktop plugin manager. Enable the installed plugin, then open a workspace to see the picker beside the composer.

```sh
npm ci
npm run build:dsh
mkdir -p .local/desktop
npm pack ./adapters/dsh --ignore-scripts --pack-destination .local/desktop
realpath .local/desktop/amoji-dsh-*.tgz
```

The package name in the manager should be `@amoji/dsh`. Installing the repository Git URL selects the development package `amoji` and fails with `not-bundle`.

## Install into a CLI profile

Use the tarball built above. These commands initialize a Web profile, install the plugin, and start DSH.

```sh
npx @deepseek-ai/dsh@latest --profile amoji --from-default-profile web --help
npx @deepseek-ai/dsh@latest plugin --profile amoji add "$PWD/.local/desktop/amoji-dsh-2.1.0.tgz" --ignore-scripts
npx @deepseek-ai/dsh@latest --profile amoji
```

Release archives keep the host requirements of their original tag.

## Plugin markets

Submissions to [Awesome DSH Plugin / dshmarket.com](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5624) and [dsh.market](https://github.com/2BingLing/dsh-market/issues/179) are pending review or synchronization. Check the actual public catalogs for availability; use the locally built archive above while waiting.

Market entries must install the prebuilt Release package. The repository root is a development package, and the `adapters/dsh` source directory does not include every generated file. Do not install the repository root Git URL as a plugin.

Third-party catalogs may still pin an older version; automatic market upgrades are not promised. Catalog maintainers must update the tarball link and verify installation; a GitHub release does not establish that a catalog has updated. Do not combine `releases/latest/download/` with an old versioned asset filename.

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

`test:dsh` includes `build:dsh` and pinned public-contract preparation. Use `npm run build:dsh` for a build alone. The archive name comes from `adapters/dsh/package.json`; version 2.1.0 produces `amoji-dsh-2.1.0.tgz`. Install the newly generated archive, avoiding stale cached files. Root `package-lock.json` pins source dependencies; the host profile lockfile records actual installed dependencies.

## Data and backups

| Platform | Default directory |
| --- | --- |
| macOS | `~/Library/Application Support/Amoji/prototype` |
| Linux | `$XDG_DATA_HOME/amoji`, or `~/.local/share/amoji` when unset |
| Windows | `%LOCALAPPDATA%/Amoji`, or `AppData/Local/Amoji` under the user home when unset |

The historical `prototype` name preserves old image references. Override it with `AMOJI_DATA_DIR`; use a separate directory for tests. Version 2.1.0 primarily uses `library-0.1.sqlite` and `blobs/`; the old `library.sqlite` is preserved without automatic import. Service discovery files may contain local access credentials. Do not publicly upload the data directory.

Save drafts before upgrading and retain dsh profile sessions and lockfiles. Use a consistent SQLite backup, or close every connected client, wait for the shared service to exit, and copy the complete directory. Copying a single live SQLite file is not a reliable backup. Expression exports contain selected revisions and media, not a complete backup of conversations, drafts, or preferences.

## Upgrade from 1.x to 2.0.0

This is a breaking upgrade. Version 2.0.0 uses the redefined Amoji 0.1 pack format, shared API `3` and database `1`. Restarting the database number at 1 does not make it compatible with older databases. There is no direct import or in-place migration for 1.x expression packs, scenario packs or databases.

1. Save work in the old version, close every dsh, Claude and other client connected to that Amoji library, and wait for the shared service to exit. Retain the complete old data directory, host sessions and the old installation archive.
2. Version 2.0.0 can use the existing data directory: it creates `library-0.1.sqlite`, preserves `library.sqlite` and continues using `blobs/`; an empty directory is not required. For an isolated trial, set another `AMOJI_DATA_DIR` in the host startup environment. dsh and Claude Mods sharing the new library should use the same directory and version 2.0.0.
3. Install the current version as above and restart. The new library initializes Classic and Office; recreate other content in the Amoji 0.1 format or obtain compatible packs.

Do not delete the old library, rename database files, edit schema numbers, or run old and new services against the same directory simultaneously. To roll back, stop all new clients and the shared service before restoring the old plugin and pointing it at the preserved old library. Content created in the 2.0.0 library is not copied back automatically.

## Update within 2.0.x and uninstall

Keep the new archive at a unique path, run `plugin ... add` again for the same profile, and restart. To uninstall:

```sh
npx @deepseek-ai/dsh@latest plugin --profile amoji remove @amoji/dsh
```

Uninstalling does not proactively delete the shared library. Preserve its directory when reinstalling instead of deleting it to fix a connection. The shared service exits after a default 60 idle seconds once the last client disconnects; other connected clients keep it running.

Version 2.1.0 uses the Amoji 0.1 protocol, shared API `3` and database `1`, with capability negotiation for native and reliable delivery, library management and packs. Incompatible services are rejected without automatic database downgrade. Exit all clients using an old core before reconnecting; do not force a second writer or kill a stale PID.

## Recovery

- Lost connection: reconnect and reconcile through the picker or manager. Reconnection does not automatically resend.
- Unknown delivery: retain the original selection and reconcile the original conversation/request. Do not select and send a different expression as a retry.
- Image failure: fixed fallback text remains available. Text/tool success does not establish successful image display.
- Unknown draft save: reconcile the original draft before editing again; save inputs before reloading the page.
- No suggestion models: configure a model in dsh, then refresh the list. Provider connectivity, quotas, and tool-continuation errors need host/provider investigation.

See [architecture](architecture.en.md) for state definitions and [release scope](release.en.md) for validation limits.
