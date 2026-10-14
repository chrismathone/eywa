/** Preserve every physical form, including hidden copies. Never infer an approval from a blank signature. */
export type SourceSheet = { sheetId: number; title: string; hidden: boolean; values: unknown[][] };
export type ImportedReport = {
  sourceKey: string; sheetId: number; sheetTitle: string; sourceRange: string; studentName: string;
  schoolGrade: string; className: string; subject: string | null; exitDate: string | null; rawExitDate: string;
  teacherName: string; fields: Record<string, string>; signatures: { role: string; name: string; date: string }[];
  rawGrid: string[][];
};
const text = (v: unknown) => String(v ?? "").trim();
const fold = (v: unknown) => text(v).replace(/\s+/g, "");
export function sourceColumn(n: number): string { let result = ""; while (n) { n--; result = String.fromCharCode(65 + n % 26) + result; n = Math.floor(n / 26); } return result; }
const labels = new Set(["성명", "학년", "반명", "퇴원일", "수강기간", "담임명", "출결·현황", "출결현황", "퇴원사유", "상담결과", "학생상담", "학부모상담", "담임의견", "원비", "미납여부", "퇴원처리", "교무처진행담당자"]);
export function parseSourceDate(raw: string, title: string): string | null {
  const full = raw.match(/(?<!\d)(\d{4}|\d{2})\s*[.\/-년]\s*(\d{1,2})\s*[.\/-월]\s*(\d{1,2})/);
  const short = !full && raw.match(/(?<!\d)(\d{1,2})\s*[.\/월-]\s*(\d{1,2})(?:\s*일)?/);
  const tabYear = title.match(/^(\d{2})\./)?.[1];
  const parts = full ? [full[1].length === 2 ? `20${full[1]}` : full[1], full[2], full[3]] : short && tabYear ? [`20${tabYear}`, short[1], short[2]] : null;
  if (!parts) return null;
  const iso = `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}
export function parseSourceReports(sheet: SourceSheet): ImportedReport[] {
  const titles: { r: number; c: number }[] = [];
  sheet.values.forEach((row, r) => row.forEach((v, c) => { if (fold(v) === "퇴원처리서") titles.push({ r, c }); }));
  return titles.flatMap(start => {
    const neighbor = titles.filter(t => Math.abs(t.r - start.r) <= 1 && t.c > start.c).sort((a, b) => a.c - b.c)[0];
    const below = titles.filter(t => t.r > start.r + 10 && Math.abs(t.c - start.c) <= 2).sort((a, b) => a.r - b.r)[0];
    const width = Math.min(neighbor ? neighbor.c - start.c : 14, 16);
    const end = Math.min(below?.r ?? start.r + 23, sheet.values.length);
    const grid = sheet.values.slice(start.r, end).map(row => Array.from({ length: width }, (_, c) => text(row[start.c + c])));
    const positions = new Map<string, { r: number; c: number }>();
    grid.forEach((row, r) => row.forEach((v, c) => { const key = fold(v); if (labels.has(key) || key.startsWith("퇴원상세사유")) positions.set(key.startsWith("퇴원상세사유") ? "상세사유" : key, { r, c }); }));
    const value = (key: string) => {
      const position = positions.get(key); if (!position) return "";
      const out: string[] = [];
      for (let c = position.c + 1; c < width; c++) {
        const cell = grid[position.r][c]; if (labels.has(fold(cell))) break;
        if (cell) out.push(cell);
      }
      return out.join("\n");
    };
    const fields = Object.fromEntries([...positions.keys()].map(key => [key, value(key)]));
    const signatures: ImportedReport["signatures"] = [];
    let subject: string | null = null;
    grid.slice(0, 6).forEach((row, r) => row.forEach((v, c) => {
      if (fold(v) === "과목") { const s = grid[r + 1]?.[c] ?? ""; subject = /수학/.test(s) ? "math" : /영어|eie/i.test(s) ? "english" : s || null; }
      if (["담임", "팀장", "원장"].includes(fold(v))) signatures.push({ role: fold(v), date: grid[r + 1]?.[c] ?? "", name: grid[r + 2]?.[c] ?? "" });
    }));
    const studentName = fields["성명"] ?? "";
    const body = [fields["상세사유"], fields["학생상담"], fields["학부모상담"], fields["담임의견"]].filter(Boolean);
    if (!studentName && !body.length) return [];
    const rawExitDate = fields["퇴원일"] ?? "";
    const sourceRange = `${sourceColumn(start.c + 1)}${start.r + 1}:${sourceColumn(start.c + width)}${end}`;
    return [{ sourceKey: `${sheet.sheetId}:${sourceColumn(start.c + 1)}${start.r + 1}`, sheetId: sheet.sheetId, sheetTitle: sheet.title, sourceRange, studentName,
      schoolGrade: fields["학년"] ?? "", className: fields["반명"] ?? "", subject, exitDate: parseSourceDate(rawExitDate, sheet.title), rawExitDate,
      teacherName: fields["담임명"] || signatures.find(s => s.role === "담임")?.name || "", fields, signatures, rawGrid: grid }];
  });
}
