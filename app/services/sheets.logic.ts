/**
 * Google Sheets URL parsing.
 *
 * Kept apart from the fetching code so it can be unit tested with bare
 * `node --test` — importing the service would pull in network code.
 */

export interface ParsedSheetsUrl {
  sheetId: string;
  gid: string;
}

export function parseGoogleSheetsUrl(url: string): ParsedSheetsUrl | null {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) return null;
  const gidMatch = url.match(/[?#&]gid=(\d+)/);
  return { sheetId: idMatch[1], gid: gidMatch ? gidMatch[1] : "0" };
}
