import "server-only";
// ECS 시트 가져오기 — 구글 IO만(파싱·매핑·DB 없음).
//
// ⚠️⚠️ **Sheets API 읽기 할당량 = 분당 60회/사용자**(2026-07-30 실측 429 `ReadRequestsPerMinutePerUser`).
//    반 시트가 28개라 "전부 한 번에" 훑으면 문서당 2콜(탭목록+격자) = 56콜로 즉시 초과한다.
//    그래서 이 모듈은 **문서 1개 단위**로만 제공하고, 반복은 호출부(클라 다이얼로그)가 한 반씩 돌린다.
//    429는 짧은 재시도로는 못 넘긴다(분 단위 창) → 아래 백오프는 초 단위가 아니라 **수십 초**다.
import { getSheetsApi, describeSheetsError } from "@/features/integrations/google-sheets";
import { expandVerticalMerges } from "../import/parse-week-tab";
import { isWeekTabTitle } from "../import/week-title";

/** 마스터 문서(원장 진실원본 `2026 영어시간표_인재원 본원`) — 반 시트 링크의 출처. */
export const ECS_MASTER_SPREADSHEET_ID = "1-1JHCw36iWPku782DXMhqYbEMBUFL7bElfJjSQekoWA";

type Quota = { attempts?: number };

/**
 * 429(할당량) 전용 재시도 — 분당 창이라 2s/10s/30s로 벌린다. 그 외 오류는 즉시 throw(재시도 무의미).
 */
async function withQuotaRetry<T>(fn: () => Promise<T>, { attempts = 3 }: Quota = {}): Promise<T> {
  const waits = [2_000, 10_000, 30_000];
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const code =
        (e as { code?: number })?.code ??
        (e as { status?: number })?.status ??
        (e as { response?: { status?: number } })?.response?.status;
      if (code !== 429 && code !== 503) throw e;
      last = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, waits[i] ?? 30_000));
    }
  }
  throw last;
}

export type MasterLink = { spreadsheetId: string; label: string };

/**
 * 마스터 문서의 '통합영어시간표(N월)' 탭들에서 반 시트 하이퍼링크를 전부 수집(문서 id로 중복 제거).
 *
 * 🔴 링크는 **셀 하이퍼링크만이 아니다** — 실측 28건 중 4건은 셀이 아니라 **텍스트 일부에 걸린 링크**
 *    (`textFormatRuns[].format.link.uri`)였고, 셀 링크만 읽으면 그 4개 반이 조용히 빠진다.
 *    `=HYPERLINK()` 수식형까지 세 경로를 모두 훑는다.
 */
export async function listMasterClassSheets(): Promise<{ year: number; links: MasterLink[] }> {
  const sheets = await getSheetsApi();
  try {
    const meta = await withQuotaRetry(() =>
      sheets.spreadsheets.get({
        spreadsheetId: ECS_MASTER_SPREADSHEET_ID,
        fields: "properties.title,sheets.properties(sheetId,title)",
      }),
    );
    const docTitle = meta.data.properties?.title ?? "";
    // 반 시트 탭 제목엔 연도가 없다 → 마스터 문서 제목의 4자리 연도를 기준연도로 쓴다(없으면 올해).
    const year = Number(/(\d{4})/.exec(docTitle)?.[1] ?? new Date().getUTCFullYear());
    // 통합 탭만(강사별·강의실·급여 탭엔 반 시트 링크가 없다). 월별로 여러 개라 전부 합집합.
    const tabs = (meta.data.sheets ?? [])
      .map((s) => s.properties?.title ?? "")
      .filter((t) => t.includes("통합"));
    const byId = new Map<string, MasterLink>();
    for (const tab of tabs) {
      const g = await withQuotaRetry(() =>
        sheets.spreadsheets.get({
          spreadsheetId: ECS_MASTER_SPREADSHEET_ID,
          ranges: [`'${tab}'`],
          includeGridData: true,
          fields:
            "sheets(data(rowData(values(formattedValue,hyperlink,userEnteredValue/formulaValue,textFormatRuns/format/link/uri))))",
        }),
      );
      for (const row of g.data.sheets?.[0]?.data?.[0]?.rowData ?? []) {
        for (const cell of row.values ?? []) {
          const uris: string[] = [];
          if (cell.hyperlink) uris.push(cell.hyperlink);
          for (const run of cell.textFormatRuns ?? []) if (run.format?.link?.uri) uris.push(run.format.link.uri);
          const f = cell.userEnteredValue?.formulaValue;
          if (f && /HYPERLINK/i.test(f)) {
            const m = /"(https?:\/\/[^"]+)"/.exec(f);
            if (m?.[1]) uris.push(m[1]);
          }
          const label = (cell.formattedValue ?? "").split("\n")[0]?.trim() ?? "";
          for (const u of uris) {
            const m = /spreadsheets\/d\/([A-Za-z0-9-_]+)/.exec(u);
            const id = m?.[1];
            if (!id || id === ECS_MASTER_SPREADSHEET_ID) continue;
            const prev = byId.get(id);
            // 라벨이 빈 링크(아이콘 셀 등)보다 이름 있는 쪽을 남긴다.
            if (!prev || (!prev.label && label)) byId.set(id, { spreadsheetId: id, label });
          }
        }
      }
    }
    return { year, links: [...byId.values()] };
  } catch (e) {
    throw new Error(describeSheetsError(e));
  }
}

export type ClassSheetWeeks = {
  docTitle: string;
  tabs: { title: string; rows: string[][] }[];
};

/**
 * 반 시트 1개의 **주차 탭 전부**를 격자로 읽는다(2콜: 탭목록 → 다중 range 격자).
 * `데이터`·`실결제_…`·월별 정산 탭은 제외(isWeekTabTitle) — 그쪽은 수업계획서가 아니고 수백 행이라 무겁다.
 * 열 범위 A~CZ·400행으로 제한(실측 최대 사용 행 ~80, 열 ~63).
 */
export async function readClassSheetWeeks(spreadsheetId: string): Promise<ClassSheetWeeks> {
  const sheets = await getSheetsApi();
  try {
    const meta = await withQuotaRetry(() =>
      sheets.spreadsheets.get({ spreadsheetId, fields: "properties.title,sheets.properties(title)" }),
    );
    const docTitle = meta.data.properties?.title ?? "";
    const weekTabs = (meta.data.sheets ?? [])
      .map((s) => s.properties?.title ?? "")
      .filter((t) => t && isWeekTabTitle(t));
    if (weekTabs.length === 0) return { docTitle, tabs: [] };
    const g = await withQuotaRetry(() =>
      sheets.spreadsheets.get({
        spreadsheetId,
        ranges: weekTabs.map((t) => `'${t}'!A1:CZ400`),
        includeGridData: true,
        // 🔴 merges 필수 — 구글은 병합 범위의 좌상단 셀에만 값을 준다. `시기`·`구분`이 세로 병합이라
        //    안 받으면 이어지는 계획 줄이 통째로 안 보이고 skill_area가 null이 된다(expandVerticalMerges).
        fields: "sheets(properties/title,merges,data(rowData(values/formattedValue)))",
      }),
    );
    const tabs = (g.data.sheets ?? []).map((sh) => {
      const raw = (sh.data?.[0]?.rowData ?? []).map((r) => (r.values ?? []).map((v) => v.formattedValue ?? ""));
      const merges = (sh.merges ?? []).map((m) => ({
        startRowIndex: m.startRowIndex ?? 0,
        endRowIndex: m.endRowIndex ?? 0,
        startColumnIndex: m.startColumnIndex ?? 0,
        endColumnIndex: m.endColumnIndex ?? 0,
      }));
      return { title: sh.properties?.title ?? "", rows: expandVerticalMerges(raw, merges) };
    });
    return { docTitle, tabs };
  } catch (e) {
    throw new Error(describeSheetsError(e));
  }
}
