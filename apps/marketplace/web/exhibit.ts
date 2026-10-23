// Verbatim excerpts from assets/official-packs/classic.manifest.json (CC0-1.0).
// Each language is the pack's own semantics, not an on-the-fly translation;
// `act` is the registry act the expression realizes (RFC §5).
export const exhibit = [
  {
    id: "thanks",
    act: "core:thanks",
    zh: {
      name: "谢谢",
      meaning: "谢谢你刚才提供的帮助，我真心领情。",
    },
    en: {
      name: "Thanks a ton",
      meaning: "Thank you for the help you just gave; I really appreciate it.",
    },
  },
  {
    id: "celebrate",
    act: "core:celebrate",
    zh: {
      name: "一起庆祝",
      meaning: "为已经发生并确认的小进展感到开心，想一起庆祝一下。",
    },
    en: {
      name: "Let's gooo",
      meaning:
        "Happy about a small step forward that has actually happened and been confirmed, and want to celebrate it together.",
    },
  },
  {
    id: "progress",
    act: "core:checkin",
    zh: {
      name: "进度如何",
      meaning:
        "我想了解当前任务做到哪一步了，请简要说明已完成、正在处理和剩余事项。",
    },
    en: {
      name: "Any updates?",
      meaning:
        "I'd like to know how far the current task has gotten. Please briefly say what is done, what is in progress, and what remains.",
    },
  },
] as const;
