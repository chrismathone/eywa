import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TipCard } from "@/components/hover-tip/tip";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteSendOn } from "@/features/owner/classnote-gate";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { isReportOptout } from "@/features/classes/report-optout";
import { isClassnoteSubjectEnabled } from "@/features/onescreen/classnote-guard";
import {
  classifyBoardMissing,
  isSendCandidateClass,
  isSendClassRouteRow,
  liveBoardClassIdsOf,
  type BoardMissingKind,
} from "@/features/onescreen/send-class";
import { absenceKeyOf, getAbsenceBlockedKeys, type AbsenceKey } from "@/features/onescreen/server/absence-gate";
import { isMathReportPilot } from "@/features/onescreen/math-report-pilot";
import { makeupUncheckedIds } from "@/features/attendance/server/makeup-check-gate";
import { hasSendableMent } from "../unsent-sendable";
import { unsentReasonCard } from "../unsent-reason";

/** 한 번에 설명하는 보고서 수 상한 — 목록 한 페이지(30건)면 충분하다. */
export const UNSENT_REASON_MAX = 60;

type ReportRow = {
  id: string;
  student_id: string;
  class_id: string | null;
  makeup: boolean | null;
  makeup_class_id: string | null;
  subject: string | null;
  report_date: string;
  teacher_name: string | null;
  notes: string | null;
  progress: string | null;
  classnote_deadline_exempt_at: string | null;
  /** 멘트 작성 방식(0214a) — 새 수학 보고서는 자동작성(auto·auto_edited)이어야 보낸다(서버 발송 겹과 같은 재료). */
  ment_source: string | null;
};
type ClassRow = { id: string; subject: string | null; is_active: boolean | null; report_optout: boolean | null; closed_at: string | null };
type MemberRow = { class_id: string; student_id: string; status: string | null; reason: string | null };
type EnrollmentRow = { student_id: string; class_id: string; start_date: string | null; end_date: string | null };

/**
 * 보고서 목록 '미발송' 칸 카드 재료(원장 2026-11-04) — **화면에 보이는 줄의 보고서만**, 그 반·학생만 읽는다.
 *
 *  · 권한은 목록과 같다 — 호출부(라우트)가 `listReports`와 같은 게이트를 지난 뒤 부른다. 조회는 사용자 클라이언트(RLS — 그 지점 행만).
 *  · 미발송(발송 이력 없음 · 이관분 아님)만 설명한다. 그 밖의 id는 조용히 건너뛴다.
 *  · 반 보드 판정은 원스크린 발송 막힘 안내(`explainBoardMissing`)와 같은 재료·같은 함수(`liveBoardClassIdsOf` → `classifyBoardMissing`)를
 *    줄 묶음으로 — 반별 발송 대상 수학 보고서만(`isSendClassRouteRow`). 반 보드 기록의 다른 학생 줄은 반 전체 기록 수에만 쓰고
 *    밖으로 내보내지 않는다.
 *  · 큰 `.in()`은 청크(B3) · 반 × 학생 기록은 청크 × 페이징(B2) · 서로 독립인 조회는 한꺼번에(B4).
 * 조회 실패는 throw — 라우트가 500으로 답하고 화면은 카드 없이 '미발송'만 그대로 둔다.
 */
export async function loadUnsentReasonCards(
  tenantId: string,
  reportIds: readonly string[],
  supabaseIn?: SupabaseClient,
): Promise<Record<string, TipCard>> {
  const ids = [...new Set(reportIds)].slice(0, UNSENT_REASON_MAX);
  if (!ids.length) return {};
  const supabase = supabaseIn ?? (await createClient());
  const today = kstToday();
  const [reports, settings] = await Promise.all([
    fetchInChunks<ReportRow>(ids, (chunk) =>
      supabase
        .from("lesson_reports")
        .select(
          "id, student_id, class_id, makeup, makeup_class_id, subject, report_date, teacher_name, notes, progress, classnote_deadline_exempt_at, ment_source",
        )
        .eq("tenant_id", tenantId)
        .in("id", chunk)
        .is("classnote_status", null)
        .or("source.is.null,source.neq.edutrix_import"),
    ),
    getTenantSettings(),
  ]);
  if (!reports.length) return {};

  // 반 보드를 볼 반 = 반이 있으면 그 반(정규 · 합침 정규+보강), 반 없는 보강 줄은 보강 반(= 발송 반 · 0171a).
  // 🔴 실제 발송 경로와 같은 순서 — 원스크린 서버(`saveAndQueueClassnote` 반 있음 = 정규 반 보드)·관리자 경로(send-class.ts
  //    `if (r.classId) return { pass: r.classLive }`) 모두 반이 있으면 그 반을 본다(합침 줄은 makeup=true지만 반이 있다 · 리뷰 2026-11-04).
  const boardClassOf = (r: ReportRow) => r.class_id ?? r.makeup_class_id ?? null;
  // 반 없는 보강 줄인가 — 원스크린 `isMakeupRow`(actions.ts `!!input.makeup && !input.classId`)와 같은 정의.
  const isMakeupOnlyRow = (r: ReportRow) => !!r.makeup && !r.class_id;
  const classIds = [...new Set(reports.flatMap((r) => [r.class_id, r.makeup_class_id]).filter((x): x is string => !!x))];
  const studentIds = [...new Set(reports.map((r) => r.student_id))];
  const dates = [...new Set(reports.map((r) => r.report_date))];
  // 결석 = 발송 게이트와 같은 판정(보강 보고서는 결석 게이트 밖 — 발송 경로와 같은 규약).
  const absenceKeys: AbsenceKey[] = reports
    .filter((r) => !r.makeup)
    .map((r) => ({ studentId: r.student_id, reportDate: r.report_date, subject: r.subject, classId: r.class_id }));

  const [classes, links, members, students, enrollments, absentKeys, attendance, makeupUnchecked] = await Promise.all([
    fetchInChunks<ClassRow>(classIds, (chunk) =>
      supabase.from("classes").select("id, subject, is_active, report_optout, closed_at").eq("tenant_id", tenantId).in("id", chunk),
    ),
    fetchInChunks<{ class_id: string }>(classIds, (chunk) =>
      supabase.from("classnote_class_boards").select("class_id").eq("tenant_id", tenantId).in("class_id", chunk),
    ),
    fetchAllPagedInChunks<MemberRow>(classIds, (chunk, from, to) =>
      supabase
        .from("classnote_class_board_members")
        .select("class_id, student_id, status, reason")
        .eq("tenant_id", tenantId)
        .in("class_id", chunk)
        .order("id")
        .range(from, to),
    ),
    fetchInChunks<{ id: string; status: string | null; is_test: boolean | null }>(studentIds, (chunk) =>
      supabase.from("students").select("id, status, is_test").eq("tenant_id", tenantId).in("id", chunk),
    ),
    // 반이 하나도 없으면(반 없는 보강 등) 반 보드 판정 재료가 필요 없다 — 조회하지 않는다. 반은 아래에서 거른다
    // (학생 청크에 반 id 목록까지 실으면 주소가 길어진다 — B3. 학생 한 명의 수강은 몇 줄뿐이다).
    classIds.length
      ? fetchAllPagedInChunks<EnrollmentRow>(studentIds, (chunk, from, to) =>
          supabase
            .from("enrollments")
            .select("student_id, class_id, start_date, end_date")
            .eq("tenant_id", tenantId)
            .in("student_id", chunk)
            .order("id")
            .range(from, to),
        )
      : Promise.resolve([] as EnrollmentRow[]),
    getAbsenceBlockedKeys(supabase, tenantId, absenceKeys),
    // 출결 미체크 = 그날 그 반에 그 학생 출결 기록이 하나도 없다(강사 발송 경로의 `hasAnyAttendance`와 같은 판정을 줄 묶음으로).
    fetchAllPagedInChunks<{ student_id: string; class_id: string; session_date: string }>(studentIds, (chunk, from, to) =>
      supabase
        .from("attendance_records")
        .select("student_id, class_id, session_date")
        .eq("tenant_id", tenantId)
        .in("student_id", chunk)
        .in("session_date", dates)
        .order("id")
        .range(from, to),
    ),
    // 보강 진행 여부 확인 전 — 관리자 일괄 발송과 같은 묶음 판정(보강이 든 행만 묻는다 · 실패하면 막지 않는 쪽).
    makeupUncheckedIds(tenantId, reports),
  ]);

  const classById = new Map(classes.map((c) => [c.id, c]));
  const linked = new Set(links.map((l) => l.class_id));
  const studentById = new Map(students.map((s) => [s.id, s]));
  const attended = new Set(attendance.map((a) => `${a.student_id}|${a.class_id}|${a.session_date.slice(0, 10)}`));
  const membersOfClass = new Map<string, MemberRow[]>();
  for (const m of members) membersOfClass.set(m.class_id, [...(membersOfClass.get(m.class_id) ?? []), m]);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const sendOn = classnoteSendOn(settings);

  /** 반 보드가 없어 막힌 까닭 — 살아 있는 반 보드가 있으면 null(막히지 않았다). */
  const boardFor = (r: ReportRow): { kind: BoardMissingKind; holdReason: string | null; makeup: boolean } | null => {
    if (!isSendClassRouteRow(settings, r)) return null;
    const classId = boardClassOf(r);
    if (!classId) return null; // 반 미정 보강은 보낼 때 반을 고른다 — 막힌 것이 아니다
    const c = classById.get(classId);
    const mine = (membersOfClass.get(classId) ?? []).filter((m) => m.student_id === r.student_id);
    const eligible = c && c.is_active && !c.report_optout && (c.subject === "math" || c.subject === "subject_1") ? [classId] : [];
    const live = liveBoardClassIdsOf(eligible, [...linked], mine.map((m) => ({ classId: m.class_id, status: m.status })));
    if (live.includes(classId)) return null;
    const st = studentById.get(r.student_id);
    const rows = enrollments.filter((e) => e.student_id === r.student_id && e.class_id === classId);
    const holdReason = mine.find((m) => m.status !== "ok")?.reason ?? null;
    const kind = classifyBoardMissing({
      liveNow: rows.some((e) => (!e.start_date || e.start_date <= today) && (!e.end_date || e.end_date >= today)),
      ended: rows.some((e) => !!e.end_date && e.end_date < today),
      syncTarget:
        !!c && isSendCandidateClass(c, today) && !!st && st.status === "enrolled" && !st.is_test,
      classLinked: linked.has(classId),
      classMemberCount: (membersOfClass.get(classId) ?? []).length,
      memberStatuses: mine.map((m) => m.status),
      holdReason,
    });
    return { kind, holdReason, makeup: isMakeupOnlyRow(r) };
  };

  const out: Record<string, TipCard> = {};
  for (const r of reports) {
    const klass = r.class_id ? classById.get(r.class_id) : undefined;
    out[r.id] = unsentReasonCard({
      reportDate: r.report_date,
      today,
      deadlineExempt: !!r.classnote_deadline_exempt_at,
      sendOn,
      subjectOk: isClassnoteSubjectEnabled(r.subject, settings.report.classnoteSubjects),
      subjectLabel: r.subject ? subjects.labelOf(r.subject) : "",
      gate: {
        reportOptout: !!klass && isReportOptout(klass),
        isAbsent: !r.makeup && absentKeys.has(absenceKeyOf({ studentId: r.student_id, reportDate: r.report_date, subject: r.subject, classId: r.class_id })),
        hasProgress: !!r.progress?.trim(),
        hasMent: hasSendableMent(r.notes),
        // 강사 발송 경로와 같다 — 반 있는 정규 보고서만(보강·반 없는 보고서는 어느 반 출결을 볼지 정할 수 없다).
        attendanceUnchecked: !r.makeup && !!r.class_id && !attended.has(`${r.student_id}|${r.class_id}|${r.report_date}`),
        // 서버 발송 겹(`saveAndQueueClassnote`)과 같은 판정 — 새 수학 보고서는 자동작성 글이어야 보낸다.
        needsAutoWrite: isMathReportPilot(r.student_id, r.subject) && r.ment_source !== "auto" && r.ment_source !== "auto_edited",
        needsMakeupCheck: makeupUnchecked.has(r.id),
      },
      board: boardFor(r),
    });
  }
  return out;
}
