// scripts/_classnote/math-class-teachers.mjs — 수학 반 보드에 담임 연결(수동 스크립트·매일 동기화 공용).
//
// 🔴 aywa 직원 ↔ ClassNote 선생님은 **ID 연결이 없다** — 아래 표에 사람이 확인한 대응만 적는다(추측 금지).
//    2026-09-29 근거: 이름 일치 + 그 선생님 반 학생들의 1인 보드에 실제로 연결된 ClassNote 선생님(다수결).
//    이름이 다른 둘 — 김은정(Celine)=셀린(46건) · 이수진=수진T(46건). 표에 없는 새 선생님은 건너뛰고 로그만 남긴다.
// 🔴 쓰기 = `POST /api/v1/employments/ {teacher, class_in_charge}`(한 건 추가). 배열 교체형은 다른 반을 지울 수 있어 안 쓴다.
//    매 실행 뒤 **선생님별 연결 수가 정확히 +추가 수**인지 확인(줄었으면 배열 교체가 일어난 것 — 중단). 해제는 REST 없음(405).

/** aywa 직원 display_name → ClassNote 선생님 id. */
export const TEACHER_MAP = {
  이성우: 1716510,
  허주연: 1770725,
  남정화: 1763775,
  김윤하: 1711761,
  김은정: 1713039, // ClassNote '셀린'
  이수진: 1713037, // ClassNote '수진T'
  허은진: 1721116,
  유형숙: 1765427,
};

export async function fetchEmployments(page, centerId) {
  return page.evaluate(async (c) => {
    const r = await fetch(`/api/v1_2/centers/${c}/employments`, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`employments ${r.status}`);
    return r.json(); // ⚠️ DRF가 아니라 평배열
  }, centerId);
}

/** 담임 연결 계획 — 이미 연결된 것·대응 없는 것·퇴직은 건너뛴다. */
export function planTeacherLinks({ targets, emps }) {
  const has = new Set(emps.map((e) => `${e.teacher_id}|${e.class_in_charge}`));
  const todo = [];
  const skipped = [];
  for (const t of targets) {
    if (!t.teacher) { skipped.push(`${t.className}: 담임 없음`); continue; }
    if (t.teacherStatus !== "active") { skipped.push(`${t.className}: 담임 ${t.teacher} 퇴직`); continue; }
    const tid = TEACHER_MAP[t.teacher];
    if (!tid) { skipped.push(`${t.className}: ${t.teacher} — ClassNote 대응 미확인`); continue; }
    if (has.has(`${tid}|${t.boardId}`)) continue;
    todo.push({ ...t, tid });
  }
  return { todo, skipped };
}

/**
 * 실행 + 검증. 실패하면 던진다. `linked` = 연결에 성공한 항목을 담을 배열(호출자가 넘기면 **도중에 던져도** 그때까지 연결한 담임이
 * 호출자에게 남는다 — 동기화 보고서 0329a).
 * @returns {Promise<number>} 연결 수
 */
export async function connectTeachers(page, centerId, todo, log = console.log, linked = []) {
  if (!todo.length) return 0;
  const before = await fetchEmployments(page, centerId);
  const count = (list) => {
    const m = new Map();
    for (const e of list) m.set(e.teacher_id, (m.get(e.teacher_id) ?? 0) + 1);
    return m;
  };
  const added = new Map();
  for (const t of todo) {
    const res = await page.evaluate(async ([teacher, cls]) => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
      const r = await fetch("/api/v1/employments/", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
        body: JSON.stringify({ teacher, class_in_charge: cls }),
      });
      return r.status;
    }, [t.tid, t.boardId]);
    if (res !== 201) throw new Error(`${t.className} ← ${t.teacher}: 담임 연결 실패 HTTP ${res}`);
    added.set(t.tid, (added.get(t.tid) ?? 0) + 1);
    linked.push(t);
    log(`  담임 연결 ${t.className} ← ${t.teacher}`);
  }
  const b = count(before);
  const a = count(await fetchEmployments(page, centerId));
  for (const [tid, n] of b)
    if ((a.get(tid) ?? 0) !== n + (added.get(tid) ?? 0)) throw new Error(`선생님 #${tid} 연결 수가 예상과 다르다(${n} → ${a.get(tid) ?? 0}) — 확인 필요`);
  return todo.length;
}
