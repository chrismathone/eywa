import { requireAccess } from "@/lib/auth/require-access";
import { getTeacherRoster } from "@/features/onescreen/server/roster";
import { OneScreenClient } from "@/features/onescreen/components/onescreen-client";

export const metadata = { title: "선생님 원스크린 — eywa" };

/**
 * 선생님 원스크린 — 강사 전용 수업 마감 화면.
 * 서버 컴포넌트: 권한 게이트 + 강사 본인의 오늘 반·학생 실데이터 조회(roster).
 * 진도·테스트·태도는 클라이언트 state로 입력하고, 보고서 발송은 lesson_reports에 영속화한다.
 */
export default async function OneScreenPage() {
  await requireAccess("teacher_onescreen");
  const roster = await getTeacherRoster();
  return (
    <OneScreenClient
      initial={roster.students}
      today={roster.today}
      classTags={roster.classTags}
    />
  );
}
