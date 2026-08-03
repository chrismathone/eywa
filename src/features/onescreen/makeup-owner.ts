/**
 * 보강(수업외) 보고서의 **소유 판정** — "이 행이 누구 원스크린에 뜨는가"(순수 함수).
 *
 * 🔴 소유 키는 **계정 id**(`created_by`, 0172a)다. 예전엔 `teacher_name`(표시 이름 문자열)이었는데,
 *    ① 강사가 이름을 바꾸면 그 전에 쓴 보강이 **본인 화면에서도 사라지고**
 *    ② 동명이인이 생기면 남의 보강이 내 화면에 섞인다.
 *    학부모에게 나가는 담임 표기(`teacher_name`)와 화면 소유는 **다른 축**이라 분리했다.
 *
 * ⚠️ 이름 폴백은 **`created_by`가 없는 옛 행에만** 적용한다(0172a 백필에서 못 맞춘 옛 표기 —
 *    실측 171건 중 20건: '윤서영'(퇴직)·'수진'·'성우'·'정은'·'희영1' 같은 약칭/구표기, 전부 2026-02 이전).
 *    id가 있는데도 이름으로 한 번 더 열어 주면 동명이인 누출이 뒷문으로 되살아난다.
 */

export type MakeupOwnerRef = {
  /** 작성 계정(0172a). null = 그 이전에 저장된 행. */
  createdBy?: string | null;
  /** 표시용 담임 이름 — 옛 행의 폴백 키. */
  teacherName?: string | null;
};

/** 이 보강 보고서가 (userId, teacherName)인 사람의 것인가. */
export function ownsMakeupReport(
  row: MakeupOwnerRef,
  userId: string,
  teacherName: string,
): boolean {
  const owner = row.createdBy?.trim();
  if (owner) return owner === userId;
  const name = teacherName.trim();
  return !!name && (row.teacherName?.trim() ?? "") === name;
}
