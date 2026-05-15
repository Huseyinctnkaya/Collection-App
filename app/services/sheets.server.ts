interface ParsedSheetsUrl {
  sheetId: string;
  gid: string;
}

export function parseGoogleSheetsUrl(url: string): ParsedSheetsUrl | null {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) return null;
  const gidMatch = url.match(/[?#&]gid=(\d+)/);
  return { sheetId: idMatch[1], gid: gidMatch ? gidMatch[1] : "0" };
}

export async function fetchGoogleSheetAsCSV(url: string): Promise<Buffer> {
  const parsed = parseGoogleSheetsUrl(url);
  if (!parsed) throw new Error("Invalid Google Sheets URL. Expected a URL containing /spreadsheets/d/{ID}/");

  const csvUrl = `https://docs.google.com/spreadsheets/d/${parsed.sheetId}/export?format=csv&gid=${parsed.gid}`;
  const response = await fetch(csvUrl, {
    headers: { "User-Agent": "collection-studio-importer/1.0" },
    redirect: "follow",
  });

  if (response.status === 403 || response.status === 401) {
    throw new Error(
      "Sheet is not publicly accessible. In Google Sheets, go to File → Share → Share with others, and set access to 'Anyone with the link'."
    );
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch sheet (HTTP ${response.status}): ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  // Google redirects to a sign-in page for private sheets even on 200
  if (contentType.includes("text/html")) {
    throw new Error(
      "Received an HTML page instead of CSV. The sheet may be private. Set sharing to 'Anyone with the link'."
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
