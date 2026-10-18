// Verbatim excerpts from assets/base-library/definitions{,.en}.json (CC0-1.0).
// Each language is its own built-in semantic definition, not an on-the-fly translation.
export const exhibit = [
  {
    id: "thanks",
    zh: {
      name: "谢谢",
      meaning: "谢谢你刚才提供的帮助，我真心领情。",
      tone: "真诚、轻松",
    },
    en: {
      name: "Thanks a ton",
      meaning: "Thank you for the help you just gave; I really appreciate it.",
      tone: "Sincere, relaxed",
    },
  },
  {
    id: "celebrate",
    zh: {
      name: "一起庆祝",
      meaning: "为已经发生并确认的小进展感到开心，想一起庆祝一下。",
      tone: "开心、适度",
    },
    en: {
      name: "Let's gooo",
      meaning:
        "Happy about a small step forward that has actually happened and been confirmed, and want to celebrate it together.",
      tone: "Happy, moderate",
    },
  },
  {
    id: "progress",
    zh: {
      name: "进度如何",
      meaning:
        "我想了解当前任务做到哪一步了，请简要说明已完成、正在处理和剩余事项。",
      tone: "友好、关注进展",
    },
    en: {
      name: "Any updates?",
      meaning:
        "I'd like to know how far the current task has gotten. Please briefly say what is done, what is in progress, and what remains.",
      tone: "Friendly, focused on progress",
    },
  },
] as const;
