/**
 * 잠긴 칸(수정 기간 7일 경과) 안내 문장 — 칸 툴팁과 격자 안내가 **한 문장**을 쓴다.
 *
 * 예전엔 `matrix-row.tsx` 안의 비공개 함수라 격자(`grid-context.tsx`)가 이 문장을 쓸 수 없었고,
 * 그래서 잠긴 칸에 숫자를 치면 **아무 말 없이** 값이 되돌아왔다(2026-08-20 수리).
 *
 * ⚠️ `import "server-only"` 금지 — 클라이언트 컴포넌트가 쓴다(#61).
 * ⚠️ 서버 액션의 `attendanceLockMessage`(edit-window.ts)와는 **다른 문장**이다. 저쪽은 "오늘 기준
 *    며칠 지났나"를 말하고, 이쪽은 화면이 이미 아는 경계(`lockBefore`)로 "언제 이후만 고칠 수 있나"를 말한다.
 *    문구는 이미 툴팁으로 나가고 있으므로 한 글자도 바꾸지 말 것.
 *
 * @param date 그 칸의 세션 날짜("YYYY-MM-DD").
 * @param lockBefore 이 날짜 **이전**은 강사가 못 고친다(오늘 포함 7일 창의 첫날).
 */
export function lockedMessage(date: string, lockBefore: string): string {
  return `${date} 출결은 수정 기간(7일)이 지나 고칠 수 없습니다 — ${lockBefore} 이후만 수정 가능, 그 전은 관리자에게 요청하세요`;
}
