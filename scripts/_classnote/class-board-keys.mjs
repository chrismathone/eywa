// scripts/_classnote/class-board-keys.mjs — 반 보드 글·댓글 → 학생 매칭(순수, 개명 감사 G4 2026-09-30).
// 🔑 번호가 기준이다 — 반 이름이 바뀐 날 보드명 키는 짝을 못 찾아 학부모 글 알림이 조용히 버려졌다.
// 🔴 (1) 학생 확정 가드(원장 2026-09-30 *"가드를 좀 제법 쳐서 알림 이상하게 가지 않도록 해"*):
//    · **보드 번호 + 원아 id**가 둘 다 맞을 때만 학생을 정한다 — 보드 이름 폴백 없음(`cls`는 ClassNote 보고서 행에 늘 있다).
//    · 한 원아가 **서로 다른 학생 둘 이상**에 걸리면(반 보드 판정끼리, 또는 원아 링크 0185a와 반 보드 판정이 다르면) 학생 미확정.
//      같은 학생에 원아가 둘(안은지·박세욱 — 보호자·학생이 각자 가입)인 것은 정상이다 — 원아 기준이라 걸리지 않는다.
//    실측(2026-09-30): 반 보드 판정과 원아 링크가 다른 원아 3명(5행, 이름·학년이 다른 형제) — 이 글은 학생 대신 반 전체로 간다.

/** 지도에 넣을 키(보드 번호 + 원아). */
export function classBoardKeys({ boardId, childId }) {
  return [`#${Number(boardId)}|${Number(childId)}`];
}

/**
 * 반 보드 판정 행 → `#보드|원아` → 학생. 모호한 원아는 값이 null(키는 남긴다 — "있는데 못 정함"을 구분하려고).
 * @param {Array<{boardId:number|string, childId:number|string, studentId:string, name:string, linkedStudentId?:string|null}>} rows
 */
export function buildClassBoardChildMap(rows) {
  const studentsOfChild = new Map();
  for (const r of rows ?? []) {
    const child = Number(r.childId);
    const set = studentsOfChild.get(child) ?? studentsOfChild.set(child, new Set()).get(child);
    set.add(r.studentId);
    if (r.linkedStudentId) set.add(r.linkedStudentId);
  }
  const map = new Map();
  for (const r of rows ?? []) {
    const ambiguous = (studentsOfChild.get(Number(r.childId))?.size ?? 0) > 1;
    for (const k of classBoardKeys(r)) map.set(k, ambiguous ? null : { id: r.studentId, name: r.name });
  }
  return map;
}

/**
 * 반 보드 글·댓글 → 학생.
 * @returns {{student:{id:string,name:string}|null, blocked:string|null}}  blocked = 가드가 막은 이유(없으면 그냥 짝 없음)
 */
export function classBoardMatch(map, { cls, childId }) {
  if (cls == null || cls === "") return { student: null, blocked: "보드 번호 없음" };
  const key = `#${Number(cls)}|${Number(childId)}`;
  if (!map.has(key)) return { student: null, blocked: null };
  const st = map.get(key);
  return st ? { student: st, blocked: null } : { student: null, blocked: "원아가 여러 학생에 걸림" };
}

/** 반 보드 글·댓글 → 학생(없거나 못 정하면 null). */
export function classBoardStudentOf(map, query) {
  return classBoardMatch(map, query).student;
}
