import { parseTapeNo } from './tapeNo';

export interface MessageImportResult {
  tapeNo: string;
  title: string;
  date: string;
  paragraphs: { label: string; text: string }[];
}

const PARA_RE = /^(E-\d+|\d+)\s+(.*)$/; // line-leading label: "E-1 …" or "76 …"

export function parseMessageText(raw: string): MessageImportResult {
  const lines = (raw || '').replace(/\r\n/g, '\n').split('\n');

  // Header: first non-empty line is the title; the tape number is the first line
  // that parses as one; the date is the first line after the title that isn't the
  // tape line and isn't a paragraph.
  const nonEmpty = lines.map((l) => l.trim());
  const title = nonEmpty.find((l) => l.length > 0) ?? '';
  let tapeNo = '';
  for (const l of nonEmpty) {
    const t = parseTapeNo(l);
    if (t) { tapeNo = t; break; }
  }
  let date = '';
  for (const l of nonEmpty) {
    if (!l || l === title || parseTapeNo(l) === l || PARA_RE.test(l)) continue;
    if (parseTapeNo(l) && l.length <= 12) continue;
    date = l; break;
  }

  const paragraphs: { label: string; text: string }[] = [];
  for (const raw2 of lines) {
    const line = raw2.trim();
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
