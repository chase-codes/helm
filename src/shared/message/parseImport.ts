import { parseTapeNo } from './tapeNo';

export interface MessageImportResult {
  tapeNo: string;
  title: string;
  date: string;
  paragraphs: { label: string; text: string }[];
}

const PARA_RE = /^(E-\d+|\d+)\s+(.*)$/;

export function parseMessageText(raw: string): MessageImportResult {
  const lines = (raw || '').replace(/\r\n/g, '\n').split('\n');

  // Separate the header preamble (title / tape number / date) from the numbered body.
  // Authoritative transcripts put a blank line between them; confining header extraction
  // to that preamble stops a title that looks like a paragraph ("1953 The Anointed Ones")
  // from becoming a spurious paragraph, and stops body cross-references to other tape
  // numbers/dates from hijacking the header fields. Fall back to the first paragraph-token
  // line when there is no blank separator.
  const blankIdx = lines.findIndex((l) => l.trim() === '');
  let headerEnd: number;
  let bodyStart: number;
  if (blankIdx !== -1) {
    headerEnd = blankIdx;
    bodyStart = blankIdx + 1;
  } else {
    let fp = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (PARA_RE.test(lines[i].trim())) {
        fp = i;
        break;
      }
    }
    headerEnd = fp;
    bodyStart = fp;
  }
  const header = lines.slice(0, headerEnd).map((l) => l.trim());

  const title = header.find((l) => l.length > 0) ?? '';
  let tapeNo = '';
  for (const l of header) {
    const t = parseTapeNo(l);
    if (t) {
      tapeNo = t;
      break;
    }
  }
  let date = '';
  for (const l of header) {
    // parseTapeNo uppercases the suffix, so compare against the uppercased line —
    // a lowercase-suffix tape line ("64-0206b") must still be skipped, not become
    // the date (#147).
    if (!l || l === title || parseTapeNo(l) === l.toUpperCase()) continue;
    date = l;
    break;
  }

  const paragraphs: { label: string; text: string }[] = [];
  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = PARA_RE.exec(line);
    if (m) {
      paragraphs.push({ label: m[1], text: m[2].trim() });
    } else if (line && paragraphs.length) {
      const last = paragraphs[paragraphs.length - 1];
      last.text = `${last.text} ${line}`.trim();
    }
  }
  return { tapeNo, title, date, paragraphs };
}
