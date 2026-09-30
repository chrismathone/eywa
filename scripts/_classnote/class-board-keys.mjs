// scripts/_classnote/class-board-keys.mjs — 반 보드 글·댓글 → 학생 매칭 키(순수, 개명 감사 G4 2026-09-30).
// 🔑 번호가 기준이다 — 반 이름이 바뀐 날 보드명 키는 짝을 못 찾아 학부모 글 알림이 조용히 버려졌다.
// 이름 키는 글에 보드 번호(`cls`)가 없을 때만 쓰는 폴백이다.

/** 지도에 넣을 키 두 개(번호·이름). */
export function classBoardKeys({ boardId, boardName, childId }) {
  const child = Number(childId);
  return [`#${Number(boardId)}|${child}`, `${boardName}|${child}`];
}

/** 반 보드 글·댓글 → 학생. 보드 번호(`cls`)가 있으면 번호로만, 없을 때만 보드명으로. */
export function classBoardStudentOf(map, { cls, className, childId }) {
  const child = Number(childId);
  if (cls != null && cls !== "") return map.get(`#${Number(cls)}|${child}`) ?? null;
  return map.get(`${className}|${child}`) ?? null;
}
