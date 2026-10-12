// Desktop's native Text does not consistently constrain wrapped CJK prose to
// a Box's cell width. Preserve content, words and punctuation in bounded lines.
export function wrapText(value, columns) {
  const width = Math.max(12, Math.floor(columns));
  const size = text => [...text].reduce((sum, char) => sum + (/[^\u0000-\u00ff]/u.test(char) ? 2 : 1), 0);
  return String(value).split("\n").map(paragraph => {
    let line = "";
    const lines = [];
    const tokens = paragraph.match(/[A-Za-z0-9][A-Za-z0-9/_.:+-]*|[ \t]+|./gu) || [];
    const put = token => {
      if (size(line) + size(token) > width && line) {
        // Avoid an orphan closing mark at the start of a line.
        if (/^[，。！？、；：）》”’.,!?;:]$/u.test(token)) {
          const chars = [...line]; const last = chars.pop();
          lines.push(chars.join("")); line = last + token; return;
        }
        lines.push(line); line = "";
      }
      line += token;
    };
    for (const token of tokens) {
      if (size(token) > width) for (const char of token) put(char);
      else put(token);
    }
    lines.push(line);
    return lines.join("\n");
  }).join("\n");
}
