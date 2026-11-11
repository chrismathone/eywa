import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getSheetsApi } from "@/features/integrations/google-sheets";
import { reportWarning } from "@/lib/observability/report-error";
import { monthTabKey } from "../withdrawal-sheet-model";
import { buildSheetExitRecords, SHEET_LAST_MONTH, sheetTeacherIndexOf, type SheetExitRecord, type SheetTeacherIndex } from "../sheet-teachers";
import { isSheetTenant, spreadsheetIdOf } from "./withdrawal-sheet";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstDateOf } from "@/lib/date-kst";
import { studentNamesOf, type StudentNames } from "../sheet-match";

/**
 * '퇴원생 관리 차트'의 담당선생님 표(`sheet-teachers.ts`) — 시트를 쓰는 지점(침산)만 · 10분 캐시(지점별).
 * 🔴 읽기만 한다. 못 읽으면(키 없음·권한·시간 초과) null — 화면은 에이와 판정으로 그린다(시트가 없다고 강사 칸이 죽지 않게).
 * 캐시 안의 값은 Map이 아니라 배열(직렬화)로 둔다.
 */
const loadEntries = unstable_cache(
  async (spreadsheetId: string): Promise<SheetExitRecord[]> => {
    const sheets = await getSheetsApi();
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(title)" });
    const lastKey = Number(SHEET_LAST_MONTH.slice(2, 4)) * 100 + Number(SHEET_LAST_MONTH.slice(5, 7));
    const titles = (meta.data.sheets ?? [])
      .map((s) => s.properties?.title ?? "")
      .filter((t) => {
        const k = monthTabKey(t);
        return k != null && k <= lastKey;
      });
    if (!titles.length) return [];
    const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: titles.map((t) => `'${t}'`) });
    const tabs = (res.data.valueRanges ?? []).map((v, i) => ({
      title: titles[i]!,
      rows: ((v.values ?? []) as unknown[][]).map((r) => r.map((c) => (c == null ? "" : String(c)))),
    }));
    return buildSheetExitRecords(tabs);
  },
  ["withdrawal-sheet-exits"],
  { revalidate: 600 },
);

/** 시트 줄들(2026-10까지) — 시트를 쓰지 않는 지점·못 읽으면 null. 한 요청 안에서는 한 번만 읽는다(React `cache`). */
export const loadSheetExits = cache(async (tenantId: string): Promise<SheetExitRecord[] | null> => {
  const spreadsheetId = spreadsheetIdOf();
  if (!spreadsheetId) return null;
  try {
    if (!(await isSheetTenant(tenantId))) return null;
    // 시트가 느려도 화면을 붙잡지 않는다 — 4초 넘으면 이번엔 에이와 판정으로.
    const entries = await Promise.race([
      loadEntries(spreadsheetId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_000)),
    ]);
    if (!entries) {
      reportWarning("퇴원생 관리 차트 담당선생님 읽기 시간 초과", { scope: "withdrawals.sheetTeachers" });
      return null;
    }
    return entries;
  } catch (e) {
    reportWarning("퇴원생 관리 차트 담당선생님 읽기 실패", { scope: "withdrawals.sheetTeachers", message: e instanceof Error ? e.message : String(e) });
    return null;
  }
});

export async function loadSheetTeacherIndex(tenantId: string): Promise<SheetTeacherIndex | null> {
  const records = await loadSheetExits(tenantId);
  return records ? sheetTeacherIndexOf(records) : null;
}

/**
 * 지점 학생 전부의 이름·상태·등록일·퇴원일 — 시트에만 있는 줄이 '과목만 끊은 것'인지 가린다(`sheet-match.ts`).
 * 지점별 10분 캐시(운영실은 30초마다 갱신한다) · admin이라 tenant_id 필수(#104) · 실패는 던진다(호출부가 시트를 안 입힌다 — 삼키면 과목만 끊은
 * 줄이 전부 퇴원으로 부푼다).
 */
/**
 * 퇴원이 남기는 액션 키(학생 id가 실리는 것) — 예약일 cron · 보고서 없는 퇴원 경고. 휴원 뒤 퇴원했다가 복구한 학생을 휴원 복귀로 읽지 않게.
 * ⚠️ 퇴원보고서 처리(`withdrawal_report_update`)는 학생 id를 싣지 않아 못 쓴다 — 휴원 → 보고서로 퇴원 → 복구한 학생은 휴원 복귀로 읽힌다(드묾).
 */
const WITHDRAW_ACTIONS = ["student_withdraw", "student_withdrawn_without_report"];

/** 퇴원에서 돌아온 복구 날짜만(학생 id → KST 날짜들) — 바로 앞 기록이 휴원이면 휴원 복귀, 예약 취소 복구는 퇴원이 없었다. */
function withdrawalRestores(logs: readonly { student_id: string | null; action: string; cancelled: string | null; created_at: string }[]): Map<string, string[]> {
  const last = new Map<string, string>();
  const out = new Map<string, string[]>();
  for (const l of logs) {
    if (!l.student_id) continue;
    const prev = last.get(l.student_id);
    last.set(l.student_id, l.action);
    if (l.action !== "student_restore" || prev === "student_hold" || l.cancelled) continue;
    out.set(l.student_id, [...(out.get(l.student_id) ?? []), kstDateOf(l.created_at) ?? l.created_at.slice(0, 10)]);
  }
  return out;
}

type StudentLifeRow = { id: string; name: string; status: string; enrolled_at: string | null; withdrawn_at: string | null };
const loadStudentLives = unstable_cache(
  async (tenantId: string): Promise<{ students: StudentLifeRow[]; restores: [string, string[]][] }> => {
    const admin = createAdminClient();
    const [students, logs] = await Promise.all([
      fetchAllPaged<StudentLifeRow>((a, b) =>
        admin.from("students").select("id, name, status, enrolled_at, withdrawn_at").eq("tenant_id", tenantId).order("id").range(a, b),
      ),
      // 재원 복구 — 복구가 퇴원일을 지워 그때를 다른 데서 알 수 없다. 🔴 같은 액션 키가 휴원 복귀·퇴원 예약 취소에도 남는다
      // (`student_restore`) → 휴원(`student_hold`)도 읽어 바로 앞 기록이 휴원인 복구(사이에 퇴원 기록이 없다)는 빼고, 예약 취소(`cancelledWithdrawal`)도 뺀다.
      fetchAllPaged<{ student_id: string | null; action: string; cancelled: string | null; created_at: string }>((a, b) =>
        admin.from("audit_logs").select("student_id:metadata->>studentId, action, cancelled:metadata->>cancelledWithdrawal, created_at")
          .eq("tenant_id", tenantId).in("action", ["student_restore", "student_hold", ...WITHDRAW_ACTIONS]).order("created_at").order("id").range(a, b),
      ),
    ]);
    return { students, restores: [...withdrawalRestores(logs)] };
  },
  ["withdrawal-sheet-student-lives"],
  { revalidate: 600 },
);

export const loadStudentNames = cache(async (tenantId: string): Promise<StudentNames> => {
  const { students, restores } = await loadStudentLives(tenantId);
  return studentNamesOf(students, new Map(restores));
});
