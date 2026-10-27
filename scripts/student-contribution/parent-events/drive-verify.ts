import { normalizedGrid } from "./bundle";
import { hash } from "./source-values";
import type { EventSourcePack } from "./bundle";
/** Optional CLI adapter. MCP users can supply the same fresh read through the apply function's verifier. */
export async function verifyDriveSources(pack: EventSourcePack) {
  const token = process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
  if (!token) throw new Error("Fresh Drive reads are required; configure a short-lived read-only Google access token for this CLI");
  const get = async (url: string) => {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Drive source verification failed (${response.status})`);
    return response.json();
  };
  // Every profiled sheet participates, including review/cancellation rows that could contradict an accepted row.
  for (let start = 0; start < pack.sources.length; start += 4) await Promise.all(pack.sources.slice(start, start + 4).map(async source => {
    if (!/^[a-zA-Z0-9_-]+$/.test(source.fileId)) throw new Error("Invalid Drive file id");
    const meta = await get(`https://sheets.googleapis.com/v4/spreadsheets/${source.fileId}?fields=properties(title),sheets(properties(sheetId,title))`);
    if (meta.properties?.title !== source.title || !meta.sheets?.some((s: { properties: { sheetId: number; title: string } }) => s.properties.sheetId === source.gid && s.properties.title === source.sheet)) throw new Error("Source title or sheet changed");
    const range = encodeURIComponent(`'${source.sheet.replace(/'/g, "''")}'`);
    const data = await get(`https://sheets.googleapis.com/v4/spreadsheets/${source.fileId}/values/${range}?valueRenderOption=FORMATTED_VALUE`);
    if (hash(normalizedGrid(data.values ?? [])) !== hash(normalizedGrid(source.values))) throw new Error("Drive source changed; prepare and approve a new report");
  }));
}
