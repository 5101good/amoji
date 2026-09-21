# Using Amoji

[中文](usage.md) · [Documentation](README.en.md)

## Send and receive

Select a workspace in dsh and open Expressions in the composer. Search by name or meaning, then click an image to send. The details button only reveals fixed semantics. A selection is bound to its conversation; select again after changing conversations. An expression can be the first message without preliminary text.

AI uses text tools to choose and send expressions. People see artwork while the model receives fixed text semantics. Meanings such as “I'll handle it,” “Checking,” and “Ready” have explicit usage boundaries: an expression does not prove completion, deployment, or background execution. The model still needs evidence for progress claims.

## Appearance and AI preferences

Classic and Office each cover the same 24 meanings, totaling 48 assets. Appearance changes are saved to the shared library and affect AI candidates too. Existing messages retain their exact revisions and original artwork.

Appearance and AI tone are separate settings. Choose a neutral, warm, or playful tone; restrained, moderate, or active frequency; or pause AI expressions without disabling user selections. Preferences apply across conversations sharing the library and do not guarantee an expression every turn.

The interface follows dsh's Chinese/English setting. Built-in names, meanings, and usage guidance are currently stored in Chinese; changing the UI language does not translate or rewrite them. Personal expressions can use your own language.

## Create an expression

1. Open the creation page in Manage expressions. Use the top draft selector to switch drafts.
2. Upload artwork now or later. Supported formats are static PNG, JPEG, WebP and animated GIF/WebP. Limits: 10 MiB per file, 2048 pixels per edge, 10 seconds and 200 animation frames. APNG is unsupported.
3. Use the single intent field to describe sender, recipient, situation, meaning, and tone, up to 240 characters. Choose a model and generate text suggestions, or expand manual semantic editing.
4. The default is the model the current conversation will use next; new conversations use the host default. Available models come from dsh. Choosing a suggestion model does not change the conversation model. Select manually if no available default matches.
5. Read and edit the candidate before adopting it, or discard it. Generation and adoption do not persist content. AI suggestions do not overwrite your rights information.
6. Edit the name, fixed meaning, and fallback. Advanced settings include tone, usage/avoidance guidance, tags, language, license, and provenance.
7. Save a draft or choose Save and preview. Once the image loads, review both artwork and semantics, check the confirmation box, then confirm addition to the library. Only then can the expression be sent.

Suggestion requests contain only generation instructions and text intent, without artwork, conversation history, or tools. They time out after 45 seconds without automatic retries. Cancellation, errors, and invalid responses do not write the draft. Calls may incur configured provider charges; manual creation requires no AI request.

Switching drafts retains unsaved input in the current page, but reloading loses memory-only input. Save regularly. For conflicts or unknown outcomes, reconcile the server version before proceeding; the UI offers ways to preserve input or load the current version.

## Library, revisions, and packs

Editing personal content creates a new revision. Built-in or imported content is edited through personal copies. Old messages preserve their original revision, including after archiving. The library supports revision history, current-version selection, archiving, and restoration.

Select content deliberately before exporting. A `.amoji` ZIP pack contains exact revisions, fixed semantics, rights, and media. Imports validate structure, hashes, decoded media, and limits; conflicting immutable revisions are rejected instead of silently overwritten. Limits include 200 expression revisions, 260 MiB compressed, and 250 MiB expanded. Export is an explicit sharing action; personal content is not automatically distributed with the software.

For connection or delivery problems, follow the [recovery guide](dsh-installation.en.md) and reconcile the original request. Repeated clicks or changing selections do not resolve an unknown delivery outcome.
