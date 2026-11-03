import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canAccessTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { attendedCount } from "@/lib/calc/attendance";
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
  getStudentAttendanceStats,
  getStudentById,
  getStudentConsultationHistory,
  getStudentEnrollments,
  getStudentInvoices,
  getStudentLessonReportsPage,
  getStudentMemos,
  getStudentTimeline,
  type StudentEnrollment,
} from "@/features/students/server/queries";
import { DEFAULT_SECTOR, SECTOR_DEFS, monthDayKo, oneLine, othersLabel, type ExploreAside, type ExploreSector, type ExploreTarget } from "../model";
import { FLOW_KINDS } from "../flow-insight";
import { readFlowInsights, toFlowView } from "./flow-insights";
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
  const student = await getStudentById(id);
  if (!student) {
    if ((await accessLevelTenant(user.systemRole, "students")) === "scoped") {
      return forbidden("담당 학생만 열람할 수 있어요. 이 학생은 내 반(담임·교시 담당·임시 위임) 수강생이 아니거나, 수강이 끝난 지 오래됐어요.");
    }
    return NOT_FOUND;
  }
  const today = kstToday();
  // '수납'은 원생 권한이 아니라 **수납 권한**으로 잠근다(원생 상세와 같은 규칙) — 요약·건수도 내리지 않는다.
  const canSeeBilling = await canAccessTenant(user.systemRole, "billing");
  const [enrollments, attendance, grades, reports, consultations, memos, invoices, timeline, settings] = await Promise.all([
    settle("explore.student.enrollments", getStudentEnrollments(id)),
    settle("explore.student.attendance", getStudentAttendanceStats(id, 30)),
    settle("explore.student.grades", getStudentUnifiedRows(id)),
    settle("explore.student.reports", getStudentLessonReportsPage(id, { pageSize: 5 })),
    settle("explore.student.consultations", getStudentConsultationHistory(id)),
    settle("explore.student.memos", getStudentMemos(id)),
    canSeeBilling ? settle("explore.student.invoices", getStudentInvoices(id)) : Promise.resolve(null),
    settle("explore.student.timeline", getStudentTimeline(id)),
    getTenantSettings(),
  ]);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const base = `/students/${id}`;
  const [dClasses, dAttendance, dGrades, dProgress, dConsult, dMemos, dBilling, dTimeline] = SECTOR_DEFS.student;

  const sectors: ExploreSector[] = [
    classesSector(dClasses, enrollments, today, subjects.labelOf, base),
    (() => {
      if (!attendance.ok) return errorSector(dAttendance);
      const a = attendance.value;
      const attended = attendedCount({ present: a.present, late: a.late });
      return makeSector(dAttendance, {
        // 조각 안 문구는 짧게(원장 2026-11-03 *"멘트 짤리니까 … n% 정도로"*) — 횟수는 패널에.
        summary: a.total > 0 ? `최근 30일 ${a.rate.toFixed(0)}%` : "30일 기록 없음",
        state: a.total > 0 ? "ready" : "empty",
        rows: [
          { id: "rate", title: "출석률(출석+지각 ÷ 기록)", right: a.total > 0 ? `${a.rate.toFixed(1)}%` : "—" },
          { id: "attended", title: "출석한 횟수(지각 포함)", right: `${attended}회` },
          { id: "total", title: "기록", right: `${a.total}건` },
          { id: "present", title: "출석", right: `${a.present}건` },
          { id: "late", title: "지각", right: `${a.late}건` },
          { id: "absent", title: "결석", right: `${a.absent}건` },
          { id: "excused", title: "인정결석", right: `${a.excused}건` },
        ],
        links: [{ href: `${base}?tab=attendance`, label: "출결 탭 열기" }],
        note: "조회 기간은 오늘까지 최근 30일입니다.",
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
        rows: events.slice(0, 8).map((e, i) => ({ id: e.id ?? `${e.kind}-${e.date}-${i}`, title: e.title, date: e.date.slice(0, 10), detail: oneLine(e.description, 80) || null })),
        links: [{ href: `${base}?tab=timeline`, label: "타임라인 탭 열기" }],
        note: events.length > 8 ? `전체 ${events.length}건 중 최근 8건` : null,
      });
    })(),
  ];

  const status = studentStatusMeta(student.status);
  // 왼쪽 열 — 고정 사실 + AI 흐름 분석(저장된 결과만). 합산 분석은 모든 상담을 읽은 결과라 **원생상담을 전체로 보는 사람**(full·readonly)만
  // 본다 — 강사(scoped)는 자기 상담만 보는 사람이라 권한 없음으로.
  const consultLevel = await accessLevelTenant(user.systemRole, "consultations");
  const flowAllowed = consultLevel === "full" || consultLevel === "readonly";
  const flowRows = flowAllowed ? await settle("explore.student.flow", readFlowInsights(user.tenantId, id)) : null;
  const flow: NonNullable<ExploreAside["flow"]> = !flowAllowed
    ? { state: "denied", items: [], canRefresh: false }
    : !flowRows || !flowRows.ok
      ? { state: "error", items: [], canRefresh: false }
      : { state: "ready", items: FLOW_KINDS.map((k) => toFlowView(k, flowRows.value[k])), canRefresh: consultLevel === "full" };
  const currentClasses = enrollments.ok
    ? enrollments.value.filter((e) => ["active", "leaving"].includes(enrollmentPhaseOn({ startDate: e.startDate, endDate: e.endDate, isTransferred: e.isTransferred }, today)))
    : [];
  const aside: ExploreAside = {
    facts: [
      { label: "학교·학년", value: schoolGradeLabel(student.school, student.grade) || "—" },
      { label: "등록일", value: student.enrolledAt ?? "—" },
      { label: "담당 강사", value: [...new Set(currentClasses.map((e) => e.teacherName).filter((n): n is string => !!n))].join(" · ") || "—" },
      { label: "수강 과목", value: [...new Set(currentClasses.map((e) => subjects.labelOf(e.subject)))].join(" · ") || "—" },
      ...(student.parentName ? [{ label: "학부모", value: student.parentName }] : []),
    ],
    flow,
  };
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
      defaultSector: DEFAULT_SECTOR.student,
      asOf: today,
      aside,
    },
  };
}

function scoreText(g: UnifiedRow): string {
  if (g.noExam) return "시험없음";
  if (g.score == null) return g.rawScore || "—";
  return `${g.score}${g.maxScore == null ? "" : ` / ${g.maxScore}`}${scoreUnit(g)}`;
}

/**
 * '수업' 조각 — 현재 수강(오늘 명단 = active ∪ leaving) · 배정 예정 · 지난 수업을 **기존 뜻 그대로** 가른다
 * (판정 = `enrollmentPhaseOn` 단일 소스). 처음 화면은 현재 관계가 중심이고, 나머지는 패널 아래 묶음.
 */
function classesSector(
  def: (typeof SECTOR_DEFS.student)[number],
  enrollments: Settled<StudentEnrollment[]>,
  today: string,
  labelOf: (key: string) => string,
  base: string,
): ExploreSector {
  if (!enrollments.ok) return errorSector(def);
  const phaseOf = (e: StudentEnrollment) => enrollmentPhaseOn({ startDate: e.startDate, endDate: e.endDate, isTransferred: e.isTransferred }, today);
  const current = enrollments.value.filter((e) => ["active", "leaving"].includes(phaseOf(e)));
  const upcoming = enrollments.value.filter((e) => phaseOf(e) === "upcoming");
  const past = enrollments.value.filter((e) => phaseOf(e) === "ended").slice(0, 8);
  const toTarget = (e: StudentEnrollment, meta: string): ExploreTarget => ({
    kind: "class",
    id: e.classId,
    label: e.className,
    detail: [labelOf(e.subject), e.teacherName].filter(Boolean).join(" · ") || null,
    meta,
    badge: e.onHold ? { label: "휴원", color: "amber" } : null,
  });
  const groups: ExploreSector["groups"] = [];
  if (upcoming.length) groups.push({ label: "배정 예정", targets: upcoming.map((e) => toTarget(e, `${monthDayKo(e.startDate)}부터`)) });
  if (past.length) groups.push({ label: "지난 수업", targets: past.map((e) => toTarget(e, `~ ${enrollmentLastDate(e.endDate, e.isTransferred) ?? e.endDate ?? ""}`)) });
  const any = current.length + upcoming.length + past.length > 0;
  return makeSector(def, {
    summary: current.length > 0 ? othersLabel(current.map((e) => e.className), "개") : upcoming.length > 0 ? `배정 예정 ${upcoming.length}개` : "수강 중인 수업 없음",
    state: any ? "ready" : "empty",
    targets: current.map((e) => toTarget(e, e.onHold ? "휴원 중" : "수강 중")),
    groups,
    links: [{ href: `${base}?tab=classes`, label: "수업 탭 열기" }],
    note: `수강 중 ${current.length}개${upcoming.length ? ` · 배정 예정 ${upcoming.length}개` : ""}${past.length ? ` · 지난 수업은 최근 ${past.length}개만` : ""}`,
  });
}
