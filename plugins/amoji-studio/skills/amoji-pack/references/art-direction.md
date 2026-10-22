# Art direction

The picture's job is to make an act easy and pleasant for a person to send and recognize. It must read at chat size: about 64–128 px on screen.

## Order of work

1. **Character reference first.** Generate a single neutral pose of the character and agree it with the user. Reuse its description, and the image itself if your tool accepts references, in every later prompt. Consistency across the set matters more than any single image.
2. **One image per expression**, saved as `images/<slug>.png` to match `pack.json`.
3. **Review as a set.** Run `preview` and look at the sheet before calling the pack done. Regenerate outliers: wrong proportions, a different palette, unreadable poses.

## Prompt template

Fill in the brackets. Keep the character and style block identical across the set.

```
[CHARACTER: species/shape, colors, distinctive features, outfit]
[STYLE: e.g. soft watercolor / flat vector / 16-bit pixel art], consistent with the reference.
Pose and expression: [one clear action that shows the act, e.g. "scratching head with a sheepish grin"].
Single character, centered, full body or bust, generous margin, square 1:1 canvas,
transparent background (or a plain flat light background if transparency is unavailable),
no text, no speech bubbles, no watermark, no border.
Must stay readable at 96 px: bold silhouette, simple shapes, strong contrast.
```

## Showing each act

Show the act through **body language**, not props or text:

| Act | Visual idea |
| --- | --- |
| ack | Small nod or a check gesture (thumbs-up is not universal) |
| clarify | Head tilt, question-mark posture, squinting at a page |
| not-what-i-meant | Gentle "no, no" hand wave, pointing to another direction |
| continue | Forward-walking pose, rolling hand gesture |
| hold | Palm out, calm "one moment" |
| to-the-point | Hand making a "cut it short" gesture, tapping a watch kindly |
| still-failing | Holding a smoking gadget, deflated shoulders |
| working / thinking | Focused, eyes on work; chin on hand for "let me think" |
| blocked | Facing a wall or knot, looking back for help |
| uncertain | Shrug, one eyebrow up, hand wobble |
| idea | Light-bulb moment, sparkle near the head |
| concern | Magnifying glass, cautious lean |
| disagree | Arms gently crossed, polite head shake. Not angry |
| thanks / recognize | Bow, hands together, offering a small gift or tea |
| celebrate | Confetti, a jump, a high five. Keep it moderate |
| sorry | Bowing apologetically. Distinct from the playful oops |
| oops | Head scratch, sheepish grin |
| company / rest | Sitting together, cup of tea, a blanket |

## Text in images

- **Default to no lettering.** Lettering ties the picture to one language and one script.
- If the user wants lettering, set `text_locale` to that language, keep it to one or two words, and consider a text-free variant for other languages.

## Cultural safety

- Hand gestures carry very different meanings around the world: thumbs-up, OK sign, V sign and pointing are not universal. Prefer whole-body poses and facial expressions.
- Avoid religious symbols, flags, national stereotypes and alcohol unless the user explicitly wants them for their audience.

## Rights

- Do not imitate existing copyrighted characters, brand mascots, logos or real people, even "in the style of".
- Record how the art was made in `rights.source`, e.g. `Generated with <tool> on <date>; prompts in prompts.md`, and keep the prompts.
- Check that the image tool's terms allow the license the user picks. If unsure, say so instead of choosing for them.

## Transparency and format

- Transparent PNG is best. The build keeps alpha and only scales the image into a centered square; it never crops or recomposes.
- If the tool cannot produce transparency, use a flat light background. The build will warn; tell the user about it.
- Use `"resample": "nearest"` in `pack.json` for pixel art, so edges stay crisp. The build then encodes lossless WebP.
- Animated art is not supported by this tool yet. Use static images.
