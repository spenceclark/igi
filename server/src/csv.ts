// Minimal RFC 4180 CSV: quoted fields, embedded commas, quotes and newlines.

/** Parses CSV text into rows of fields, header included; blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  // One character at a time. Inside quotes, a doubled quote is a literal quote and a single one ends the quoting;
  // outside, a comma ends the field and CR, LF or CRLF ends the row.
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') row.push(field), (field = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field), rows.push(row), (row = []), (field = '')
    } else field += c
  }
  // The last row may have no newline after it. A blank line parses as one empty field and is dropped.
  if (field !== '' || row.length) row.push(field), rows.push(row)
  return rows.filter((r) => r.length > 1 || r[0] !== '')
}

/** Writes records as CSV in the header's column order, quoting fields that hold a comma, quote or newline. */
export function toCsv(header: string[], records: Record<string, string>[]): string {
  const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)
  return [header, ...records.map((r) => header.map((h) => r[h] ?? ''))].map((r) => r.map(q).join(',')).join('\n') + '\n'
}
