/** Prints a simple padded-column table — no external dependency needed. */
export function printTable(headers: string[], rows: string[][], indent = ''): void {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => (row[i] ?? '').length))
  );
  const renderRow = (cols: string[]) => indent + cols.map((col, i) => col.padEnd(widths[i])).join('  ');

  console.log(renderRow(headers));
  console.log(indent + widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    console.log(renderRow(row));
  }
}

/** Prints a titled block of "label  value" lines; multi-line values stay aligned under the value column. */
export function printSection(title: string, rows: [label: string, value: string][]): void {
  console.log(`\n${title}`);
  const labelWidth = Math.max(0, ...rows.map(([label]) => label.length));
  const continuationIndent = ' '.repeat(2 + labelWidth + 2);
  for (const [label, value] of rows) {
    const [firstLine, ...otherLines] = value.split('\n');
    console.log(`  ${label.padEnd(labelWidth)}  ${firstLine}`);
    for (const line of otherLines) console.log(continuationIndent + line);
  }
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/** Filesystem-safe local timestamp, e.g. "20260928-104512". */
export function formatTimestamp(date: Date = new Date()): string {
  const twoDigits = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${twoDigits(date.getMonth() + 1)}${twoDigits(date.getDate())}-` +
    `${twoDigits(date.getHours())}${twoDigits(date.getMinutes())}${twoDigits(date.getSeconds())}`
  );
}
