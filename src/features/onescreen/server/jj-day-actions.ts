"use server";

/**
 * 원스크린 영어 행 — 그날 **인재원 하루치**를 읽는다(카드 미리보기·글 조립용, 2026-09-11).
 *
 * 🔑 읽기만 한다 — 학부모 카드의 그림은 저장할 때 서버가 **다시** 받아 보고서에 묶는다(jj-capture.ts). 여기서 준 JSON은
 *    화면 메모리에만 머문다.
 * 🔴 게이트 = 보고서 저장과 **같은 학생 범위**(saveLessonReport): 보고서 관리 권한(사무실)이거나, 그 날짜에 가르치는 반의
 *    학생이거나, 보강·수업외 행이면 같은 학원 학생. 인재원 조회는 admin(학원 경계만)이라 이 확인이 강사 범위의 전부다.
 * ⚠️ '다른 강사 뷰'(열람 전용)는 막지 않는다 — 읽기다(보는 사람이 그 강사 화면 그대로를 봐야 한다).
 * ⚠️ 이 파일은 async 함수만 export한다([[#119]]).
 */
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { resolveReportDate } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";
import { fetchStudentJjDay } from "@/features/ijw/server/report-snapshot";
import type { JjDayState } from "../jj-day";
import { teacherOwnsStudent } from "./scope";

export async function loadEnglishJjDay(input: {
  studentId: string;
  date?: string;
  /** 보강·수업외 행 — 저장과 같이 담당 반 대신 같은 학원 학생이면 된다. */
  outOfClass?: boolean;
  /**
   * 고른 결과지(2026-09-28) — `undefined` = 저장해 둔 고르기, `null` = 기본(그날 낸 응시 전부), 배열 = 그 응시들.
   * 응시가 이 학생 것인지는 서버가 결과지의 학생으로 다시 확인한다(report-snapshot.ts).
   */
  pick?: string[] | null;
}): Promise<JjDayState> {
  const user = await getCurrentUser();
  if (!user || user.systemRole === "student") return { status: "error", message: "로그인이 필요합니다" };
  if (!input?.studentId) return { status: "error", message: "학생 정보가 없습니다" };
  const date = resolveReportDate(input.date);

  const level = await accessLevelTenant(user.systemRole, "lesson_reports");
  if (level !== "full" && level !== "readonly") {
    const supabase = await createClient();
    // 🔴 수업외(보강) 행은 **이 강사가 그날 그 학생 보고서를 이미 저장했을 때만** 연다 — 화면이 보낸 '수업외' 표시만
    //    믿으면 아무 강사나 남의 학생 점수·틀린 단어를 읽는다(적대 리뷰 2026-09-11). 쓰기(저장)는 종전대로 열려 있어
    //    한 번 저장하면 그다음부터 불러온다.
    const allowed = input.outOfClass
      ? await savedOutOfClassReport(supabase, user.id, input.studentId, date)
      : await teacherOwnsStudent(supabase, user.id, input.studentId, date);
    if (!allowed) {
      return {
        status: "error",
        message: input.outOfClass ? "수업외 학생은 보고서를 한 번 저장한 뒤 불러올 수 있습니다" : "담당 학생이 아닙니다",
      };
    }
  }

  const day = await fetchStudentJjDay(user.tenantId, input.studentId, date, input.pick);
  if (day.state === "ok") return { status: "ok", snapshot: day.snapshot, options: day.options };
  if (day.state === "unlinked") return { status: "unlinked" };
  return { status: "error", message: day.failure.message, unreachable: day.failure.kind === "unreachable" };
}

/** 이 강사가 그날 그 학생 보고서를 저장한 적이 있는가(작성자 = created_by, 0172a). 세션 클라이언트 = RLS 안. */
async function savedOutOfClassReport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  studentId: string,
  date: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("lesson_reports")
    .select("id")
    .eq("student_id", studentId)
    .eq("report_date", date)
    .eq("created_by", userId)
    .limit(1);
  return !error && !!data?.length;
}
