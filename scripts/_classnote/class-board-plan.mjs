// scripts/_classnote/class-board-plan.mjs — 수학 **반 보드** 생성·배정 계획(순수 함수, 의존성 = 순수 모듈만).
//
// 원장 2026-09-29: 수학 발송을 `(수학)학생명` 1인 보드에서 **aywa 반과 이름까지 똑같은 반 보드**로 옮긴다.
// 1인 보드는 해제하지 않고 반 보드에 **추가 배정**한다. 반을 2~3개 다니면 **모든 반에 따로** 배정한다.
//
// 🔴 이 계획의 유일한 위험은 **같은 반의 동명이인**이다(원장: 과거 실제로 겹친 적이 있다 — "삼중사중 가드도
//    아까울 정도로"). 반 보드 안에서 이름으로 원아를 고르는 순간 김근우·김근우A가 섞인다. 그래서:
//   ① 원아 출처 = 그 학생의 1인 보드 `(수학)유효이름`에 **이미 배정된 원아만**(반 보드 안에서 이름 검색 금지).
//   ② 보호자 전화 일치 필수 — ClassNote 운영관리 carer1_phone ∈ aywa 전화 4칸. 모르면 보류.
//   ③ 생년 일치 필수 — 학년에서 역산 ±1년. 모르면 보류.
//   ④ 역방향 유일성 — 그 원아가 **다른 학생의** 1인 보드에 있거나 계획상 두 학생에게 잡히면 둘 다 보류.
//   ⑤ 같은 반에 기본이름(끝 알파벳 뗀 이름)이 겹치는 학생 = 둘 다 보류(원장 확인 전 자동 배정 금지).
//   ⑥ 원아 이름이 학생 이름과 이어져야 한다(`서연` ⊂ `박서연E`는 통과) — 쌍둥이·형제는 전화가 같고 생년도
//      같거나 가까워 ②③을 통과하므로, 형제 원아가 잘못 붙어 있으면 이름만이 마지막 단서다.
// 가드는 **전부 AND**이고 하나라도 모르면 보류한다(fail-closed). 사람 확인으로만 푼다.
//
// ⚠️ 순수 유지 — playwright·postgres import 금지(Vitest가 끌어오면 안 된다). 테스트 = class-board-plan.test.mjs.

import { expectedBirthYear, normBoard } from "./board-safety.mjs";
import { phoneMatches } from "./offboard-safety.mjs";
import { childIdentityKeys } from "./identity-keys.mjs";

/** 생년 대조 허용 오차 — board-safety.mjs BIRTH_YEAR_TOLERANCE와 같은 값(그쪽은 export하지 않는다). */
export const BIRTH_TOLERANCE = 1;
/** 한 학생에 붙을 수 있는 원아 수 상한 — 학부모·학생 각자 가입(2계정)까지만. 그 이상은 사람이 본다. */
export const MAX_CHILDREN_PER_STUDENT = 2;

/** 1인 보드 이름 — 발송 워커 boardClassName("math", 이름)과 같은 모양. */
export const personalBoardName = (effName) => `(수학)${effName}`;

/** 기본이름 — 동명이인 접미사(끝 알파벳)를 뗀 이름. `김근우A`→`김근우`, `박서준C`→`박서준`. */
export function baseName(effName) {
  return String(effName ?? "").replace(/\s/g, "").replace(/[A-Za-z]+$/, "");
}

/**
 * ⑥ 원아 이름(학부모가 등록)이 학생 이름과 이어지는가 — 한쪽이 다른 쪽을 포함하면 통과(2글자 이상).
 * `서연`↔`박서연E` · `Jay(이재희)`↔`이재희` 통과, `김민서`↔`김민준`(쌍둥이 형제) 불통과.
 */
export function childNameConsistent(studentName, childName) {
  const x = baseName(studentName);
  if (x.length < 2) return false;
  for (const k of childIdentityKeys(childName)) {
    if (k.length >= 2 && (x.includes(k) || k.includes(x))) return true;
  }
  return false;
}

/** 1인 보드 이름이 가리키는 학생 기본이름(`(수학)`로 시작하지 않으면 null). */
function personalBoardOwner(boardName) {
  const m = normBoard(boardName).match(/^\(수학\)(.+)$/);
  return m ? m[1] : null;
}

/**
 * 학생 1명의 원아 판정 — 반과 무관하게 한 번만 한다(같은 학생이 반 3개면 같은 원아를 세 반에 싣는다).
 * @returns {{ok:boolean, reasons:string[], children:Array<{id:number,name:string}>}}
 */
export function resolveStudentChildren(student, { boards, membersByBoard, admissions, schoolYear }) {
  const reasons = [];
  const want = normBoard(personalBoardName(student.name));
  const hit = (boards ?? []).filter((b) => normBoard(b.name) === want);
  if (hit.length === 0) return { ok: false, reasons: ["1인 보드 없음"], children: [] };
  if (hit.length > 1) return { ok: false, reasons: [`1인 보드 ${hit.length}개(중복)`], children: [] };

  const members = membersByBoard.get(hit[0].id);
  if (!Array.isArray(members)) return { ok: false, reasons: ["1인 보드 원아 조회 실패"], children: [] };
  if (members.length === 0) return { ok: false, reasons: ["ClassNote 미가입·미배정(1인 보드 원아 0명)"], children: [] };
  if (members.length > MAX_CHILDREN_PER_STUDENT)
    return { ok: false, reasons: [`1인 보드 원아 ${members.length}명 — 사람 확인 필요`], children: [] };

  const expected = expectedBirthYear(student.grade, schoolYear);
  for (const m of members) {
    const who = `원아 "${m.name ?? "?"}"`;
    // ③ 생년
    const y = Number(String(m.date_birth ?? "").slice(0, 4));
    if (expected == null) reasons.push(`학년(${student.grade ?? "없음"})을 몰라 생년 대조 불가`);
    else if (!Number.isFinite(y) || y < 1900) reasons.push(`${who} 생년 없음`);
    else if (Math.abs(y - expected) > BIRTH_TOLERANCE) reasons.push(`${who} 생년 불일치(${y}년생, 기대 ${expected}년생)`);
    // ⑥ 이름 연속성
    if (!childNameConsistent(student.name, m.name)) reasons.push(`${who} 이름이 학생(${student.name})과 다름 — 형제 계정일 수 있어 확인 필요`);
    // ② 전화 — 값은 절대 사유에 싣지 않는다(일치 여부만)
    const adm = admissions.get(m.id);
    if (!adm) reasons.push(`${who} 운영관리 명부에 없음 — 보호자 전화 대조 불가`);
    else {
      const pm = phoneMatches(student.phones ?? [], [adm.phone]);
      if (pm === null) reasons.push(`${who} 보호자 전화 대조 불가(한쪽 번호 없음)`);
      else if (pm === false) reasons.push(`${who} 보호자 전화 불일치`);
      // ④ 역방향 — 이 원아가 다른 학생의 1인 보드에도 있다
      const others = (adm.boardNames ?? [])
        .map(personalBoardOwner)
        .filter((o) => o && o !== normBoard(student.name));
      if (others.length) reasons.push(`${who} 다른 학생 1인 보드에도 있음(${others.map((o) => `(수학)${o}`).join(", ")})`);
    }
  }
  return {
    ok: reasons.length === 0,
    reasons,
    children: members.map((m) => ({ id: m.id, name: m.name ?? "" })),
  };
}

/**
 * 반 보드 계획.
 * @param {object} p
 * @param {Array<{classId:string, className:string, studentIds:string[]}>} p.classes  대상 aywa 수학 반
 * @param {Map<string,{id:string,name:string,grade:string|null,phones:string[]}>} p.students  name = 유효이름
 * @param {Array<{id:number,name:string}>} p.boards  ClassNote 전 보드
 * @param {Map<number,Array<{id:number,name?:string,date_birth?:string|null}>>} p.membersByBoard  조회한 보드의 원아
 * @param {Map<number,{phone:string|null, boardNames:string[]}>} p.admissions  운영관리 명부(원아 id → 보호자 전화·소속 보드)
 * @param {number} p.schoolYear
 */
export function planClassBoards({ classes, students, boards, membersByBoard, admissions, schoolYear }) {
  // 1) 학생별 원아 판정(한 번씩)
  const byStudent = new Map();
  for (const c of classes)
    for (const sid of c.studentIds) {
      if (byStudent.has(sid)) continue;
      const s = students.get(sid);
      byStudent.set(sid, s ? resolveStudentChildren(s, { boards, membersByBoard, admissions, schoolYear }) : { ok: false, reasons: ["학생 정보 없음"], children: [] });
    }

  // ④-b 계획 안에서 한 원아가 두 학생에게 잡히면 둘 다 보류
  const owners = new Map();
  for (const [sid, v] of byStudent) for (const ch of v.children) owners.set(ch.id, [...(owners.get(ch.id) ?? []), sid]);
  for (const [cid, sids] of owners) {
    if (sids.length < 2) continue;
    const names = sids.map((sid) => students.get(sid)?.name ?? "?").join(", ");
    for (const sid of sids) {
      const v = byStudent.get(sid);
      v.ok = false;
      v.reasons.push(`같은 원아(id ${cid})가 여러 학생에게 잡힘: ${names}`);
    }
  }

  // 2) 반별
  const plans = classes.map((c) => {
    const exact = (boards ?? []).filter((b) => b.name === c.className);
    const near = (boards ?? []).filter((b) => b.name !== c.className && normBoard(b.name) === normBoard(c.className));
    let board;
    if (exact.length > 1) board = { action: "block", reason: `같은 이름 보드 ${exact.length}개` };
    else if (near.length) board = { action: "block", reason: `공백만 다른 보드가 있음(${near.map((b) => JSON.stringify(b.name)).join(", ")})` };
    else if (exact.length === 1) board = { action: "exists", id: exact[0].id };
    else board = { action: "create" };

    // ⑤ 같은 반 기본이름 겹침
    const groups = new Map();
    for (const sid of c.studentIds) {
      const b = baseName(students.get(sid)?.name);
      if (b) groups.set(b, [...(groups.get(b) ?? []), sid]);
    }
    const homonym = new Map();
    for (const sids of groups.values()) {
      if (sids.length < 2) continue;
      const names = sids.map((sid) => students.get(sid)?.name ?? "?").join(", ");
      for (const sid of sids) homonym.set(sid, `같은 반 동명이인(${names}) — 원장 확인 전 자동 배정 금지`);
    }

    const current = board.action === "exists" ? membersByBoard.get(board.id) : [];
    const currentIds = new Set((current ?? []).map((m) => m.id));
    const assign = [];
    const hold = [];
    for (const sid of c.studentIds) {
      const s = students.get(sid);
      const v = byStudent.get(sid);
      const reasons = [...v.reasons, ...(homonym.has(sid) ? [homonym.get(sid)] : [])];
      if (board.action === "block") reasons.push(`반 보드 특정 불가 — ${board.reason}`);
      if (reasons.length) hold.push({ studentId: sid, name: s?.name ?? "?", reasons });
      else
        assign.push({
          studentId: sid,
          name: s.name,
          children: v.children.map((ch) => ({ ...ch, already: currentIds.has(ch.id) })),
        });
    }
    // 보류된 학생의 원아도 "그 반 학생의 가족"이라 잉여가 아니다 — 잉여 = 이 반 누구의 원아도 아닌 것.
    const planned = new Set(c.studentIds.flatMap((sid) => byStudent.get(sid).children.map((ch) => ch.id)));
    const extras = (current ?? []).filter((m) => !planned.has(m.id)).map((m) => m.name ?? "?");
    return { classId: c.classId, className: c.className, board, assign, hold, extras };
  });
  return plans;
}

/** 요약 — 반·학생×반·원아 배정 건수. */
export function summarizePlan(plans) {
  const s = { classes: plans.length, create: 0, exists: 0, blocked: 0, pairs: 0, assignPairs: 0, holdPairs: 0, enrollments: 0, already: 0, extras: 0 };
  for (const p of plans) {
    if (p.board.action === "create") s.create++;
    else if (p.board.action === "exists") s.exists++;
    else s.blocked++;
    s.pairs += p.assign.length + p.hold.length;
    s.assignPairs += p.assign.length;
    s.holdPairs += p.hold.length;
    s.extras += p.extras.length;
    for (const a of p.assign) for (const ch of a.children) {
      if (ch.already) s.already++;
      else s.enrollments++;
    }
  }
  return s;
}
