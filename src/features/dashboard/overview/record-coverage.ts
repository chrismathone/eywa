import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { billedBeforeRegistration, coverageStartFromCounts, groupBy, shiftMonth, startedRegistration, trustedFrom } from "./coverage-rules";

/** 출석 근거 — 출석·지각·조퇴·보강(결석·공결은 수업을 들은 근거가 아니다). */
export const ATTENDED_STATUSES = ["present", "late", "early_leave", "makeup"];
/** 보는 창 — 원생 통계가 그리는 가장 긴 창(36개월). */
export const COVERAGE_WINDOW_MONTHS = 36;

type Admin = ReturnType<typeof createAdminClient>;

export type RecordCoverage = {
  /** 청구가 지점을 덮기 시작한 달(창 안) — '수업을 시작한 등록' 판정을 믿을 수 있는 첫 달(그 전 등록은 판정하지 않는다). */
  billingFrom: string | null;
  /** 판정 창 안 등록 중 수업을 시작한 학생(`startedRegistration`). */
  started: string[];
  /** 에이와 수강 기록이 갖춰진 첫 달(`trustedFrom` · 시작이 창 밖이면 확정값) — 재원생 추이·월별 기록이 이 달부터 그린다. 자를 것이 없으면 null. */
  trustFrom: string | null;
  /** 청구 시작이 창 안에 보이나 — 보이면 위 값이 확정된 사실이라 밤 기록이 적어 둔다(`saveCoverageMark`, 0386a). */
  visible: boolean;
};

/**
 * 에이와 기록이 어디부터 믿을 만한가 · 누가 수업을 시작했나(원장 2026-10-20 '수업을 시작한 등록만' · '2026년 4월부터') — 판정은
 * `coverage-rules.ts` 한 벌. 운영실 30초 갱신마다 다시 읽지 않게 지점·날짜별 5분 캐시(B6 · 관리 키 + tenant_id [[#104]] — 권한마다
 * 청구가 달리 보이면 사람마다 등록 수가 달라진다) + 한 렌더 안 한 번(`cache`). 🔴 다른 캐시 함수 안에서 부르지 말 것(Next가 안쪽 캐시를
 * 건너뛴다) · 실패는 캐시에 남지 않는다(던진다 — 부르는 쪽이 종전대로 센다).
 */
export const loadRecordCoverage = cache(
  (tenantId: string, today: string): Promise<RecordCoverage> =>
    unstable_cache(() => computeRecordCoverage(createAdminClient(), tenantId, today), ["dashboard-record-coverage-v3", tenantId, today], { revalidate: 300 })(),
);

/**
 * 판정 본체 — 화면(위 캐시)과 '지난 기록' 밤 집계(`recordAywaHistory`)가 같이 부른다. 청구는 창 첫 달보다 **두 달 앞부터** 읽는다(창 첫 두 달
 * 등록에도 '직전 두 달 청구' 규칙이 서게 — 적대 재리뷰 2026-10-20) · 시작 달 판정의 건수는 창 안만.
 */
export async function computeRecordCoverage(db: Admin, tenantId: string, today: string): Promise<RecordCoverage> {
  const thisMonth = today.slice(0, 7);
  const windowStart = shiftMonth(thisMonth, -(COVERAGE_WINDOW_MONTHS - 1));
  const [rawBills, registered, enrollments, mark] = await Promise.all([
    fetchAllPaged<{ student_id: string; period: string | null }>((a, b) =>
      db
        .from("invoices")
        .select("student_id,period")
        .eq("tenant_id", tenantId)
        .eq("category", "tuition")
        .not("status", "in", "(void,refunded)")
        .gte("period", shiftMonth(windowStart, -2))
        .lte("period", thisMonth)
        .order("id")
        .range(a, b),
    ),
    fetchAllPaged<{ id: string; enrolled_at: string | null }>((a, b) =>
      db.from("students").select("id,enrolled_at").eq("tenant_id", tenantId).not("enrolled_at", "is", null).lte("enrolled_at", today).order("id").range(a, b),
    ),
    fetchAllPaged<{ student_id: string; start_date: string | null; end_date: string | null; on_hold: boolean | null }>((a, b) =>
      db.from("enrollments").select("student_id,start_date,end_date,on_hold").eq("tenant_id", tenantId).not("start_date", "is", null).order("id").range(a, b),
    ),
    readCoverageMark(db, tenantId),
  ]);
  const bills = rawBills.filter((b): b is { student_id: string; period: string } => !!b.period && /^\d{4}-\d{2}$/.test(b.period));
  const counts = new Map<string, number>();
  for (const b of bills) if (b.period >= windowStart) counts.set(b.period, (counts.get(b.period) ?? 0) + 1);
  const billingFrom = coverageStartFromCounts(counts, thisMonth);
  if (!billingFrom) return { billingFrom: null, started: [], trustFrom: null, visible: false };
  // 시작이 보인다 = 창 첫 달보다 뒤에서 시작했거나, 창 첫 달 바로 앞 두 달에 청구가 하나도 없다. 🔴 적어 둔 시작 달이 창보다 앞이면
  // 보이지 않는 것이다(창 첫 달 근처의 빈 달·적은 달 때문에 '보인다'로 잘못 읽고 확정값을 덮어쓰지 않게 — 적대 재리뷰 2026-10-20).
  const visible = !(mark && mark.billing_from < windowStart) && (billingFrom > windowStart || !bills.some((b) => b.period < windowStart));
  const firstStart = new Map<string, string>();
  for (const e of enrollments) if (e.start_date && (!firstStart.has(e.student_id) || e.start_date < firstStart.get(e.student_id)!)) firstStart.set(e.student_id, e.start_date);
  const billMonths = groupBy(bills, (b) => b.student_id, (b) => b.period);
  // 휴원 수강은 근거가 아니다 — 배정하자마자 휴원으로 돌린 학생이 7일 뒤 '시작한 등록'이 되지 않게(적대 재리뷰 2026-10-20 · 출석·청구가 있으면 그걸로).
  const classSpans = groupBy(
    enrollments.filter((e) => !!e.start_date && !e.on_hold),
    (e) => e.student_id,
    (e) => ({ start: e.start_date!, end: e.end_date }),
  );
  const judged = registered.filter((s) => s.enrolled_at!.slice(0, 7) >= billingFrom).map((s) => ({ id: s.id, enrolledAt: s.enrolled_at! }));
  // 출석은 결론이 안 난 등록만 본다 — 청구·반 수강으로 이미 시작했거나 '직전 두 달 청구'로 이미 아닌 등록은 빼고(출석 조회를 작게).
  const none = new Map<string, string[]>();
  const rest = judged.filter((r) => !billedBeforeRegistration(r, billMonths) && !startedRegistration(r, { billMonths, attendedOn: none, classSpans }, today));
  const since = rest.reduce<string | null>((m, r) => (!m || r.enrolledAt < m ? r.enrolledAt : m), null);
  const ev = { billMonths, attendedOn: since ? await attendedDays(db, tenantId, rest.map((r) => r.id), since) : none, classSpans };
  return {
    billingFrom,
    started: judged.filter((r) => startedRegistration(r, ev, today)).map((r) => r.id),
    trustFrom: visible || !mark ? trustedFrom(bills, firstStart, billingFrom, thisMonth, windowStart) : mark.trust_from,
    visible,
  };
}

/**
 * 출석한 날 — 정정은 새 줄로 쌓이므로(supersedes) 칸마다 **최신 기록**만 남긴 뒤 상태를 본다(정정 전 '출석' 줄이 근거가 되지 않게 —
 * 적대 재리뷰 2026-10-20). 학생 목록은 청크 + 페이지(B2·B3).
 */
async function attendedDays(db: Admin, tenantId: string, ids: string[], since: string): Promise<Map<string, string[]>> {
  const rows = await fetchAllPagedInChunks<{ id: string; student_id: string; class_id: string; session_date: string; slot_start: string | null; status: string; recorded_at: string }>(ids, (chunk, a, b) =>
    db
      .from("attendance_records")
      .select("id,student_id,class_id,session_date,slot_start,status,recorded_at")
      .eq("tenant_id", tenantId)
      .in("student_id", chunk)
      .gte("session_date", since.slice(0, 10))
      .order("id")
      .range(a, b),
  );
  const attended = effectiveAttendanceRecords(rows).filter((r) => ATTENDED_STATUSES.includes(r.status));
  return groupBy(attended, (r) => r.student_id, (r) => r.session_date);
}

type CoverageMark = { billing_from: string; trust_from: string | null };

/** 확정값(0386a) — 읽지 못하면 '없음'으로 넘어간다(시작이 창 안에 보이는 동안은 쓰지 않는 값이라 화면을 멈출 까닭이 없다). */
async function readCoverageMark(db: Admin, tenantId: string): Promise<CoverageMark | null> {
  const { data, error } = await db.from("record_coverage_marks").select("billing_from,trust_from").eq("tenant_id", tenantId).maybeSingle();
  if (error) {
    console.error(JSON.stringify({ level: "warn", scope: "record-coverage.mark", tenantId, message: error.message }));
    return null;
  }
  return (data as CoverageMark | null) ?? null;
}

/** 시작이 창 안에 보일 때만 판정값을 적어 둔다(원생 매일 기록 cron) — 보이지 않으면 손대지 않는다(창 밖 사실은 그때 적은 값이 진실). */
export async function saveCoverageMark(db: Admin, tenantId: string, coverage: RecordCoverage): Promise<void> {
  if (!coverage.visible || !coverage.billingFrom) return;
  const { error } = await db
    .from("record_coverage_marks")
    .upsert({ tenant_id: tenantId, billing_from: coverage.billingFrom, trust_from: coverage.trustFrom, decided_at: new Date().toISOString() }, { onConflict: "tenant_id" });
  if (error) throw new Error(`기록 범위 확정값 쓰기: ${error.message}`);
}
