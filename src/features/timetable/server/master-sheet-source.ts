import "server-only";
import { getSheetsApi } from "@/features/integrations/google-sheets";
import { parseSheetUrl } from "@/features/integrations/sheet-url";
import type {
  MasterGrids,
  MasterInput,
  MasterPlan,
} from "../import/master/types";

export type MasterTab = {
  gid: number;
  title: string;
  hidden: boolean;
  rows: number;
  columns: number;
};
export async function masterTabs(
  source: string,
): Promise<{ spreadsheetId: string; title: string; tabs: MasterTab[] }> {
  const parsed = parseSheetUrl(source);
  if (!parsed) throw new Error("구글 스프레드시트 주소를 확인해 주세요.");
  const api = await getSheetsApi();
  const { data } = await api.spreadsheets.get(
    {
      spreadsheetId: parsed.spreadsheetId,
      fields:
        "properties(title),sheets.properties(sheetId,title,hidden,gridProperties)",
    },
    { timeout: 30000 },
  );
  return {
    spreadsheetId: parsed.spreadsheetId,
    title: data.properties?.title ?? "구글 시트",
    tabs: (data.sheets ?? []).map((s) => ({
      gid: s.properties!.sheetId!,
      title: s.properties!.title!,
      hidden: s.properties!.hidden ?? false,
      rows: s.properties!.gridProperties?.rowCount ?? 0,
      columns: s.properties!.gridProperties?.columnCount ?? 0,
    })),
  };
}

export async function readMasterSource(
  input: MasterInput,
): Promise<{ grids: MasterGrids; source: MasterPlan["source"] }> {
  const meta = await masterTabs(input.source);
  const teacher = meta.tabs.find((t) => t.title === input.teacherTab);
  const roster = meta.tabs.find((t) => t.title === input.rosterTab);
  if (!teacher || !roster || teacher.gid === roster.gid)
    throw new Error("같은 달의 강사별 탭과 통합 명단 탭을 각각 선택해 주세요.");
  // A malformed/huge worksheet must never silently become an empty import.
  if (
    [teacher, roster].some(
      (t) => t.rows * t.columns > 100000 || !t.rows || !t.columns,
    )
  )
    throw new Error(
      "선택한 탭이 시간표 크기를 벗어납니다. 월별 강사별·통합 시간표 탭을 선택해 주세요.",
    );
  const api = await getSheetsApi();
  const { data } = await api.spreadsheets.get({
    spreadsheetId: meta.spreadsheetId,
    ranges: [teacher, roster].map((t) => `'${t.title.replace(/'/g, "''")}'`),
    includeGridData: true,
    fields:
      "sheets(properties(sheetId,title),merges,data(rowData(values(formattedValue,effectiveFormat(backgroundColor,backgroundColorStyle)))))",
  },{timeout:30000});
  const grid = (gid: number) => {
    const s = data.sheets?.find((s) => s.properties?.sheetId === gid);
    if (!s?.data)
      throw new Error(
        "시트 내용을 읽지 못했습니다. 탭 목록을 새로 불러와 주세요.",
      );
    const rows = s.data[0]?.rowData ?? [];
    return {
      tabName: s.properties!.title!,
      cells: rows.map((r) =>
        (r.values ?? []).map((v) => v.formattedValue ?? ""),
      ),
      fills: rows.map((r) =>
        (r.values ?? []).map((v) => {
          const f = v.effectiveFormat;
          if (f?.backgroundColorStyle?.themeColor)
            return f.backgroundColorStyle.themeColor !== "BACKGROUND";
          const c = f?.backgroundColor;
          return (
            !!c &&
            !(
              (c.red ?? 0) >= 0.999 &&
              (c.green ?? 0) >= 0.999 &&
              (c.blue ?? 0) >= 0.999
            )
          );
        }),
      ),
      merges: (s.merges ?? []).map((m) => ({
        startRowIndex: m.startRowIndex ?? 0,
        endRowIndex: m.endRowIndex ?? 0,
        startColumnIndex: m.startColumnIndex ?? 0,
        endColumnIndex: m.endColumnIndex ?? 0,
      })),
    };
  };
  return {
    grids: { teacher: grid(teacher.gid), roster: grid(roster.gid) },
    source: {
      spreadsheetId: meta.spreadsheetId,
      teacherTab: teacher.title,
      rosterTab: roster.title,
      teacherGid: teacher.gid,
      rosterGid: roster.gid,
    },
  };
}
