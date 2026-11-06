import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canAccessTenant } from "@/lib/auth/perm-matrix";
import { addDays, kstToday } from "@/lib/date-kst";
import { attendanceRate, attendedCount } from "@/lib/calc/attendance";
import { attendanceStatusLabel, formatSlotStart } from "@/features/students/detail/attendance-tab";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { enrollmentLastDate, enrollmentPhaseOn } from "@/features/enrollments/eligibility";
import { invoiceOutstanding } from "@/features/billing/calc";
import { KIND_LABEL as GRADE_KIND_LABEL, scoreUnit, type UnifiedRow } from "@/features/grades/unified/model";
import { getStudentUnifiedRows } from "@/features/grades/unified/server/student-records";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { memoCategoryLabel } from "@/features/students/detail/memo-category";
import { studentStatusMeta } from "@/features/students/status/status-labels";
import {
  getStudentAttendanceFull,
  getStudentAttendanceStats,
  getStudentById,
  getStudentClassesDetail,
  getStudentConsultationHistory,
  getStudentEnrollments,
  getStudentInvoices,
  getStudentLessonReportsPage,
  getStudentMemos,
  getStudentTimeline,
  type StudentClassRow,
  type StudentEnrollment,
} from "@/features/students/server/queries";
import { DEFAULT_SECTOR, SECTOR_DEFS, monthDayKo, oneLine, subjectSectorKey, type ExploreRow, type ExploreSector, type ExploreTarget, type ExploreTone } from "../model";
import { FLOW_KINDS } from "../flow-insight";
import { readFlowInsights, toFlowView } from "./flow-insights";
import { buildStudentAnalysis, buildStudentAside, coverageOfSector, loadCoverageExtras } from "./student-aside";
import { careSummary, loadCareChecks } from "./student-care-sector";
import { contributionEnabled } from "./contribution";
import { getStudentCareForExplore } from "@/features/student-care/server/explore";
import { NOT_FOUND, deniedSector, errorSector, forbidden, makeSector, settle, won, type ExploreLoad, type Settled } from "./shared";

/**
 * 원생 중심 — 원생 상세 **개요 탭과 같은 조회**(getStudentAttendanceStats 30일 · getStudentEnrollments · getStudentUnifiedRows ·
 * getStudentInvoices · getStudentConsultationHistory · getStudentMemos)에 진도(수업보고서)·타임라인을 더한다.
 * 같은 숫자는 같은 함수에서 나온다 — 개요 탭 "최근 30일 출석률"과 여기 '출결' 조각은 한 값이다.
 * 열람 스코프는 `getStudentById`(강사 = 담당 학생만) 그대로.
 */
export async function loadStudentCenter(id: string): Promise<ExploreLoad> {
  const user = await getCurrentUser();
  if (!user) return forbidden("로그인이 필요합니다.");
  const today = kstToday();
  const since = addDays(today, -30);
  // 권한 둘은 요청 캐시(즉시) — 아래 묶음의 분기에 먼저 쓴다. '수납'은 원생 권한이 아니라 **수납 권한**으로 잠근다(원생 상세와 같은
  // 규칙 — 요약·건수도 내리지 않는다). 흐름 분석은 모든 상담을 읽은 결과라 **원생상담을 전체로 보는 사람**(full·readonly)만 —
  // 강사(scoped)는 자기 상담만 보는 사람이라 권한 없음으로.
  const [canSeeBilling, consultLevel] = await Promise.all([canAccessTenant(user.systemRole, "billing"), accessLevelTenant(user.systemRole, "consultations")]);
  const flowAllowed = consultLevel === "full" || consultLevel === "readonly";
  // 🔴 학생 조회·조각 조회·흐름 분석을 **한 묶음**으로(B4) — 학생 → 조각 묶음 → 흐름의 직렬 3단이 전환마다 왕복 둘을 더하고 있었다
  //    (2026-11-03 실측). 학생을 못 읽으면(없음 · 담당 밖) 나머지 결과는 버린다 — 조각 조회도 같은 RLS·게이트를 지나므로 새는 것이 없다.
  const [student, enrollments, attendance, grades, reports, consultations, memos, invoices, timeline, settings, classDetails, attendanceFull, flowRows, careChecks, hasContribution, coverageExtras, care] = await Promise.all([
    getStudentById(id),
    settle("explore.student.enrollments", getStudentEnrollments(id)),
    settle("explore.student.attendance", getStudentAttendanceStats(id, 30)),
    settle("explore.student.grades", getStudentUnifiedRows(id)),
    settle("explore.student.reports", getStudentLessonReportsPage(id, { pageSize: 5 })),
    settle("explore.student.consultations", getStudentConsultationHistory(id)),
    settle("explore.student.memos", getStudentMemos(id)),
    canSeeBilling ? settle("explore.student.invoices", getStudentInvoices(id)) : Promise.resolve(null),
    settle("explore.student.timeline", getStudentTimeline(id)),
    getTenantSettings(),
    // 반마다 요약(요일·교시·강의실·등원 요일) — 원생 상세 수업 탭과 같은 조회. 실패해도 조각은 선다(요약 줄만 빠진다).
    settle("explore.student.classDetails", getStudentClassesDetail(id)),
    // 출결 내역(날짜·반·상태) — 출결 탭과 같은 조회(정정 줄은 최신 하나만)를 **통계와 같은 30일 창**으로만. 영역 중심에서 '기록 33건'을 고르면
    // 이 목록이 요약함에 선다.
    settle("explore.student.attendanceFull", getStudentAttendanceFull(id, { since })),
    flowAllowed ? settle("explore.student.flow", readFlowInsights(user.tenantId, id)) : Promise.resolve(null),
    // 약속·할 일의 90일 점검 — 신규생 관리와 같은 조회·판정. 권한 없음·표 미적용·실패를 가른다(안에서).
    loadCareChecks(id, today),
    // 기여도는 원생 상세 '기여도' 탭과 같은 열쇠 — 꺼졌으면 카드에 기여도 줄 자체가 없다(점수는 page가 따로 늦게 채운다).
    contributionEnabled().catch(() => false),
    // 자료 연결 상태 중 이 화면이 내용을 안 싣는 원천(클래스노트 · 셔틀 · 오늘 수학)의 연결 여부.
    settle("explore.student.coverage", loadCoverageExtras(user.tenantId, id)),
    // 약속·인계(student-care) — 약속 관리 화면과 같은 문(강사 = 배정된 약속만). 표가 없으면 unavailable(SQL 미적용).
    getStudentCareForExplore(id).catch(() => ({ state: "error" as const, commitments: [], canManage: false, canContribute: false, careHref: `/students/${id}/care`, intake: null })),
  ]);
  if (!student) {
    if ((await accessLevelTenant(user.systemRole, "students")) === "scoped") {
      return forbidden("담당 학생만 열람할 수 있어요. 이 학생은 내 반(담임·교시 담당·임시 위임) 수강생이 아니거나, 수강이 끝난 지 오래됐어요.");
    }
    return NOT_FOUND;
  }
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const base = `/students/${id}`;
  const [dClasses, dAttendance, dGrades, dProgress, dConsult, dMemos, dBilling, dTimeline, dCare] = SECTOR_DEFS.student;

  const sectors: ExploreSector[] = [
    ...subjectSectors(dClasses, enrollments, today, subjects, base, classDetails.ok ? classDetails.value : []),
    (() => {
      if (!attendance.ok) return errorSector(dAttendance);
      const a = attendance.value;
      const attended = attendedCount({ present: a.present, late: a.late });
      // 요약함 재료(원장 2026-11-03 *"선택했을 때 자세히"*) — 같은 30일 창의 출결 내역(날짜·반·상태). 못 읽었으면 숫자만.
      const recs = attendanceFull.ok ? attendanceFull.value.filter((r) => r.date >= since) : null;
      const item = (r: NonNullable<typeof recs>[number]): ExploreRow => ({
        id: `${r.date}-${r.classId}-${r.slotStart ?? ""}`,
        title: r.className,
        date: r.date,
        right: attendanceStatusLabel(r.status),
        detail: [r.slotStart ? formatSlotStart(r.slotStart) : null, r.seatLabel, r.note].filter(Boolean).join(" · ") || null,
      });
      const pick = (pred: (status: string) => boolean) => (recs ? recs.filter((r) => pred(r.status)).map(item) : undefined);
      const byClass = recs
        ? [...new Set(recs.map((r) => r.className))].map((name) => {
            const rows = recs.filter((x) => x.className === name);
            const p = rows.filter((x) => x.status === "present").length;
            const l = rows.filter((x) => x.status === "late").length;
            return { id: `c:${name}`, title: name, right: `${attendanceRate(attendedCount({ present: p, late: l }), rows.length).toFixed(0)}%`, detail: `${rows.length}건 중 ${p + l}회 출석` } satisfies ExploreRow;
          })
        : undefined;
      return makeSector(dAttendance, {
        // 조각 안 문구는 짧게(원장 2026-11-03 *"멘트 짤리니까 … n% 정도로"*) — 횟수는 패널에.
        summary: a.total > 0 ? `최근 30일 ${a.rate.toFixed(0)}%` : "30일 기록 없음",
        state: a.total > 0 ? "ready" : "empty",
        rows: [
          // 제목은 꼭 필요한 말만(원장 2026-11-03 *"괄호 안에 자잘한 멘트 설명 필요 없어"*) — 산식은 아래 note 한 줄에.
          { id: "rate", title: "출석률", right: a.total > 0 ? `${a.rate.toFixed(1)}%` : "—", items: byClass },
          { id: "attended", title: "출석 횟수", right: `${attended}회`, items: pick((s) => s === "present" || s === "late") },
          { id: "total", title: "기록", right: `${a.total}건`, items: pick(() => true) },
          { id: "present", title: "출석", right: `${a.present}건`, items: pick((s) => s === "present") },
          { id: "late", title: "지각", right: `${a.late}건`, items: pick((s) => s === "late") },
          { id: "absent", title: "결석", right: `${a.absent}건`, items: pick((s) => s === "absent") },
          { id: "excused", title: "인정결석", right: `${a.excused}건`, items: pick((s) => s === "excused") },
        ],
        links: [{ href: `${base}?tab=attendance`, label: "출결 탭 열기" }],
        note: "오늘까지 최근 30일 · 출석률 = (출석+지각) ÷ 기록 · 출석 횟수는 지각 포함",
      });
    })(),
    (() => {
      if (!grades.ok) return errorSector(dGrades);
      const rows = [...grades.value].sort((a, b) => b.date.localeCompare(a.date));
      const latest = rows[0];
      return makeSector(dGrades, {
        summary: latest ? `${GRADE_KIND_LABEL[latest.kind]} ${scoreText(latest)}` : "성적 기록 없음",
        state: latest ? "ready" : "empty",
        rows: rows.slice(0, 6).map((g) => ({
          id: g.key,
          title: `${subjects.labelOf(g.subject)} ${GRADE_KIND_LABEL[g.kind]}`,
          right: scoreText(g),
          date: g.date,
          detail: g.classes.map((c) => c.name).join(" · ") || null,
        })),
        links: [{ href: `${base}?tab=grades`, label: "성적 탭 열기" }],
        note: rows.length > 6 ? `전체 ${rows.length}건 중 최근 6건` : null,
      });
    })(),
    (() => {
      if (!reports.ok) return errorSector(dProgress);
      const { rows, total } = reports.value;
      const latest = rows[0];
      return makeSector(dProgress, {
        summary: latest ? oneLine(latest.progress, 16) || `${monthDayKo(latest.reportDate)} 보고서` : "수업보고서 없음",
        state: latest ? "ready" : "empty",
        rows: rows.map((r) => ({
          id: r.id,
          title: oneLine(r.progress, 70) || "(진도 미기재)",
          date: r.reportDate,
          detail: [subjects.labelOf(r.subject), r.teacherName].filter(Boolean).join(" · ") || null,
          body: [r.progress, r.examInfo ? `시험 ${r.examInfo}` : null, r.homeworkScore ? `과제 ${r.homeworkScore}` : null].filter(Boolean).join("\n") || null,
        })),
        links: [{ href: `${base}?tab=progress`, label: "진도 탭 열기" }],
        note: total > 0 ? `수업보고서 ${total}건 중 최근 ${rows.length}건` : null,
      });
    })(),
    (() => {
      if (!consultations.ok) return errorSector(dConsult);
      const rows = consultations.value;
      const latest = rows[0];
      return makeSector(dConsult, {
        summary: latest ? `최근 상담 ${monthDayKo(latest.consultedAt)}` : "상담 기록 없음",
        state: latest ? "ready" : "empty",
        rows: rows.slice(0, 5).map((c) => ({
          id: c.id,
          title: oneLine(c.summary, 70),
          date: c.consultedAt.slice(0, 10),
          detail: [c.subject ? subjects.labelOf(c.subject) : null, c.counselorName].filter(Boolean).join(" · ") || null,
          // 전문 — `getStudentConsultationHistory`가 내부 연결 마커를 이미 뗀 글(visibleConsultationSummary).
          body: [c.summary, c.followUpAction ? `후속 조치: ${c.followUpAction}${c.followUpDate ? ` (${c.followUpDate})` : ""}${c.followUpDone ? " — 완료" : ""}` : null].filter(Boolean).join("\n\n"),
        })),
        links: [{ href: `${base}?tab=consultations`, label: "상담 탭 열기" }],
        note: rows.length > 5 ? `전체 ${rows.length}건 중 최근 5건` : null,
      });
    })(),
    (() => {
      if (!memos.ok) return errorSector(dMemos);
      const rows = [...memos.value].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
      return makeSector(dMemos, {
        summary: rows.length > 0 ? `메모 ${rows.length}건` : "특이사항 없음",
        state: rows.length > 0 ? "ready" : "empty",
        rows: rows.slice(0, 5).map((m) => ({
          id: m.id,
          title: oneLine(m.content, 70),
          date: m.createdAt.slice(0, 10),
          detail: [memoCategoryLabel(m.category), m.pinned ? "고정" : null, m.createdByName].filter(Boolean).join(" · "),
          body: m.content,
        })),
        links: [{ href: `${base}?tab=memos`, label: "특이사항 탭 열기" }],
      });
    })(),
    (() => {
      if (invoices === null) return deniedSector(dBilling);
      if (!invoices.ok) return errorSector(dBilling);
      const all = invoices.value;
      // 미납 = unpaid/partial만(refunded/void 제외) + 행 레벨 clamp — calc.ts 단일 공식(원생 개요·수납 KPI와 같다).
      const unpaid = all.filter((i) => i.status === "unpaid" || i.status === "partial");
      const unpaidTotal = unpaid.reduce((s, i) => s + invoiceOutstanding(i), 0);
      return makeSector(dBilling, {
        summary: all.length === 0 ? "청구 내역 없음" : unpaid.length === 0 ? "납부 완료" : `미납 ${unpaid.length}건`,
        state: all.length > 0 ? "ready" : "empty",
        rows: all.length === 0 ? [] : [
          { id: "count", title: "총 청구", right: `${all.length}건` },
          { id: "unpaid", title: "미납", right: unpaid.length === 0 ? "없음" : `${unpaid.length}건 · ${won(unpaidTotal)}원` },
          { id: "latest", title: "최근 청구 기간", right: all[0]?.period ?? "—" },
        ],
        links: [{ href: `${base}?tab=billing`, label: "수납 탭 열기" }],
      });
    })(),
    (() => {
      if (!timeline.ok) return errorSector(dTimeline);
      const events = [...timeline.value].sort((a, b) => b.date.localeCompare(a.date));
      const latest = events[0];
      return makeSector(dTimeline, {
        summary: latest ? `${monthDayKo(latest.date)} ${oneLine(latest.title, 8)}` : "활동 기록 없음",
        state: latest ? "ready" : "empty",
        rows: events.slice(0, 8).map((e, i) => ({
          id: e.id ?? `${e.kind}-${e.date}-${i}`,
          title: e.title,
          date: e.date.slice(0, 10),
          detail: [oneLine(e.description, 80) || null, e.registrant ? `처리 ${e.registrant}` : null].filter(Boolean).join(" · ") || null,
          body: e.description ?? null,
        })),
        links: [{ href: `${base}?tab=timeline`, label: "타임라인 탭 열기" }],
        note: events.length > 8 ? `전체 ${events.length}건 중 최근 8건` : null,
      });
    })(),
    // 약속·할 일(원장 2026-11-05 시안) — 입학 요구 · 약속·인계 · 신규생 90일 점검. 패널은 `care` 재료로 블록 셋을 그린다.
    makeSector(dCare, {
      summary: careSummary(careChecks, care.state === "ready" ? care.commitments.filter((c) => c.state === "open").length : null),
      // 조각 상태 = 둘 중 하나라도 읽었으면 ready(나머지는 패널 안에서 까닭별 문장). 둘 다 실패·권한 밖일 때만 그 상태.
      state: careChecks.state === "ready" || care.state === "ready" ? "ready" : careChecks.state === "error" && care.state === "error" ? "error" : careChecks.state === "denied" && care.state === "denied" ? "denied" : "empty",
      care: { studentId: id, checks: careChecks, commitments: care },
      links: careChecks.state === "denied" || careChecks.state === "off" ? [] : [{ href: "/newcomers", label: "신규생 관리 열기" }],
    }),
  ];

  const status = studentStatusMeta(student.status);
  // 오른쪽 아래 '분석·판단' — AI 흐름 분석(저장된 결과만 · 권한 판정은 위).
  const analysis = buildStudentAnalysis({
    allowed: flowAllowed,
    canRefresh: consultLevel === "full",
    rows: !flowRows ? null : flowRows.ok ? { ok: true, value: Object.fromEntries(FLOW_KINDS.map((k) => [k, toFlowView(k, flowRows.value[k])])) } : { ok: false },
  });
  // 자료 연결 상태(원장 2026-11-05 시안) — 이 화면이 읽은 원천은 그 조각 상태로, 내용을 안 싣는 원천은 연결 여부로(꺼진 기능·해당 없는 원천은 줄째 뺀다).
  const byKey = (k: string) => sectors.find((s) => s.key === k);
  const classSector = sectors.find((s) => s.key.startsWith("subject:") || s.key === "classes");
  const coverage = [
    { key: "classes", label: "수업·출결", state: classSector?.state === "error" || byKey("attendance")?.state === "error" ? ("failed" as const) : ("connected" as const) },
    { key: "grades", label: "성적", state: coverageOfSector(byKey("grades")) },
    { key: "progress", label: "수업보고서·진도", state: coverageOfSector(byKey("progress")) },
    { key: "consultations", label: "상담", state: coverageOfSector(byKey("consultations")) },
    { key: "memos", label: "특이사항", state: coverageOfSector(byKey("memos")) },
    { key: "billing", label: "수납", state: coverageOfSector(byKey("billing")) },
    { key: "timeline", label: "타임라인", state: coverageOfSector(byKey("timeline")) },
    {
      key: "care",
      label: "약속·인계",
      state: care.state === "ready" ? ("connected" as const) : care.state === "denied" ? ("restricted" as const) : care.state === "unavailable" ? ("pending" as const) : ("failed" as const),
    },
    ...(careChecks.state === "off" ? [] : [{
      key: "checks",
      label: "90일 점검",
      state: careChecks.state === "denied" ? ("restricted" as const) : careChecks.state === "error" ? ("failed" as const) : careChecks.state === "unavailable" ? ("pending" as const) : ("connected" as const),
    }]),
    ...(coverageExtras.ok ? coverageExtras.value : [{ key: "extras", label: "클래스노트·셔틀", state: "failed" as const }]),
  ];
  const aside = buildStudentAside({
    student,
    today,
    base,
    reportsTotal: reports.ok ? { ok: true, value: reports.value.total } : { ok: false },
    consultCount: consultations.ok ? { ok: true, value: consultations.value.length } : { ok: false },
    memoCount: memos.ok ? { ok: true, value: memos.value.length } : { ok: false },
    contribution: hasContribution,
    coverage,
  });
  // 아무 조각도 안 골랐을 때의 패널 = '수업'(과목마다 묶음 · 지금 수강만 — 원장 2026-11-05 시안 *"우측 상단은 수업이라 하고 그 안에 수강중인 반명"*).
  const subjectSecs = sectors.filter((s) => s.key.startsWith("subject:"));
  const panelDefault: ExploreSector | undefined =
    subjectSecs.length > 0
      ? { key: "classes", label: dClasses.label, icon: dClasses.icon, tone: dClasses.tone, summary: "", state: "ready", groups: subjectSecs.map((s) => ({ label: s.label, targets: s.targets ?? [] })), links: [{ href: `${base}?tab=classes`, label: "수업 탭 열기" }] }
      : undefined;
  return {
    state: "ready",
    model: {
      center: {
        kind: "student",
        id,
        name: student.name,
        subtitle: schoolGradeLabel(student.school, student.grade) || null,
        status: status ? { label: status.label, color: status.color } : null,
        icon: "user",
        detailHref: base,
        detailLabel: "원생 상세 열기",
      },
      sectors,
      // 첫 조각 = 첫 과목(수업) 조각 — 과목이 없으면 빈 '수업' 조각.
      defaultSector: sectors[0]?.key ?? DEFAULT_SECTOR.student,
      asOf: today,
      aside,
      analysis,
      panelDefault,
    },
  };
}

function scoreText(g: UnifiedRow): string {
  if (g.noExam) return "시험없음";
  if (g.score == null) return g.rawScore || "—";
  return `${g.score}${g.maxScore == null ? "" : ` / ${g.maxScore}`}${scoreUnit(g)}`;
}

/** 과목 색(학원 설정 PillColor) → 조각 색. */
const TONE_OF_PILL: Record<string, ExploreTone> = { primary: "primary", green: "green", gold: "gold", blue: "blue", purple: "purple", rose: "rose", amber: "amber", danger: "rose", neutral: "primary" };

/**
 * '수업' 조각 = **과목마다 한 조각**(원장 2026-11-03 *"다른 과목이면 n분할을 한 칸 더, 같은 과목이면 그 안에서 다시 n분할"*).
 * 같은 과목에 반이 둘 이상이면 그 조각을 `parts`로 다시 나눠 반마다 더블클릭 흡수의 단위가 된다. 현재 수강(오늘 명단 = active ∪ leaving) ·
 * 배정 예정 · 지난 수업은 **기존 뜻 그대로**(판정 = `enrollmentPhaseOn` 단일 소스) — 예정·지난 것은 그 과목 조각의 패널 아래 묶음.
 * 수강 중인 반이 하나도 없으면 빈 '수업' 조각 하나(예정·지난 수업은 거기에).
 */
function subjectSectors(
  def: (typeof SECTOR_DEFS.student)[number],
  enrollments: Settled<StudentEnrollment[]>,
  today: string,
  subjects: ReturnType<typeof buildSubjectMaps>,
  base: string,
  details: StudentClassRow[],
): ExploreSector[] {
  if (!enrollments.ok) return [errorSector(def)];
  const DAY_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
  /** 반 요약 줄(패널) — 수업 탭과 같은 재료(`getStudentClassesDetail`). 원장 2026-11-03 *"이 수업에 대한 정보를 대략적으로 요약"*. */
  const rowsOf = (e: StudentEnrollment): ExploreRow[] => {
    const d = details.find((x) => x.enrollmentId === e.id);
    const rooms = d ? [...new Set(d.slots.map((s) => s.room).filter((r): r is string => !!r))] : [];
    const schedule = d && d.schedule.length > 0 ? d.schedule.map((g) => `${g.days.join("·")} ${g.label}`).join(" / ") : null;
    return [
      { id: "subject", title: "과목 · 담임", right: [subjects.labelOf(e.subject), e.teacherName].filter(Boolean).join(" · ") },
      { id: "schedule", title: "요일 · 교시", right: schedule ?? "—" },
      { id: "room", title: "강의실", right: rooms.length > 0 ? rooms.join(" · ") : "—" },
      { id: "period", title: "수강 기간", right: `${e.startDate} ~ ${e.endDate ? (enrollmentLastDate(e.endDate, e.isTransferred) ?? e.endDate) : "현재"}` },
      ...(d && d.attendanceDays.length > 0 && d.attendanceDays.length < d.classDays.length
        ? [{ id: "days", title: "등원 요일", right: d.attendanceDays.map((x) => DAY_KO[x] ?? x).join("·") }]
        : []),
      ...(e.onHold ? [{ id: "hold", title: "상태", right: "휴원 중" }] : []),
    ];
  };
  const phaseOf = (e: StudentEnrollment) => enrollmentPhaseOn({ startDate: e.startDate, endDate: e.endDate, isTransferred: e.isTransferred }, today);
  const current = enrollments.value.filter((e) => ["active", "leaving"].includes(phaseOf(e)));
  const upcoming = enrollments.value.filter((e) => phaseOf(e) === "upcoming");
  const past = enrollments.value.filter((e) => phaseOf(e) === "ended").slice(0, 8);
  /** 반의 요일·교시 한 줄 — 수업 탭과 같은 재료. */
  const scheduleOf = (e: StudentEnrollment) => {
    const d = details.find((x) => x.enrollmentId === e.id);
    return d && d.schedule.length > 0 ? d.schedule.map((g) => `${g.days.join("·")} ${g.label}`).join(" / ") : null;
  };
  // 지금 수강 = "담임 박지훈 · 월·수·금 16:20~17:20"(원장 2026-11-05 시안 — 과목은 묶음 머리에만) · 예정·지난 = 과목 · 강사.
  const toTarget = (e: StudentEnrollment, meta: string | null, current = false): ExploreTarget => ({
    kind: "class",
    id: e.classId,
    label: e.className,
    detail: current
      ? [e.teacherName ? `담임 ${e.teacherName}` : null, scheduleOf(e)].filter(Boolean).join(" · ") || null
      : [subjects.labelOf(e.subject), e.teacherName].filter(Boolean).join(" · ") || null,
    meta,
    badge: e.onHold ? { label: "휴원", color: "amber" } : null,
  });
  const groupsFor = (subject: string | null): NonNullable<ExploreSector["groups"]> => {
    const pick = (xs: StudentEnrollment[]) => (subject === null ? xs : xs.filter((e) => e.subject === subject));
    const up = pick(upcoming);
    const old = pick(past);
    const out: NonNullable<ExploreSector["groups"]> = [];
    if (up.length) out.push({ label: "배정 예정", targets: up.map((e) => toTarget(e, `${monthDayKo(e.startDate)}부터`)) });
    if (old.length) out.push({ label: "지난 수업", targets: old.map((e) => toTarget(e, `~ ${enrollmentLastDate(e.endDate, e.isTransferred) ?? e.endDate ?? ""}`)) });
    return out;
  };
  const links = [{ href: `${base}?tab=classes`, label: "수업 탭 열기" }];
  if (current.length === 0) {
    const groups = groupsFor(null);
    return [
      makeSector(def, {
        summary: upcoming.length > 0 ? `배정 예정 ${upcoming.length}개` : "수강 중인 수업 없음",
        state: groups.length > 0 ? "ready" : "empty",
        groups,
        links,
        note: upcoming.length ? `배정 예정 ${upcoming.length}개` : past.length ? `지난 수업 최근 ${past.length}개` : null,
      }),
    ];
  }
  // 과목 순서 = 학원 설정 과목 순서(없는 키는 뒤).
  const order = new Map(subjects.options.map((o, i) => [o.value, i]));
  const bySubject = new Map<string, StudentEnrollment[]>();
  for (const e of current) bySubject.set(e.subject, [...(bySubject.get(e.subject) ?? []), e]);
  return [...bySubject.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
    .map(([subject, classes]) => {
      const targets = classes.map((e) => toTarget(e, null, true));
      return {
        key: subjectSectorKey(subject),
        label: subjects.labelOf(subject),
        icon: def.icon,
        tone: TONE_OF_PILL[subjects.colorOf(subject)] ?? def.tone,
        summary: classes.length === 1 ? classes[0].className : `${classes.length}개 반`,
        state: "ready",
        targets,
        // 조각엔 수업명만(담임 이름은 패널에 — 원장 2026-11-03 *"수업은 수업명만 표시하면 될듯"*). 휴원 중인 반만 표식.
        parts: classes.map((e, i) => ({ key: e.classId, label: e.className, summary: e.onHold ? "휴원 중" : "", target: targets[i], rows: rowsOf(e) })),
        groups: groupsFor(subject),
        links,
        // "수강 중 N개" 안내줄은 뺐다(원장 2026-11-05 — 개수는 머리 알약 "총 N개" 한 곳).
        note: null,
      } satisfies ExploreSector;
    });
}
