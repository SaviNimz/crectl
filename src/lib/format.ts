/** Prints a simple padded-column table — no external dependency needed. */
export function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => (row[i] ?? '').length))
  );
  const renderRow = (cols: string[]) => cols.map((col, i) => col.padEnd(widths[i])).join('  ');

  console.log(renderRow(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    console.log(renderRow(row));
  }
}
