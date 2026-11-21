// Hunk helpers shared by the server (building Meals) and the browser (the review panel).

/**
 * Splits a text code answer into review hunks: blocks separated by blank lines, at most `max` lines each.
 * Every line is an added line, because an audience Chef writes an answer and edits nothing.
 * @param {string} code @param {string} [file] @param {number} [max]
 * @returns {import('./types.js').Hunk[]}
 */
export function splitHunks(code, file = '', max = 12) {
  const lines = String(code ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n');
  const blocks = [];
  let block = [], start = 1;
  const flush = () => { if (block.length) blocks.push({ start, lines: block }); block = []; };
  lines.forEach((text, i) => {
    if (!text.trim()) return flush();
    if (block.length >= max) flush();
    if (!block.length) start = i + 1;
    block.push(text);
  });
  flush();
  return blocks.map(b => ({
    file,
    header: `@@ +${b.start},${b.lines.length} @@`,
    lines: b.lines.map(text => ({ t: '+', text })),
  }));
}

/** A code answer as a diff body: every line prefixed with "+". */
export function asAddedDiff(code) {
  return String(code ?? '').replace(/\r\n?/g, '\n').split('\n').map(l => `+${l}`).join('\n');
}

/**
 * Parses a unified git diff into hunks (the showcase floor's real diffs).
 * @param {string} diff @returns {import('./types.js').Hunk[]}
 */
export function hunksFromDiff(diff) {
  const hunks = [];
  let file = '', cur = null;
  for (const line of String(diff ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('diff --git')) { cur = null; const m = / b\/(.+)$/.exec(line); file = m ? m[1] : file; continue; }
    if (!cur || line.startsWith('+++ ') || line.startsWith('--- ')) {
      if (line.startsWith('+++ ')) { const f = line.slice(4).replace(/^b\//, ''); if (f !== '/dev/null') file = f; continue; }
      if (line.startsWith('--- ')) continue;
    }
    if (line.startsWith('@@')) { cur = { file, header: line.replace(/^(@@[^@]*@@).*$/, '$1'), lines: [] }; hunks.push(cur); continue; }
    if (!cur || line.startsWith('\\')) continue;
    const t = line[0];
    if (t === '+' || t === '-' || t === ' ') cur.lines.push({ t, text: line.slice(1) });
  }
  return hunks.filter(h => h.lines.length);
}
