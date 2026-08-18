import { Fragment, useMemo } from "react";

/**
 * The React port of md() in public/app.js — same markdown subset, different
 * output. The vanilla version escapes text and builds an HTML string because
 * it ends at innerHTML. This builds React elements instead, so there is no
 * HTML string anywhere and every piece of text is a text node. Escaping isn't
 * something this has to remember to do; it's the only thing it can do.
 *
 * That matters because model output, museum fields and custom era labels are
 * all untrusted text (see CLAUDE.md §11), and this is the app's XSS surface.
 */

// One pass, left to right. `code` comes first so backticks win over ** and *,
// and ** comes before * so bold wins over italic — the same precedence the
// chained .replace() calls get in the vanilla version.
//
// The lookbehind reproduces the (^|[\s(]) guard on italic without consuming
// the preceding character, so a lone * mid-word doesn't open emphasis.
const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|(?<=^|[\s(])\*([^*\n]+)\*/g;

function inline(text, keyBase) {
  const out = [];
  let last = 0;
  let n = 0;

  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));

    const key = `${keyBase}-${n++}`;
    if (m[1] !== undefined) out.push(<code key={key}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={key}>{m[2]}</strong>);
    else out.push(<em key={key}>{m[3]}</em>);

    last = m.index + m[0].length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

function parse(text) {
  return text
    .split(/\n{2,}/)
    .map((block, b) => {
      const lines = block.split("\n").filter((l) => l.trim() !== "");
      if (lines.length === 0) return null;

      // A heading only when it is the whole block, so a paragraph that happens
      // to start with # doesn't swallow the lines under it.
      const heading = lines[0].match(/^(#{2,4})\s+(.*)$/);
      if (heading && lines.length === 1) {
        return <h3 key={b}>{inline(heading[2], b)}</h3>;
      }

      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        return (
          <ul key={b}>
            {lines.map((l, i) => (
              <li key={i}>{inline(l.replace(/^\s*[-*]\s+/, ""), `${b}.${i}`)}</li>
            ))}
          </ul>
        );
      }

      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
        return (
          <ol key={b}>
            {lines.map((l, i) => (
              <li key={i}>
                {inline(l.replace(/^\s*\d+[.)]\s+/, ""), `${b}.${i}`)}
              </li>
            ))}
          </ol>
        );
      }

      return (
        <p key={b}>
          {lines.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {inline(l, `${b}.${i}`)}
            </Fragment>
          ))}
        </p>
      );
    })
    .filter(Boolean);
}

export default function Markdown({ text }) {
  // Every token re-renders the message, and re-parsing a few KB each time is
  // wasteful rather than wrong. useMemo skips it when the text is unchanged.
  const blocks = useMemo(() => parse(text), [text]);
  return blocks;
}