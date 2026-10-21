import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { isMergedStudent } from "@/features/students/status/merged";
import { isBookkeepingOnlyExit } from "@/features/withdrawals/system-bulk";
import { shiftMonth } from "@/features/dashboard/overview/coverage-rules";
import { COVERAGE_WINDOW_MONTHS, computeRecordCoverage, saveCoverageMark } from "@/features/dashboard/overview/record-coverage";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { aywaHistoryMonths, isLiveTuition, lessonNameWeights, type HistoryInvoice } from "../history-aywa";
import { lessonProgramClassifier, type LessonStaff } from "../lesson-program";
import { mergeHistory, type HistoryMonth } from "../history";

type Admin = ReturnType<typeof createAdminClient>;
const fail = (scope: string, error: { message?: string }) => new Error(`${scope}: ${error.message ?? "알 수 없는 오류"}`);

/**
 * '지난 기록' 에이와 쪽(원장 2026-10-20) — 청구가 지점을 덮기 시작한 달부터 이번 달까지 **모든 달을** 다시 세어 `student_history_monthly`
 * (source = 'aywa')에 쓴다. 시작 달·수업을 시작한 등록은 등록 막대와 **같은 판정 결과**(`computeRecordCoverage`)를 그대로 쓰고, 시작이
 * 창 안에 보이면 그 판정을 확정값으로 적어 둔다(`saveCoverageMark`, 0386a). 원생 매일 기록 cron(23:55 KST)이 지점마다 부른다 — 화면
 * 요청 길엔 없다(청구 항목 jsonb는 밤에 한 번만 · B2: 전 줄을 페이지로). cron(관리 키)이라 모든 조회에 tenant_id([[#104]]).
 * 창 안의 옛 에이와 줄 중 시작 달 앞(청구가 기준에 못 미치면 창 안 전부)은 지운다(옛 규칙으로 쓴 줄이 메이크에듀 값을 덮거나 남지 않게).
 * 🔴 창(36개월) **밖** 달은 건드리지 않는다 — 다시 셀 재료가 창 밖이라, 지우면 지난 기록이 해마다 앞에서 사라진다.
 * 돌려주는 값 = 쓴 달 수.
 */
export async function recordAywaHistory(admin: Admin, tenantId: string, today: string): Promise<number> {
  const thisMonth = today.slice(0, 7);
  const windowStart = shiftMonth(thisMonth, -(COVERAGE_WINDOW_MONTHS - 1));
  const [coverage, invoices, students, ended, programInput] = await Promise.all([
    computeRecordCoverage(admin, tenantId, today),
    fetchAllPaged<HistoryInvoice>((a, b) =>
      admin.from("invoices").select("student_id,period,status,category,line_items,amount_total,amount_paid").eq("tenant_id", tenantId).gte("period", windowStart).lte("period", thisMonth).order("id").range(a, b),
    ),
    fetchAllPaged<{ id: string; enrolled_at: string | null; notes: string | null; withdrawal_metadata: unknown }>((a, b) =>
      admin.from("students").select("id,enrolled_at,notes,withdrawal_metadata").eq("tenant_id", tenantId).gte("enrolled_at", `${windowStart}-01`).lte("enrolled_at", today).order("id").range(a, b),
    ),
    fetchAllPaged<{ student_id: string }>((a, b) =>
      admin.from("enrollments").select("student_id").eq("tenant_id", tenantId).not("end_date", "is", null).order("id").range(a, b),
    ),
    // 프로그램 칸(수업명으로 가름)의 재료 — 학원 설정 과목 + 직원의 이름·담당 과목. 못 읽으면 그 칸만 빼고 센다(나머지 기록은 그대로 쓴다).
    loadProgramInput(admin, tenantId).catch((e: unknown) => {
      console.error(JSON.stringify({ level: "error", scope: "student-history-aywa.programs", tenantId, message: e instanceof Error ? e.message : String(e) }));
      return null;
    }),
  ]);
  // 확정값 쓰기는 '지난 기록' 쓰기를 막지 않는다(실패는 남기고 다음 밤에 다시 적는다 — 적대 재리뷰 2026-10-20).
  await saveCoverageMark(admin, tenantId, coverage).catch((e: unknown) =>
    console.error(JSON.stringify({ level: "error", scope: "record-coverage.mark-save", tenantId, message: e instanceof Error ? e.message : String(e) })),
  );
  const from = coverage.billingFrom;
  if (!from) {
    await deleteStale(admin, tenantId, windowStart, null);
    return 0;
  }
  // 등록 막대와 같은 모집단 — 병합·수업 기록 없는 장부 정리는 뺀다(같은 판정 함수 · 같은 근거).
  const withHistory = new Set(ended.map((e) => e.student_id));
  const registrations = students
    .filter((s) => s.enrolled_at && s.enrolled_at.slice(0, 7) >= from)
    .map((s) => ({
      id: s.id,
      enrolledAt: s.enrolled_at,
      merged: isMergedStudent(s.notes),
      bookkeeping: isBookkeepingOnlyExit({ withdrawalMetadata: s.withdrawal_metadata, hasEnrollmentHistory: withHistory.has(s.id) }),
    }));
  const months: string[] = [];
  for (let m = from; m <= thisMonth; m = shiftMonth(m, 1)) months.push(m);
  const live = invoices.filter(isLiveTuition);
  const classify = programInput ? lessonProgramClassifier(lessonNameWeights(live), programInput.subjects, programInput.staff) : undefined;
  const rows = aywaHistoryMonths({ months, invoices: live, registrations, started: new Set(coverage.started), classify });
  const now = new Date().toISOString();
  const { error } = await admin
    .from("student_history_monthly")
    .upsert(rows.map((r) => ({ tenant_id: tenantId, month: `${r.month}-01`, source: "aywa", data: r.data, computed_at: now })), { onConflict: "tenant_id,month,source" });
  if (error) throw fail("지난 기록 쓰기", error);
  await deleteStale(admin, tenantId, windowStart, from);
  return rows.length;
}

/** 수업명 판정기의 설정 재료 — 설정 과목(키·이름)과 담당 과목이 있는 직원(표시 이름·영문 이름). 관리 키라 tenant_id([[#104]]). */
async function loadProgramInput(admin: Admin, tenantId: string): Promise<{ subjects: { key: string; label: string }[]; staff: LessonStaff[] }> {
  const [settings, users] = await Promise.all([
    getTenantSettingsByTenantId(tenantId, { failOnReadError: true }),
    fetchAllPaged<{ display_name: string | null; english_name: string | null; subjects: string[] | null }>((a, b) =>
      admin.from("users").select("display_name,english_name,subjects").eq("tenant_id", tenantId).not("subjects", "is", null).order("id").range(a, b),
    ),
  ]);
  return {
    subjects: settings.operations.subjects.map((s) => ({ key: s.key, label: s.label })),
    staff: users.filter((u) => u.subjects?.length).map((u) => ({ names: [u.display_name, u.english_name], subjects: u.subjects ?? [] })),
  };
}

/** 창 안(`windowStart` 이후)의 옛 에이와 줄 — `from` 앞만(없으면 창 안 전부). 창 밖 달은 그대로 둔다(위 주의). */
async function deleteStale(admin: Admin, tenantId: string, windowStart: string, from: string | null): Promise<void> {
  const inWindow = admin.from("student_history_monthly").delete().eq("tenant_id", tenantId).eq("source", "aywa").gte("month", `${windowStart}-01`);
  const { error } = await (from ? inWindow.lt("month", `${from}-01`) : inWindow);
  if (error) throw fail("지난 기록 옛 줄 지우기", error);
}

/** `aywaAt` = 에이와 쪽 값을 마지막으로 센 시각(원생 매일 기록 cron · 화면이 '언제 밤 기준'인지 적는다 — 적대 재리뷰 2026-10-20). */
export type StudentHistory = { months: HistoryMonth[]; /** 에이와 청구로 세기 시작한 달(YYYY-MM) — 없으면 null. */ aywaFrom: string | null; aywaAt: string | null };

/**
 * 원생 통계 '지난 기록' 읽기 — 지점의 월별 집계(수십 줄)만 읽어 두 출처를 잇는다(`mergeHistory`). 서버 전용 표라 관리 키 + tenant_id
 * ([[#104]] · 호출부가 `requireAccess("students")`를 먼저 지난다). 표가 아직 없으면(0385a 미적용) 던진다 — 카드만 '못 불러옴'.
 */
export async function loadStudentHistory(tenantId: string): Promise<StudentHistory> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("student_history_monthly").select("month,source,data,computed_at").eq("tenant_id", tenantId).order("month").limit(400);
  if (error) throw fail("지난 기록 읽기", error);
  const rows = ((data ?? []) as { month: string; source: "makeedu" | "aywa"; data: unknown; computed_at: string | null }[]).map((r) => ({
    month: r.month.slice(0, 7),
    source: r.source,
    data: r.data,
    at: r.computed_at,
  }));
  const aywa = rows.filter((r) => r.source === "aywa");
  const aywaAt = aywa.reduce<string | null>((m, r) => (r.at && (!m || r.at > m) ? r.at : m), null);
  return { months: mergeHistory(rows), aywaFrom: aywa[0]?.month ?? null, aywaAt };
}
