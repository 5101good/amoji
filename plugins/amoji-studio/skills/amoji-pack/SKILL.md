---
name: amoji-pack
description: Create a complete Amoji expression pack (.amoji) — character art plus fixed, multilingual text semantics that AI reads — following the Amoji 0.1 protocol. Use when the user wants to design, generate, translate, extend, version or validate an Amoji / AI-native expression pack or sticker set, or asks for a .amoji file.
---

# Amoji pack creator

An Amoji expression is two things at once: a picture people look at, and fixed text semantics an AI reads instead of the picture. Every expression **realizes one act** from a closed registry (for example `core:clarify` "I didn't follow"). The pack is a ZIP with `manifest.json` and content-addressed images.

Your job is to take the user from an idea ("a sleepy otter pack for coding sessions") to a validated `.amoji` file. Talk with the user in their language. The script does the hard validation; never hand-write `manifest.json` or ids.

Read before starting:
- `references/protocol-core.md`: the rules a pack must satisfy. **Always read.**
- `references/semantics-guide.md`: how to write semantics for each act, with examples. Read before writing semantics.
- `references/art-direction.md`: how to brief image generation for a consistent set. Read before making art.

The tool is `scripts/amoji_pack.py` (Python 3.9+ and Pillow). Run it with the skill directory as the path prefix, for example `python3 <skill-dir>/scripts/amoji_pack.py acts --locale zh-CN`.

## Workflow

### 1. Brief

Establish the following. Infer what you reasonably can, propose defaults, and ask only about what is missing or risky:

| Item | Default |
| --- | --- |
| Character, art style, personality | none; must come from the user |
| Who sends it | both directions (people → AI and AI → people) |
| Size | starter set of 8 (see `semantics-guide.md`) |
| Original language | the user's language |
| Complete languages | original + `en` |
| Art source | an image tool if one is available, otherwise the user's own images |
| License and creator | ask; only suggest `CC0-1.0` if the user wants open reuse |

Refuse or redirect requests to imitate existing copyrighted characters, brands or real people. The user must hold the rights to the art and semantics they publish.

### 2. Plan the acts

1. Run `amoji_pack.py acts --locale <lang>` to see the 32 core acts with their directions and expected responses.
2. Pick the acts that fit the size and the character's personality. A character pack does not need every act.
3. **Show the plan as a table and get the user's confirmation before generating any art**, because art is the expensive step. Columns: slug, act, name, one-line meaning, intensity.

### 3. Scaffold and write semantics

1. Run `amoji_pack.py init <dir> --slug <pack-slug> --locale <original> --locales en[,more] [--creator NAME] [--license ID]`. This creates `<dir>/pack.json` with a fresh `pack_id` and an `images/` folder.
2. Fill in `pack.json`. Its format is in `protocol-core.md` § Source format.
3. Write the original language first, then translate. Every non-original language must carry `"translation": {"from": "<original>", "method": "machine"}`. Change the method to `"machine-reviewed"` or `"human"` only after a person has actually reviewed it.

### 4. Make the art

Follow `art-direction.md`:
1. Establish the character with one reference image first.
2. Generate one image per expression into `images/<slug>.png`.
3. Set `text_locale` to the language of any lettering in the image, or `null` if there is none.

If no image tool is available, give the user ready-to-use prompts and the expected file names, then continue once they supply the images.

### 5. Build, check, review

```
python3 <skill-dir>/scripts/amoji_pack.py build <dir>            # writes <dir>/dist/<slug>.amoji
python3 <skill-dir>/scripts/amoji_pack.py check <dir>/dist/<slug>.amoji
python3 <skill-dir>/scripts/amoji_pack.py preview <dir>/dist/<slug>.amoji -o <dir>/dist/preview.png
```

- `build` reports **every** problem at once. Fix the source and rebuild until it reports no errors. Never edit the output archive, and never weaken a rule to get a pass.
- Treat warnings as questions for the user. For example: "no transparent pixels" — is that intended?
- Show the user the preview sheet and a summary: acts covered, languages, and which translations are machine-made.

### 6. Deliver

Hand over the `.amoji` file and the `preview.png`. Also tell the user:
- installation into an Amoji host is a separate step, and installing never enables anything automatically;
- to change the pack later, edit the same source directory, **keep `pack_id` and the expression slugs**, increase `version`, and rebuild. A changed slug becomes a different expression.

## Hard rules

- Use only acts from the registry. There is deliberately **no approve / allow / yes act**. Never write semantics that imply approving an action or granting permission. That is true even for `core:continue` and `core:affirm`.
- Never add `authority`, `expects`, `forms`, `grounded` or `pressure_sensitive`. Only the registry defines them, and the script rejects them.
- A `meaning` may only **narrow** its act, never contradict or widen it.
- Semantics an AI might send express a communicative stance ("I can see the effort you put in"), not claims about the AI's inner feelings ("I'm so happy").
- Never fabricate translation provenance. Never present machine translation as human-reviewed.
- Effects (packaged collaboration prompts) are an optional protocol module that this skill does not author. Build expression-only packs.
