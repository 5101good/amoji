# Using Amoji

[中文](usage.md) · [Documentation](README.en.md)

This guide covers the dsh workflow in Amoji 2.0.0. See the [Mods guide](claude-mods.en.md) for Claude Desktop Code entry points and differences. Version 2.0.0 uses the Amoji 0.1 protocol; 1.x users should read the [upgrade and backup guidance](dsh-installation.en.md#upgrade-from-1x-to-200) first.

## Send and receive

Select a workspace in dsh and open Expressions in the composer. Search by name or meaning (a query in any language searches every language), then click an image to send. The details button only reveals the fixed meaning. Quick expressions at the top send an act without choosing a picture; your preferred pack supplies the artwork. You can add a note of up to 140 characters, delivered as your own words. A selection is bound to its conversation; select again after changing conversations. An expression can be the first message without preliminary text.

You can also send while the AI is answering. Steering expressions such as “I don't understand” or “Be more specific” reach the current answer as a signal; if the answer has already ended, they become the next message. “Hold on” stops the current turn, and its record travels with your next message. Social expressions such as thanks or encouragement never interrupt; they wait for the next turn.

The AI expresses acts. People see artwork while the model receives fixed text. Acts such as “I'll handle it,” “Checking,” and “Ready” have explicit boundaries: an expression states a stance; it is not an approval and does not prove completion, deployment or background work. The model still needs evidence for progress claims. When the AI asks you to choose (“Your choice is needed”), your choice states a preference, not an approval.

## Packs and AI preferences

Classic and Office are two official packs with 24 expressions each, realizing the same 22 acts. The pack you choose in the picker becomes your preferred pack, and when the AI expresses an act it takes the artwork from your preferred packs in order. Existing messages keep their exact revisions and original artwork.

In the Preferences page you can reorder preferred packs; set how many AI expressions one answer may carry (default 1, or 0); switch AI expressions on or off per family (grounding, steering, progress, epistemic, social); pause AI expressions; and reduce motion (animated images then show their still cover). Preferences apply across conversations sharing the library and do not guarantee an expression every turn.

The interface follows dsh's Chinese/English setting. Built-in expressions carry their Chinese original and an English meaning, each translation labeled with how it was made; all 20 English meanings in the five character packs were machine-translated and reviewed by the maintainer, labeled `method: "machine-reviewed"` rather than represented as entirely human translations. Changing the UI language shows each expression's meaning by locale fallback without rewriting the original.

## Create an expression

1. Open the creation page in Manage expressions. Use the top draft selector to switch drafts.
2. Upload artwork now or later. Supported formats are static PNG, JPEG, WebP and animated GIF/WebP. Limits: 10 MiB per file, 2048 pixels per edge, 10 seconds and 200 animation frames. APNG is unsupported.
3. Use the single intent field to describe sender, recipient, situation, meaning, and tone, up to 240 characters. Choose a model and generate text suggestions; a suggestion includes the act, name and fixed meaning. You can also expand manual semantic editing.
4. The default is the model the current conversation will use next; new conversations use the host default. Available models come from dsh. Choosing a suggestion model does not change the conversation model. Select manually if no available default matches.
5. Read and edit the candidate before adopting it, or discard it. Generation and adoption do not persist content. AI suggestions do not overwrite your rights information.
6. Choose the act and intensity, and edit the name, fixed meaning and fallback, plus optional use/avoid guidance and tags. You can add other languages and label how each was translated; the original language, text in the image, license and provenance are in advanced settings.
7. Save a draft or choose Save and preview. Once the image loads, review both artwork and semantics, check the confirmation box, then confirm addition to the library. Only then can the expression be sent.

Suggestion requests contain only generation instructions and text intent, without artwork, conversation history, or tools. They time out after 45 seconds without automatic retries. Cancellation, errors, and invalid responses do not write the draft. Calls may incur configured provider charges; manual creation requires no AI request.

Switching drafts retains unsaved input in the current page, but reloading loses memory-only input. Save regularly. For conflicts or unknown outcomes, reconcile the server version before proceeding; the UI offers ways to preserve input or load the current version.

## Library, revisions, and packs

Editing personal content creates a new revision. Built-in or imported content is edited through personal copies. Old messages preserve their original revision, including after archiving. The library supports revision history, current-version selection, archiving, and restoration.

Select several expressions in the library and choose Create a pack: fill in the pack name and description for each language, the license and attribution, preview everything, review and confirm. It becomes a local pack you can later submit to the marketplace. Select content deliberately before exporting. A `.amoji` ZIP pack contains exact revisions, fixed meanings, rights, and media. Imports validate structure, hashes, decoded media, and limits; conflicting immutable revisions are rejected instead of silently overwritten. Limits include 200 expressions, 64 effects, 260 MiB compressed, and 250 MiB expanded. Packs exported by 1.x use the earlier format and cannot be imported. Export is an explicit sharing action; personal content is not automatically distributed with the software.

For connection or delivery problems, follow the [recovery guide](dsh-installation.en.md) and reconcile the original request. Repeated clicks or changing selections do not resolve an unknown delivery outcome.

## Optional collaboration effects

[Seven official expression packs](../assets/official-packs/README.en.md) are importable; public marketplace versions require independent review. A pack can include effects: text guidance for the AI, such as “Answer first, then the evidence.” Clicking an expression with effects offers Send only and Send and apply once; one-time guidance affects only its linked turn and cannot accompany a send while the AI is working. Conversation rules require explicit activation in the current conversation, allow at most two (one per group), and can be disabled individually or together. Disabling stops future attachment without deleting history or guaranteeing forgetting. Effects are guidance, not enforcement; installing, collecting and AI sends never enable them.
