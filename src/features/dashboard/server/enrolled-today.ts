import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { kstDateOf, kstTimeOf, kstToday } from "@/lib/date-kst";
import { auditScoped, systemAuditScope } from "@/features/audit/server/system-read";
import { countAssignedClasses } from "@/features/enrollment/server/assigned-classes";
import { kstDayBounds } from "@/features/enrollment/kst-bounds";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { assignedEntryAt, enrolledRecentFrom } from "@/features/dashboard/overview/enrolled-recent";

export type EnrolledTodayRow = {
  /** 콜&상담 id. */
  id: string;
  name: string;
  schoolGrade: string | null;
  /** 등록 완료로 옮긴 날(KST YYYY-MM-DD) — 창 안에서 마지막으로 옮긴 날. 어제·이번 달을 이 값으로 가른다. */
  date: string | null;
  /** 등록 완료로 옮긴 시각(KST HH:MM) — 창 안에서 마지막으로 옮긴 때. */
  time: string | null;
  /** 칸반 '반 배정 완료'와 같은 판정(`countAssignedClasses`). */
  assigned: boolean;
  /** 상담 과목 키(안 골랐으면 null) — 과목 관리자 카드가 담당 과목으로 거른다. */
  subject: string | null;
};

type OutcomeLog = { metadata: { consultationId?: unknown; to?: unknown } | null; created_at: string };

/**
 * 운영실 KPI **'전일 / 이달 신규'**(원장 2026-09-23 '금일 등록' → 2026-10-21 *"전일 신규생 및 / 이달의 신규생 다나오는걸로"*) —
 * **어제부터 오늘까지 · 이번 달**(`enrolledRecentFrom`) 콜&상담 상태를 '등록 완료'(outcome=enrolled)로 옮긴 상담.
 * 카드 숫자와 팝업이 **같은 배열**이고, 어제·이번 달 가르기는 `splitEnrolledRecent` 하나다.
 *
 * 🔑 옮긴 시각은 컬럼이 없어 **상태 변경 감사로그**(`enrollment_consultation_outcome`, to=enrolled)에서 읽는다 —
 *    칸반 드래그·상세 '상태 변경'(`setEnrollmentOutcome`)과 '수업 배정'(상담→원생 전환)이 둘 다 이 로그를 남긴다.
 * 🔴 **지금도 등록 완료인 상담만** 센다(오늘 옮겼다가 '미등록'으로 되돌린 건은 빠진다).
 * 🔴 반 배정 여부는 칸반 카드 표식과 **같은 함수**(`countAssignedClasses`) — 갈리면 카드와 칸반이 다른 말을 한다.
 * 🔴 **반 배정으로 '등록 완료' 칸에 선 상담도 센다**(원장 2026-10-22 *"KPI 일치하지 않는건에 대해 KPI 일치시킬것"* — 칸반 10월 등록 완료 3 ·
 *    카드 2: 장윤건은 QR 자동 연결 뒤 반이 배정돼 칸반엔 섰는데 상태 로그가 없어 빠졌다). 그 때 = 그 과목 반에 처음 배정된 때
 *    (`assignedEntryAt` — 칸반 `stageOfCard`와 같은 판정 · 반 이동으로 새 수강이 생겨도 다시 세지 않는다).
 */
export async function getEnrolledRecent(today: string): Promise<EnrolledTodayRow[]> {
  const scope = await systemAuditScope(["enrollment_consultation_outcome"]);
  if (!scope) return [];
  const { startIso } = kstDayBounds(enrolledRecentFrom(today));
  const { endIso } = kstDayBounds(today);
  const logs = await fetchAllPaged<OutcomeLog>((from, to) =>
    auditScoped(scope.admin.from("audit_logs").select("metadata, created_at"), scope)
      .eq("metadata->>to", "enrolled")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at")
      .order("id")
      .range(from, to),
  );
  // 상담마다 창 안에서 **마지막으로** 등록 완료로 옮긴 시각(같은 상담을 두 번 옮겨도 한 줄).
  const movedAt = new Map<string, string>();
  for (const log of logs) {
    const id = log.metadata?.consultationId;
    if (typeof id === "string" && log.metadata?.to === "enrolled") movedAt.set(id, log.created_at);
  }

  const db = await createClient();
  type Row = {
    id: string;
    prospect_name: string | null;
    prospect_school: string | null;
    prospect_grade: string | null;
    subject: string | null;
    student_id: string | null;
    outcome: string;
  };
  // 상태 로그 쪽 상담과 반 배정으로 선 상담(상태는 등록 완료가 아니다 — 겹치지 않는다)을 함께 읽는다(B4 · 한쪽 실패가 다른 쪽을 떠돌게 두지 않는다).
  const [rows, viaAssignment] = await Promise.all([
    movedAt.size === 0
      ? Promise.resolve([] as Row[])
      : fetchInChunks<Row>([...movedAt.keys()], (chunk) =>
          db
            .from("enrollment_consultations")
            .select("id, prospect_name, prospect_school, prospect_grade, subject, student_id, outcome")
            .in("id", chunk),
        ),
    assignedEntries(db, startIso, endIso),
  ]);
  const current = rows.filter((row) => row.outcome === "enrolled");
  const assigned = await Promise.all(current.map((row) => countAssignedClasses(db, row.student_id, row.subject || null)));
  return listRows([
    ...current.map((row, i) => ({ row, at: movedAt.get(row.id) ?? "", assigned: assigned[i]! > 0 })),
    ...viaAssignment.map(({ row, at }) => ({ row, at, assigned: true })),
  ]);
}

type ConsultRow = {
  id: string;
  prospect_name: string | null;
  prospect_school: string | null;
  prospect_grade: string | null;
  subject: string | null;
  student_id: string | null;
  outcome: string;
};

/** 화면 줄 — 최근에 등록 완료가 된 것부터(신규문의 팝업과 같은 방향). */
function listRows(items: readonly { row: ConsultRow; at: string; assigned: boolean }[]): EnrolledTodayRow[] {
  return [...items]
    .sort((a, b) => b.at.localeCompare(a.at) || a.row.id.localeCompare(b.row.id))
    .map(({ row, at, assigned }) => ({
      id: row.id,
      name: row.prospect_name?.trim() || "(이름 미상)",
      schoolGrade: schoolGradeLabel(row.prospect_school, row.prospect_grade) || null,
      date: kstDateOf(at),
      time: kstTimeOf(at),
      assigned,
      subject: row.subject || null,
    }));
}

/**
 * 창 안에 **반 배정으로** '등록 완료' 칸에 선 상담(상태는 등록 완료가 아닌 것 — 원장 2026-10-22 KPI 일치).
 * 후보 = 창 안에 반에 배정된 학생의 상담 + 창 안에 들어온 상담(이미 다니던 학생의 새 상담) — 이번 달 활동만 읽어 30초 갱신에 무겁지 않게.
 * 그 학생의 수강 전부(끝난 것 포함)로 '처음 배정된 때'를 정한다(`assignedEntryAt`). 조회 실패는 던진다(0건으로 위장하지 않는다).
 */
async function assignedEntries(
  db: Awaited<ReturnType<typeof createClient>>,
  startIso: string,
  endIso: string,
): Promise<{ row: ConsultRow; at: string }[]> {
  const cols = "id, prospect_name, prospect_school, prospect_grade, subject, student_id, outcome, created_at";
  type Candidate = ConsultRow & { created_at: string };
  const [assignedInWindow, consultsInWindow] = await Promise.all([
    fetchAllPaged<{ student_id: string }>((from, to) =>
      db.from("enrollments").select("student_id").gte("created_at", startIso).lt("created_at", endIso).order("id").range(from, to),
    ),
    fetchAllPaged<Candidate>((from, to) =>
      db
        .from("enrollment_consultations")
        .select(cols)
        .neq("outcome", "enrolled")
        .not("student_id", "is", null)
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .order("id")
        .range(from, to),
    ),
  ]);
  const ofStudents = await fetchInChunks<Candidate>([...new Set(assignedInWindow.map((e) => e.student_id))], (chunk) =>
    db.from("enrollment_consultations").select(cols).neq("outcome", "enrolled").in("student_id", chunk),
  );
  const consults = new Map<string, Candidate>([...consultsInWindow, ...ofStudents].map((c) => [c.id, c]));
  if (consults.size === 0) return [];
  type Enr = { student_id: string; created_at: string; end_date: string | null; class: { subject: string | null } | { subject: string | null }[] | null };
  const enrollments = await fetchAllPagedInChunks<Enr>(
    [...new Set([...consults.values()].map((c) => c.student_id!))],
    (chunk, from, to) =>
      db
        .from("enrollments")
        // 칸반 배지와 같은 반 조인(`assignedQuery` — `class:class_id!inner`).
        .select("student_id, created_at, end_date, class:class_id!inner ( subject )")
        .in("student_id", chunk)
        .order("id")
        .range(from, to),
  );
  const byStudent = new Map<string, { subject: string | null; createdAt: string; endDate: string | null }[]>();
  for (const e of enrollments) {
    const klass = Array.isArray(e.class) ? e.class[0] : e.class;
    const list = byStudent.get(e.student_id) ?? [];
    list.push({ subject: klass?.subject ?? null, createdAt: e.created_at, endDate: e.end_date });
    byStudent.set(e.student_id, list);
  }
  const today = kstToday();
  const lo = Date.parse(startIso);
  const hi = Date.parse(endIso);
  return [...consults.values()].flatMap((c) => {
    const at = assignedEntryAt({ consultCreatedAt: c.created_at, subject: c.subject || null, enrollments: byStudent.get(c.student_id!) ?? [], today });
    if (!at) return [];
    const t = Date.parse(at);
    return t >= lo && t < hi ? [{ row: c, at }] : [];
  });
}
