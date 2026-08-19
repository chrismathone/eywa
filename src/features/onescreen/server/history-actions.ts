"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { viewAsTeacher } from "@/lib/auth/view-mode";
import { getTenantSettings } from "@/features/owner/server/queries";
import { fetchInChunks } from "@/lib/supabase/batch";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { classnoteMinDate } from "../classnote-guard";

/**
 * 원스크린 "지난 보고서" 뷰 — 로그인 강사 **본인이 쓴** 보고서 이력(날짜 내림차순, 커서 페이징).
 * 귀속 = lesson_reports.teacher_name(저장 시 displayName 기록, saveLessonReport와 동일 기준) →
 * 본인 것만 조회(타 강사 데이터 누수 없음). RLS가 tenant 격리.
 * B2: limit 고정 페이징(무페이징 전건 fetch 아님). 열람수는 기존 roster 패턴(fetchInChunks + JS 집계).
 */

export type PastReportRow = {
  id: string;
  reportDate: string; // YYYY-MM-DD
  studentId: string;
  studentName: string;
  studentLabel: string; // "경명여중1" 압축 표기(schoolGradeLabel) — 동명이인 구분
  subject: string | null; // 과목키 — 클라가 labelOf로 한글화
  progress: string | null;
  examInfo: string | null;
  homeworkScore: string | null;
  classnoteStatus: string | null; // 클라가 classnoteBadge로 한글화
  shareToken: string | null;
  revoked: boolean;
  viewCount: number; // 학부모 열람 수
  /**
   * **지금 발송하면 실제로 나가는가** — 월간 달력 RPC(0128a)의 sendable과 **같은 4조건**(이관분 아님·
   * 미취소·과목 opt-in·기한 내)을 행 단위로 계산(#77: 행동 라벨은 그 행동의 기존 게이트 재사용).
   * 미발송(unsent)과 조합해 "보낼 수 있음" 라벨에만 쓴다 — 분모·재촉 집계에 쓰지 말 것(0128a 주석).
   */
  sendable: boolean;
};

const PAGE_ROWS = 200; // 한 페이지 최대 행(강사 하루 수십 건 기준 수 주 분량)

export async function getMyPastReports(input?: {
  /** 이 날짜(YYYY-MM-DD) **미만**만 — "더 보기" 커서. 없으면 최신부터. */
  before?: string;
  /** 이 날짜(YYYY-MM-DD) **하루만** — 월간 달력에서 날짜를 눌렀을 때. `before`보다 우선. */
  on?: string;
}): Promise<{ ok: boolean; rows?: PastReportRow[]; hasMore?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  // '다른 강사 뷰'(열람 전용)면 그 강사의 이력을 보여준다 — 로스터와 같은 축(안 맞추면 열람자 본인의
  // 빈 이력이 나와 "이 강사는 발송을 안 했다"로 오독된다). 이름이 비면 정직하게 거절(빈 이름 행 매칭 방지).
  const viewAs = await viewAsTeacher();
  const teacherName = (viewAs ? viewAs.displayName : user.displayName)?.trim();
  if (!teacherName) return { ok: false, error: "강사 이름이 없습니다" };

  // 과목 opt-in·발송 기한 = 월간 달력(calendar-actions)과 동일 소스 — sendable 판정 재료(#77 게이트 단일화).
  const [supabase, settings] = await Promise.all([createClient(), getTenantSettings()]);
  const subjectsGate = settings.report.classnoteSubjects ?? null;
  const minDate = classnoteMinDate();
  let q = supabase
    .from("lesson_reports")
    .select(
      "id, report_date, student_id, subject, source, progress, exam_info, homework_score, classnote_status, share_token, revoked_at, students!lesson_reports_student_id_fkey(name, school, grade)",
    )
    .eq("teacher_name", teacherName)
    .order("report_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(PAGE_ROWS + 1); // +1 = hasMore 프로브
  // 하루만 보기(달력 날짜 클릭)가 커서보다 우선 — 둘을 함께 걸면 서로 모순되는 조건이 된다.
  if (input?.on) q = q.eq("report_date", input.on);
  else if (input?.before) q = q.lt("report_date", input.before);
  const { data, error } = await q;
  if (error) return { ok: false, error: "보고서를 불러오지 못했습니다" };

  let rows = data ?? [];
  const hasMore = rows.length > PAGE_ROWS;
  if (hasMore) {
    rows = rows.slice(0, PAGE_ROWS);
    // 커서가 날짜 단위(lt)라 마지막 날짜가 페이지에 걸쳐 잘리면 다음 페이지에서 중복된다 →
    // 페이지 끝의 (불완전할 수 있는) 마지막 날짜를 통째로 잘라 날짜 경계를 맞춘다.
    // 단 전부 같은 날짜(비현실적 대량)면 자르면 빈 페이지 → 그대로 둔다(중복 허용이 무한루프보다 낫다).
    const lastDate = rows[rows.length - 1]!.report_date as string;
    const trimmed = rows.filter((r) => r.report_date !== lastDate);
    if (trimmed.length > 0) rows = trimmed;
  }

  // 학부모 열람 수(share_link_views) — 이 페이지 보고서 id들만 청크 조회 후 JS 집계(roster 동일 패턴).
  const ids = rows.map((r) => r.id as string);
  const viewRows = await fetchInChunks<{ lesson_report_id: string }>(ids, (chunk) =>
    supabase.from("share_link_views").select("lesson_report_id").in("lesson_report_id", chunk),
  );
  const viewCountById = new Map<string, number>();
  for (const v of viewRows)
    viewCountById.set(v.lesson_report_id, (viewCountById.get(v.lesson_report_id) ?? 0) + 1);

  return {
    ok: true,
    hasMore,
    rows: rows.map((r) => {
      const stu = (Array.isArray(r.students) ? r.students[0] : r.students) as
        | { name?: string; school?: string | null; grade?: string | null }
        | null;
      return {
        id: r.id as string,
        reportDate: r.report_date as string,
        studentId: r.student_id as string,
        studentName: stu?.name ?? "(알 수 없음)",
        studentLabel: schoolGradeLabel(stu?.school ?? null, stu?.grade ?? null),
        subject: (r.subject as string | null) ?? null,
        progress: (r.progress as string | null) ?? null,
        examInfo: (r.exam_info as string | null) ?? null,
        homeworkScore: (r.homework_score as string | null) ?? null,
        classnoteStatus: (r.classnote_status as string | null) ?? null,
        shareToken: (r.share_token as string | null) ?? null,
        revoked: r.revoked_at != null,
        viewCount: viewCountById.get(r.id as string) ?? 0,
        // 0128a RPC의 sendable 4조건을 행 단위로 동일 재현(이관분·취소·과목 밖·기한 초과 = false).
        // ⚠️ RPC와 동일하게 subject null은 과목 게이트가 설정돼 있으면 false(`= any()`의 null 의미 보존).
        sendable:
          ((r.source as string | null) ?? "") !== "edutrix_import" &&
          r.revoked_at == null &&
          (!subjectsGate || subjectsGate.length === 0 || (r.subject != null && subjectsGate.includes(r.subject as string))) &&
          (minDate == null || (r.report_date as string) >= minDate),
      };
    }),
  };
}
