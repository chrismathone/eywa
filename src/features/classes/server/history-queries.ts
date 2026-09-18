import "server-only";
import { auditScoped, systemAuditScope, type SystemReadableAuditAction } from "@/features/audit/server/system-read";
import { createClient } from "@/lib/supabase/server";
import { auditActionLabel } from "@/features/audit/server/log";
import { auditActorName, auditDetail } from "@/features/audit/describe";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { historyWindowStart } from "../teacher-as-of";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import {
  buildEnrollmentHistory,
  buildScheduleHistory,
  mergeClassHistory,
  type ClassHistoryEntry,
  type EnrollmentHistoryRow,
  type HistorySlot,
} from "../history";

/**
 * 반 상세 '이력' — 여러 기록을 한 줄기로(원장 2026-08-04 *"각 수업의 상세화면에 '이력'란을 추가해"* +
 * *"로그 등 기록을 활용해서 최대한 이력 살릴 수 있는 부분은 전부 살릴것"*).
 *
 * 출처 3종(전부 **사실 기록**, 추론 없음):
 *  ① `class_schedules` 유효 구간 — 마감된 행이 곧 지난 배치다(실측 1,080행 중 493행이 이미 마감).
 *  ② `audit_logs` — 인수인계 예약/적용/취소, 종강·폐지·재운영, 위임, 강의실 자동배정(행위자 포함).
 *  ③ `class_delegations` — 임시 위임 기간.
 *
 * ⚠️ **보고서 작성 기록은 아직 안 넣었다.** `lesson_reports.teacher_name`이 "그 달 누가 썼나"를 알려주지만
 *    한 반의 보고서가 수천 행이라 상세 화면에서 전건을 끌면 느려진다(B2) — 월별 group-by RPC가 먼저다.
 *    게다가 그 값은 **작성자이지 담당이 아니다**(사무실 대리 작성이 설계된 동작, [[#93]]) — 넣을 땐
 *    '보고서 작성'으로 라벨을 갈라 담당 변경으로 읽히지 않게 할 것.
 * ⚠️ 감사로그 매칭은 `metadata->>'classId'` **또는** `target_label = 반 이름`이다 — 인수인계 로그가
 *    classId를 안 남기던 시절(실측: 반 로그 중 classId 보유 21건)이 있어서다. 이름 매칭은 개명하면
 *    끊기지만, 끊겨도 **없는 줄이 생길 뿐** 남의 반 이력이 섞이지는 않는다(같은 이름 반이 없다는 전제).
 */
/**
 * 반 이력에 싣는 감사로그 action — `target_type = "class"`로 실제로 쌓이는 것 전부(2026-09-09 전수 확인).
 * ⚠️ 반에 대한 새 감사 action을 만들면 여기와 `SYSTEM_READABLE_AUDIT_ACTIONS`에 함께 추가할 것
 *    (안 넣으면 그 줄만 이력에서 조용히 빠진다).
 */
const CLASS_HISTORY_ACTIONS: readonly SystemReadableAuditAction[] = [
  "class_update",
  "class_period_enrollments",
  "class_archive",
  "class_unarchive",
  "class_end_term",
  "class_reopen_term",
  "class_schedule_move",
  "class_handover_apply",
  "class_handover_schedule",
  "class_handover_cancel",
  "class_handover_bulk",
  "class_delegate",
  "class_delegate_revoke",
  "classroom_auto_assign",
];

export async function getClassHistory(classId: string): Promise<ClassHistoryEntry[]> {
  const supabase = await createClient();
  // 반 이름은 **구 감사로그 매칭 키**라 여기서 직접 읽는다(호출부가 이름을 넘기게 하면 상세 페이지의
  // Promise.all에 못 들어가 왕복이 직렬로 붙는다, B4).
  const { data: klass } = await supabase.from("classes").select("class_name").eq("id", classId).maybeSingle();
  const className = (klass?.class_name as string | null) ?? "";

  const [slotRows, auditRows, delegations, nameRows, reportRows, enrollmentRows] = await Promise.all([
    // 한 반의 슬롯 = 요일×교시×구간이라 수십~수백 행 상한. 마감 행까지 **전부** 가져온다(그게 이력이다).
    supabase
      .from("class_schedules")
      .select(
        "day_of_week, start_time, end_time, valid_from, valid_to, teacher_id, classroom_id, slot_teacher_label, slot_room_label",
      )
      .eq("class_id", classId)
      .order("valid_from", { ascending: false })
      .order("day_of_week"),
    // 이 반과 관련된 감사로그 — classId(신규) 또는 반 이름(구 로그) 매칭.
    // ⚠️ **실패해도 페이지를 죽이지 않는다.** 이력은 보조 정보인데 이 조회 하나로 반 상세가 통째로
    //    500이 나면 손해가 훨씬 크다(#95 계열). 대신 조용히 숨기지 않고 **아래에서 한 줄로 알린다**.
    fetchAllPaged<{
      action: string;
      actor_name: string | null;
      metadata: Record<string, unknown> | null;
      created_at: string;
    }>(async (from, to) => {
      // 🔴 감사로그는 **좁은 문**으로 읽는다 — 원장 2026-09-09 *"감사로그는 마스터 이상급으로만"* 으로
      //    정책을 좁혔기 때문에, 세션 클라로 읽으면 강사에게 이 이력이 통째로 빈다. 허용 목록은
      //    `target_type = "class"`로 실제로 쌓이는 12개를 **모두** 덮으므로 사라지는 줄은 없다.
      const scope = await systemAuditScope(CLASS_HISTORY_ACTIONS);
      if (!scope) return { data: [], error: null } as never;
      return auditScoped(
        scope.admin.from("audit_logs").select("action, actor_name, metadata, created_at"),
        scope,
      )
        .eq("target_type", "class")
        // 이름이 비면 classId만으로 — 빈 문자열을 or에 넣으면 라벨이 빈 남의 로그가 딸려온다.
        .or(
          className
            ? `metadata->>classId.eq.${classId},target_label.eq.${className}`
            : `metadata->>classId.eq.${classId}`,
        )
        .order("created_at", { ascending: false })
        .range(from, to) as never;
    }).catch(() => null),
    supabase
      .from("class_delegations")
      .select("delegate_user_id, from_date, to_date, reason, revoked_at, created_at")
      .eq("class_id", classId)
      .order("from_date", { ascending: false }),
    supabase.from("users").select("id, display_name"),
    // 보고서 작성 기록(추정 근거) — 창 안(TEACHER_HISTORY_MONTHS, 2026-09-07부터 12개월)만.
    // 반 하나로 좁힌 조회라(`class_id` 고정) 창을 넓혀도 가볍다 — 집계는 JS로 충분.
    supabase
      .from("lesson_reports")
      .select("report_date, teacher_name")
      .eq("class_id", classId)
      .gte("report_date", historyWindowStart(kstToday()))
      .order("report_date"),
    // 학생 배정 이력(원장 2026-08-18) — 이 반의 수강 **전 행**(지난 것 포함). 이력이라 전건이 필요해
    // fetchAllPaged(B2 — bare select는 1000행에서 조용히 잘린다). 실패해도 페이지는 안 죽인다(감사로그와 동일).
    fetchAllPaged<{
      start_date: string;
      end_date: string | null;
      is_transferred: boolean | null;
      is_transferred_in: boolean | null;
      students: { name?: string | null } | { name?: string | null }[] | null;
    }>((from, to) =>
      supabase
        .from("enrollments")
        .select("start_date, end_date, is_transferred, is_transferred_in, students!inner(name)")
        .eq("class_id", classId)
        // OFFSET 페이지가 흔들리지 않게 유니크 tie-break(batch.ts 규약) — id 2차 정렬.
        .order("start_date", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    ).catch(() => null),
  ]);

  const nameOf = new Map((nameRows.data ?? []).map((u) => [u.id as string, (u.display_name as string) ?? ""]));
  const roomRes = await supabase.from("classrooms").select("id, name");
  const roomOf = new Map((roomRes.data ?? []).map((r) => [r.id as string, (r.name as string) ?? ""]));

  // ① 배치 구간 — 표시 이름은 **슬롯 값 우선**(라벨이 시트 원문이라 FK 이름과 다를 수 있다).
  const slots: HistorySlot[] = (slotRows.data ?? []).map((r) => ({
    dayOfWeek: r.day_of_week as string,
    startTime: String(r.start_time),
    endTime: String(r.end_time),
    validFrom: (r.valid_from as string | null) ?? null,
    validTo: (r.valid_to as string | null) ?? null,
    teacherName:
      (r.slot_teacher_label as string | null) ??
      (r.teacher_id ? (nameOf.get(r.teacher_id as string) ?? null) : null),
    roomName:
      (r.slot_room_label as string | null) ??
      (r.classroom_id ? (roomOf.get(r.classroom_id as string) ?? null) : null),
  }));

  // ② 감사로그 — 한글 라벨·상세는 감사 화면과 **같은 단일 소스**(auditActionLabel/auditDetail)를 쓴다.
  // 과목 라벨은 설정 단일 소스(하드코딩 금지 규칙) — 반 이력에 과목 키가 나오는 로그는 없지만
  // auditDetail 계약이 요구하므로 같은 소스를 넘긴다.
  const subjects = buildSubjectMaps((await getTenantSettings()).operations.subjects);
  const ctx = {
    nameOf: (id: unknown) => (typeof id === "string" ? (nameOf.get(id) ?? null) : null),
    subjectLabel: (key: string) => subjects.labelOf(key),
  };
  const auditEntries: ClassHistoryEntry[] = (auditRows ?? []).map((l) => ({
    date: String(l.created_at).slice(0, 10),
    source: "audit" as const,
    title: auditActionLabel(l.action),
    detail: auditDetail(l.action, l.metadata ?? {}, ctx),
    // 실행자도 감사 화면과 같은 단일 소스 — `system:*` 스크립트 식별자를 그대로 내보내지 않는다.
    actor: auditActorName(l.actor_name),
  }));

  // ③ 임시 위임 — 담임은 안 바뀐 기간이라 배치 이력과 따로 읽혀야 한다.
  const delegationEntries: ClassHistoryEntry[] = (delegations.data ?? []).map((d) => ({
    date: String(d.from_date).slice(0, 10),
    endDate: d.to_date ? String(d.to_date).slice(0, 10) : null,
    source: "delegation" as const,
    title: d.revoked_at ? "임시 위임(해제됨)" : "임시 위임",
    detail: [
      nameOf.get(d.delegate_user_id as string) ?? null,
      d.reason ? String(d.reason) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  // ④ 보고서 작성 기록 — **추정 근거**라 라벨을 갈라 담당 변경으로 읽히지 않게 한다([[#93]]).
  // endDate = 그 달의 실제 마지막 작성일 — 월 버킷 날짜(`ym-01`)만 있으면 기간 검색이 "1일 하루"로
  // 오판해 8/10~ 검색에서 8월 버킷이 떨어진다(적대 리뷰). 구간으로 적어야 겹침 판정이 맞는다.
  const byMonth = new Map<string, Map<string, number>>();
  const lastReportOfMonth = new Map<string, string>();
  for (const r of reportRows.data ?? []) {
    const name = String(r.teacher_name ?? "").trim();
    if (!name) continue;
    const day = String(r.report_date).slice(0, 10);
    const ym = day.slice(0, 7);
    const m = byMonth.get(ym) ?? new Map<string, number>();
    m.set(name, (m.get(name) ?? 0) + 1);
    byMonth.set(ym, m);
    const prev = lastReportOfMonth.get(ym);
    if (!prev || day > prev) lastReportOfMonth.set(ym, day);
  }
  const reportEntries: ClassHistoryEntry[] = [...byMonth.entries()].map(([ym, names]) => {
    const sorted = [...names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
    return {
      date: `${ym}-01`,
      endDate: lastReportOfMonth.get(ym) ?? null,
      source: "report" as const,
      title: "보고서 작성 기록",
      // "담임"이라 쓰지 않는다 — 작성자다. 화면이 추정임을 알 수 있게 문구로 못박는다.
      detail: `${sorted.map(([n, c]) => `${n} ${c}건`).join(" · ")} (담임 추정 근거)`,
    };
  });

  // ⑤ 학생 배정 — 수강 행의 시작/종료를 시점 사건으로(조립 규칙은 순수 함수, 같은 날·같은 종류 묶음).
  const enrollmentEntries = buildEnrollmentHistory(
    (enrollmentRows ?? []).map((r): EnrollmentHistoryRow => {
      const s = r.students;
      const name = (Array.isArray(s) ? s[0]?.name : s?.name) ?? "";
      return {
        studentName: String(name),
        startDate: String(r.start_date ?? "").slice(0, 10),
        endDate: r.end_date ? String(r.end_date).slice(0, 10) : null,
        isTransferred: r.is_transferred === true,
        isTransferredIn: r.is_transferred_in === true,
      };
    }),
    kstToday(), // 미래 날짜(배정 예정·이동 적용일)는 "(예정)" 표기
  );

  // 감사로그·학생 배정을 못 읽었으면 **그 사실을 적는다** — 빈 목록으로 두면 "변경이 없었다"는 거짓말이 된다.
  const notice: ClassHistoryEntry[] =
    auditRows === null || enrollmentRows === null
      ? [
          {
            date: kstToday(),
            source: "audit" as const,
            title: "변경 기록 일부를 불러오지 못했습니다",
            detail: "배치 이력은 아래에 그대로 보입니다. 계속되면 알려주세요.",
          },
        ]
      : [];

  return mergeClassHistory([
    buildScheduleHistory(slots),
    auditEntries,
    delegationEntries,
    enrollmentEntries,
    reportEntries,
    notice,
  ]);
}
