/**
 * 짝 칸(students.ijw_student_id, 0259a)이 아직 없는가 — 순수 판정. 서버 조회(links.ts·queries.ts)와
 * 서버 액션(link-actions.ts)이 **한 벌**을 쓴다("use server" 파일은 동기 함수를 export 못 해서 사본이 있었다, [[#119]]).
 * 원인을 단정하지 않도록 코드·문구 둘 다 본다 — 다른 실패를 "DB 적용 전"으로 오인하지 않게.
 */
export function isMissingIjwColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return /42703|PGRST204|ijw_student_id.*does not exist|Could not find the .*ijw_student_id/i.test(
    `${error.code ?? ""} ${error.message ?? ""}`,
  );
}
