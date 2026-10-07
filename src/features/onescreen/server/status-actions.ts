"use server";

// 강사 원스크린 — ClassNote 발송 상태만 가볍게 다시 읽는다.
// 배경: 발송은 로컬 워커가 백그라운드로 게시하므로, 강사가 '발송' 누른 직후 화면은 '발송 대기'다.
// 예전엔 그 배지가 **새로고침 전까지 그대로 굳어** 있어 "안 나간 건가?"로 읽혔다(원장 제보와 같은 증상).
import { getCurrentUser } from "@/lib/auth/current-user";
import { getShellView } from "@/lib/auth/view-mode";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { resolveReportDate } from "@/lib/date-kst";
import type { ClassnoteStatusRow } from "../classnote-status";

/** 폴링 1회가 건드릴 수 있는 학생 수 상한 — 로스터가 아무리 커도 조회를 유계로 묶는다. */
const MAX_STUDENTS = 200;

/**
 * (대상 날짜 × 학생들)의 ClassNote 발송 상태. 보고서 본문·첨부는 안 읽고 **상태 3컬럼만** 읽는다(주기 호출이라).
 * 게이트는 페이지와 동일한 뷰 기준(`getShellView() === "teacher"`, 겸직 포함) + RLS 테넌트 격리.
 * 대량 `.in()`은 `fetchInChunks`로 분할(B3) — 로스터가 크면 414가 나고 error를 삼키게 된다.
 */
export async function getClassnoteStatuses(
  reportDate: string,
  studentIds: string[],
): Promise<ClassnoteStatusRow[] | null> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return null;
  if ((await getShellView()) !== "teacher") return null;
  const ids = [...new Set(studentIds)].slice(0, MAX_STUDENTS);
  if (ids.length === 0) return [];

  const supabase = await createClient();
  const date = resolveReportDate(reportDate); // 빈값·미래 → 오늘(KST) — 저장/발송이 쓰는 날짜와 같은 규칙
  // class_id 포함(0134a) — 같은 과목 두 행(정규+특강)을 과목만으론 못 가른다. 병합은 반 우선.
  const rows = await fetchInChunks<{
    student_id: string;
    subject: string | null;
    class_id: string | null;
    classnote_status: string | null;
  }>(ids, (chunk) =>
    supabase
      .from("lesson_reports")
      .select("student_id, subject, class_id, classnote_status")
      .eq("report_date", date)
      .in("student_id", chunk),
  );
  return rows.map((r) => ({
    studentId: r.student_id,
    subject: r.subject,
    classId: r.class_id,
    status: r.classnote_status,
  }));
}
