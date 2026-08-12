/**
 * Minimal CSV writer for the Settings page exports.
 *
 * Two details that matter for a file the owner will open in Excel or Numbers:
 *
 *  - Values are always quoted and inner quotes doubled, so commas, newlines and
 *    quotes inside notes or addresses cannot break the column structure.
 *  - A leading apostrophe-style guard is applied to values beginning with
 *    = + - @, which spreadsheet apps would otherwise execute as a formula.
 *    That is CSV injection, and these exports contain free text the owner typed.
 */

export type CsvValue = string | number | boolean | Date | null | undefined;

function formatValue(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function escapeCell(value: CsvValue): string {
  let text = formatValue(value);

  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv<T extends Record<string, CsvValue>>(
  rows: T[],
  columns: { key: keyof T; header: string }[],
): string {
  const header = columns.map((column) => escapeCell(column.header)).join(',');
  const body = rows.map((row) =>
    columns.map((column) => escapeCell(row[column.key])).join(','),
  );

  // CRLF and a UTF-8 BOM keep Excel happy with accented characters.
  return `﻿${[header, ...body].join('\r\n')}\r\n`;
}

export function csvResponse(csv: string, fileName: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
