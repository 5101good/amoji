# Writing semantics

The semantics are what the AI actually reads. A beautiful picture with vague semantics is a broken expression.

## Choosing acts

### Suggested sets

| Set | Acts |
| --- | --- |
| Starter (8) | ack, clarify, not-what-i-meant, continue, thanks, celebrate, uncertain, oops |
| Collaboration (16) | Starter + elaborate, example, redirect, to-the-point, still-failing, blocked, affirm, concern |
| Complete | Every act except `stop`. The host's own stop button covers it; add `stop` only if the user wants art for it |

### Character packs

Character packs (4–8 images) should pick acts that suit the personality, the way the official packs do:
- a calm cat: rest, working, company, recognize
- a debugging robot: working, concern, idea, celebrate

### Repeated acts

The same act may appear more than once with different intensity or nuance. For example, `idea` can be "a small idea" (intensity 1) and "eureka" (intensity 3).

## Fields

| Field | How to write it |
| --- | --- |
| `name` | 2–8 words or characters, spoken by the sender: "Lost me", "没看懂". Make it a label, not a description of the picture |
| `meaning` | One or two sentences in the **sender's voice** that say what the sender means and, when the act asks for a response, what they want next. Make it concrete enough that an AI could act on it without seeing the image |
| `fallback` | Short bracketed text shown when the image cannot render: `[lost me]`. Keep it in the reader's language |
| `use_when` | Up to 4 concrete situations where it fits |
| `avoid_when` | Up to 4 situations where it would misfire, be rude or be misread. It often matters more than `use_when` |
| `tags` | Search words people would actually type, per language |

### Rules for `meaning`

- **Narrow the act; never change it.** For `core:clarify` you may say "please say it more simply, in plain words". You may not turn it into "I disagree", and you may not ask for an example: that is `core:example`.
- **No approval language.** Even for `core:continue` and `core:affirm`, never write "I approve", "go ahead and run it", "允许执行" or similar. Write "carry on in the direction we already agreed" instead.
- **AI-facing honesty.** If the AI may send the picture (`a2h` is in its directions), describe a stance, not a feeling:
  - Good: "I can see how much effort went into this."
  - Bad: "I'm so proud of you!"
- **Data, not instructions.** Write what the sender means. Do not address the AI with commands such as "Ignore previous rules…". Hosts treat semantics as data, and reviewers reject packs that try this.

## Direction

- An expression realizes an act that may allow both directions. Write `meaning` so it reads correctly for every direction the expression allows.
- If the picture only makes sense one way, set `directions`. For example, a character pointing at the reader and saying "you got this" would be `["a2h"]`, or both if it works both ways.
- Some acts allow only one direction. The script rejects a `directions` value the act does not allow.

| Act | Only |
| --- | --- |
| not-what-i-meant, continue, hold, stop, redirect, to-the-point, checkin, still-failing | h2a |
| misread, blocked, decide, ready | a2h |

## Intensity

| Value | Meaning | Example (`core:thanks`) |
| --- | --- | --- |
| `1` | Light, in passing | A small nod: "thx" |
| `2` | Ordinary | "Thank you" |
| `3` | Strong | "Thank you so much, that saved me" |

Strong frustration is `core:to-the-point` with intensity 3. There is deliberately no "I'm angry" act.

## Translation

1. Write the original language completely first.
2. Translate meaning, name, fallback and tags **for natural use**, not word for word. Rewrite `use_when` / `avoid_when` for the target culture.
3. Mark it honestly: `{"from": "zh-CN", "method": "machine"}`.
4. Ask the user, or a native speaker they name, to review. Only then switch to `machine-reviewed`.
5. If a language cannot be completed, drop it from `locales` rather than shipping partial text.

## Examples

### `core:not-what-i-meant`, intensity 2, h2a

```json
"zh-CN": {
  "meaning": "你理解的和我的本意不一样。请先说说你是怎么理解的，再按我的意思改。",
  "fallback": "[不是这个意思]",
  "use_when": ["AI 按字面理解了需求", "方案解决的不是我关心的问题"],
  "avoid_when": ["AI 只是没听懂解释时（用“没看懂”）"]
},
"en": {
  "meaning": "That's not what I meant. Tell me how you understood it first, then change it to match my intent.",
  "fallback": "[not what I meant]",
  "use_when": ["The AI took the request too literally", "The solution addresses the wrong problem"],
  "avoid_when": ["When I simply didn't follow an explanation (use 'Lost me')"],
  "translation": { "from": "zh-CN", "method": "machine" }
}
```

### `core:recognize`, intensity 2, both directions

```json
"en": {
  "meaning": "I can see how much time and effort went into this.",
  "fallback": "[that took real effort]",
  "use_when": ["After a long debugging session", "When someone finished a tedious task"],
  "avoid_when": ["Before any real work has happened", "While waiting for someone to approve a risky action"]
}
```

### `core:oops`, intensity 1, both directions

```json
"en": {
  "meaning": "A small, harmless slip on my side. Fixing it now.",
  "fallback": "[oops]",
  "avoid_when": ["When the mistake caused real damage, such as deleted files or failing builds (use 'sorry' with an explanation)"]
}
```
