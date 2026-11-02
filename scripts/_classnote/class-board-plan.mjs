// scripts/_classnote/class-board-plan.mjs — 수학 **반 보드** 생성·배정 계획(순수 함수, 의존성 = 순수 모듈만).
//
// 원장 2026-09-29: 수학 발송을 `(수학)학생명` 1인 보드에서 **aywa 반과 이름까지 똑같은 반 보드**로 옮긴다.
// 1인 보드는 해제하지 않고 반 보드에 **추가 배정**한다. 반을 2~3개 다니면 **모든 반에 따로** 배정한다.
//
// 🔴 이 계획의 유일한 위험은 **같은 반의 동명이인**이다(원장: 과거 실제로 겹친 적이 있다 — "삼중사중 가드도
//    아까울 정도로"). 반 보드 안에서 이름으로 원아를 고르는 순간 김근우·김근우A가 섞인다. 그래서:
//   ① 원아 출처 = 그 학생의 1인 보드 `(수학)유효이름`에 **이미 배정된 원아만**(반 보드 안에서 이름 검색 금지).
//      1인 보드가 없거나 비었으면(원장 2026-11-02 — 1인 보드 원아 배정 해제 · 12월 보드 삭제) 그 학생이 반 보드 기록(0302a)에서
//      이미 '정상'으로 확인된 원아 중 **기록된 그 반 보드에 지금도 있는 원아**로 대신한다(`verifiedChildren`, source "verified").
//      아래 ②~⑥은 그 원아에도 똑같이 다시 건다. ④는 기록에서 다른 학생에게 확인된 원아인지도 본다.
//      ⚠️ 0302a는 반 기록이라 휴원·반 사이 공백이면 사라진다 — 12월 보드 삭제 전에 반 기록과 별개인 확인 표가 필요하다(#150).
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
 * 확인 기록 역색인 — 원아 id → 그 원아가 '정상'으로 기록된 학생 id들(④ 역방향 가드용).
 * `keep(sid)` = 비교 상대로 셀 학생 — 지금 대상 반에 다니는 학생만(종강했지만 연결을 지키는 반·병합된 학생의 옛 기록은 다시 쓰이지 않아
 * 그대로 두면 물려받은 원아가 영구히 보류된다).
 */
export function verifiedOwnersOf(verifiedChildren, keep = () => true) {
  const out = new Map();
  for (const [sid, list] of verifiedChildren ?? []) {
    if (!keep(sid)) continue;
    for (const v of list ?? []) out.set(Number(v.id), new Set([...(out.get(Number(v.id)) ?? []), sid]));
  }
  return out;
}

/**
 * 1인 보드 대신 쓸 원아 — 반 보드 기록(0302a)에서 이 학생에게 '정상'으로 확인된 원아 중 **기록된 그 반 보드에 지금도 있는 원아만**.
 * 🔴 지금 그 보드에 있어야 쓴다: 사람이 잘못 붙은 원아를 반 보드에서 떼면 다음 동기화가 기록만 보고 다시 붙이면 안 되고(떼는 것이
 *    유일한 처방이다), 기관에서 빠진 원아를 새 반에 넣으려다 실패하면 동기화 전체가 멈춘다. 이름·생년도 지금 ClassNote 값으로 대조한다.
 * @returns {{ members: object[], recorded: number }}  recorded = 기록에 있던 원아 수(보드에 없어 못 쓴 것 포함)
 */
function verifiedMembers(student, verifiedChildren, membersByBoard) {
  const list = verifiedChildren?.get?.(student.id) ?? [];
  const members = [];
  for (const v of list) {
    let live = null;
    for (const bid of v.boardIds ?? []) {
      const m = (membersByBoard.get(Number(bid)) ?? []).find((x) => Number(x.id) === Number(v.id));
      if (m) { live = m; break; }
    }
    if (live) members.push({ ...live, id: Number(live.id) });
  }
  return { members, recorded: list.length };
}

/**
 * 학생 1명의 원아 판정 — 반과 무관하게 한 번만 한다(같은 학생이 반 3개면 같은 원아를 세 반에 싣는다).
 * `verifiedChildren`(학생 id → [{id,name,boardIds}], 0302a ok) = 1인 보드가 없거나 비었을 때만 쓰는 대신 출처. 없으면 종전 그대로.
 * `verifiedOwners`(원아 id → 학생 id들) = ④ 역방향 — 1인 보드가 비면 1인 보드 소속으로는 못 잡으니 기록으로도 본다.
 * @returns {{ok:boolean, reasons:string[], children:Array<{id:number,name:string}>, source:"personal"|"verified"|null}}
 *   source = 원아를 어디서 가져왔나(배정 직전 1인 보드 재확인은 "personal"일 때만 — math-class-boards-apply.mjs).
 */
export function resolveStudentChildren(student, { boards, membersByBoard, admissions, schoolYear, verifiedChildren = null, verifiedOwners = null }) {
  const reasons = [];
  const want = normBoard(personalBoardName(student.name));
  const hit = (boards ?? []).filter((b) => normBoard(b.name) === want);
  if (hit.length > 1) return { ok: false, reasons: [`1인 보드 ${hit.length}개(중복)`], children: [], source: null };

  let members = [];
  let source = "personal";
  if (hit.length === 1) {
    members = membersByBoard.get(hit[0].id);
    if (!Array.isArray(members)) return { ok: false, reasons: ["1인 보드 원아 조회 실패"], children: [], source: null };
  }
  if (members.length === 0) {
    // 1인 보드가 없거나 비었다 — 반 보드에서 이미 확인한 원아로 판정한다(그것도 없으면 종전 사유 그대로 보류).
    const v = verifiedMembers(student, verifiedChildren, membersByBoard);
    members = v.members;
    source = "verified";
    if (!members.length && v.recorded)
      return { ok: false, reasons: ["반 보드에서 확인된 원아가 지금 그 반 보드에 없음 — 확인 필요"], children: [], source: null };
    // 🔴 사유 문장은 글자 그대로 — 앱이 이 원문으로 '가입 대기'를 가린다(board-missing.ts · 잠금 = board-missing.test.ts).
    if (!members.length)
      return hit.length
        ? { ok: false, reasons: ["ClassNote 미가입·미배정(1인 보드 원아 0명)"], children: [], source: null }
        : { ok: false, reasons: ["1인 보드 없음"], children: [], source: null };
  }
  if (members.length > MAX_CHILDREN_PER_STUDENT)
    return { ok: false, reasons: [`${source === "verified" ? "반 보드에서 확인된" : "1인 보드"} 원아 ${members.length}명 — 사람 확인 필요`], children: [], source: null };

  const expected = expectedBirthYear(student.grade, schoolYear);
  for (const m of members) {
    const who = `원아 "${m.name ?? "?"}"`;
    // ③ 생년 — 관리자 화면의 생년월일(운영관리 명부 child_date_birth)이 먼저, 학부모 프로필(date_birth)은 보조.
    //    둘 중 하나라도 맞으면 통과(원장 2026-09-29: 관리자 화면에서 고친 생년이 안 먹었다 — 두 값이 따로 산다).
    const toYear = (v) => { const y = Number(String(v ?? "").slice(0, 4)); return Number.isFinite(y) && y >= 1900 ? y : null; };
    const years = [toYear(admissions.get(m.id)?.birth), toYear(m.date_birth)].filter((y) => y != null);
    if (expected == null) reasons.push(`학년(${student.grade ?? "없음"})을 몰라 생년 대조 불가`);
    else if (!years.length) reasons.push(`${who} 생년 없음`);
    else if (!years.some((y) => Math.abs(y - expected) <= BIRTH_TOLERANCE))
      reasons.push(`${who} 생년 불일치(${years[0]}년생, 기대 ${expected}년생)`);
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
    // ④ 역방향(기록) — 반 보드 기록에서 이 원아가 다른 학생에게 '정상'으로 잡혀 있다(1인 보드가 비면 위 검사로는 못 잡는다).
    const recordedFor = [...(verifiedOwners?.get?.(Number(m.id)) ?? [])].filter((sid) => sid !== student.id);
    if (recordedFor.length) reasons.push(`${who} 반 보드 기록에서 다른 학생에게 확인된 원아입니다`);
  }
  return {
    ok: reasons.length === 0,
    reasons,
    children: members.map((m) => ({ id: m.id, name: m.name ?? "" })),
    source,
  };
}

/**
 * 반 보드로 **쓰면 안 되는 이름**(개명 감사 G2) — 1인 보드 `(수학)…`·`(영어)…` 같은 `(과목)` 접두, 전체방 `[ALL]…`.
 * 반 이름이 이 모양이면 그 이름의 보드를 채택·생성·개명하지 않는다 — 1인 보드와 이름이 겹치는 순간 1인 보드 발송의
 * "보드가 곧 매핑" 폴백이 이 반 가족 전원을 통과시킬 수 있다. 앱은 이런 반 이름을 저장 단계에서 막는다(class-name.ts).
 * @returns {string|null} 이유(한글) — 해당 없으면 null
 */
export function reservedBoardName(name) {
  const n = normBoard(name);
  if (/^\([^)]*\)/.test(n)) return "괄호 과목 접두로 시작하는 1인 보드 이름 모양입니다";
  if (/^\[ALL\]/i.test(n)) return "전체방([ALL]) 이름 모양입니다";
  return null;
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
 * @param {Map<string,Array<{id:number,name:string,boardIds:number[]}>>|null} [p.verifiedChildren]  반 보드에서 확인된 원아(0302a ok) — 1인 보드가 없거나 빈 학생만 쓴다
 * @param {Set<string>|null} [p.verifiedOwnerScope]  ④(기록) 비교 상대 학생 — 전체 대상 반의 학생(없으면 이번 계획 반의 학생)
 */
export function planClassBoards({ classes, students, boards, membersByBoard, admissions, schoolYear, linkedBoardByClass = new Map(), verifiedChildren = null, verifiedOwnerScope = null }) {
  // 1) 학생별 원아 판정(한 번씩)
  const byStudent = new Map();
  // 비교 상대 = 지금 대상 반에 다니는 학생(일부 반만 보는 실행은 호출부가 전체 대상 반 기준으로 넘긴다 — verifiedOwnerScope).
  const ownerScope = verifiedOwnerScope ?? new Set(classes.flatMap((c) => c.studentIds));
  const verifiedOwners = verifiedOwnersOf(verifiedChildren, (sid) => ownerScope.has(sid));
  for (const c of classes)
    for (const sid of c.studentIds) {
      if (byStudent.has(sid)) continue;
      const s = students.get(sid);
      byStudent.set(sid, s ? resolveStudentChildren(s, { boards, membersByBoard, admissions, schoolYear, verifiedChildren, verifiedOwners }) : { ok: false, reasons: ["학생 정보 없음"], children: [], source: null });
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
  // 연결표(0302a)가 쥔 보드 → 반. 이름이 같은 보드라도 **다른 반에 연결된 보드**는 이 반 것으로 보지 않는다.
  const classByLinkedBoard = new Map([...linkedBoardByClass].map(([cid, bid]) => [Number(bid), cid]));
  // 이 반 누구의 원아인가 — 보류된 학생 원아도 "그 반 가족"이다(아래 extras와 같은 축).
  const plannedOf = (c) => new Set(c.studentIds.flatMap((sid) => byStudent.get(sid).children.map((ch) => ch.id)));
  const plans = classes.map((c) => {
    const linkedId = linkedBoardByClass.get(c.classId);
    const linked = linkedId != null ? (boards ?? []).find((b) => Number(b.id) === Number(linkedId)) : null;
    // 🔑 이름 충돌은 **다른 보드**와의 충돌만 센다 — 연결된 자기 보드는 빼고 본다(개명 감사 G7: "중3 A"→"중3A"처럼
    //    공백만 바꾼 개명이 자기 보드와 '공백만 다름'으로 잡혀 영구 보류되던 것).
    const others = (boards ?? []).filter((b) => !linked || Number(b.id) !== Number(linked.id));
    const exact = others.filter((b) => b.name === c.className);
    const near = others.filter((b) => b.name !== c.className && normBoard(b.name) === normBoard(c.className));
    const reserved = reservedBoardName(c.className);
    let board;
    if (linked) {
      // 🔑 반 연결은 **번호가 기준**이다(2026-09-29 동기화) — aywa에서 반 이름을 바꿔도 새 반을 만들지 않고 이름을 바꾼다.
      // 🔴 이름을 못 바꾸는 사정(같은 이름 보드가 이미 있음·예약된 이름)이 있어도 **연결은 지킨다**(개명 감사 G1) —
      //    번호로 계속 보내면 되고, 연결을 지우면 다음 날 이름으로 엉뚱한 보드를 채택하거나 새 보드를 만든다.
      if (linked.name === c.className) board = { action: "exists", id: linked.id, name: linked.name };
      else if (reserved)
        board = { action: "exists", id: linked.id, name: linked.name, renameBlocked: `반 이름 "${c.className}"은(는) ${reserved} — 보드 이름을 바꾸지 않습니다` };
      else if (exact.length || near.length)
        board = { action: "exists", id: linked.id, name: linked.name, renameBlocked: `반 이름을 "${c.className}"(으)로 바꿔야 하는데 그 이름의 보드가 이미 있습니다 — 발송은 연결된 보드(#${linked.id})로 계속합니다` };
      else board = { action: "exists", id: linked.id, name: linked.name, rename: { from: linked.name, to: c.className } };
    } else if (linkedId != null) {
      // 🔴 연결된 보드가 ClassNote에서 사라졌다 = 사람이 지웠다(2026-09-29 빈 반 JJ3E). 새로 만들면 지운 반이 매일 되살아난다.
      // 연결 행은 남긴다(deletedBoardId) — 지우면 다음 날 이름 규칙으로 다시 만들어진다. 안 쓰는 반이면 aywa에서 종강하면 연결도 정리된다.
      board = { action: "block", deletedBoardId: Number(linkedId), reason: `연결된 ClassNote 반(#${linkedId})이 삭제됐습니다 — 안 쓰는 반이면 aywa에서 종강하세요` };
    } else if (reserved) board = { action: "block", reason: `반 이름 "${c.className}"은(는) ${reserved} — 반 보드로 쓰지 않습니다` };
    else if (exact.length > 1) board = { action: "block", reason: `같은 이름 보드 ${exact.length}개` };
    else if (near.length) board = { action: "block", reason: `공백만 다른 보드가 있음(${near.map((b) => JSON.stringify(b.name)).join(", ")})` };
    else if (exact.length === 1 && classByLinkedBoard.has(Number(exact[0].id)) && classByLinkedBoard.get(Number(exact[0].id)) !== c.classId)
      board = { action: "block", reason: `같은 이름 보드가 다른 반에 연결돼 있습니다` };
    else if (exact.length === 1) {
      // 🔴 이름만 같은 기존 보드를 처음 채택할 때는 **그 보드의 원아가 전부 이 반 가족**이어야 한다(개명 감사 G2) —
      //    폐지 반의 옛 보드·사람이 만든 보드에 남의 집이 있으면 우리 가족을 거기 섞게 된다.
      const members = membersByBoard.get(exact[0].id);
      const planned = plannedOf(c);
      if (!Array.isArray(members)) board = { action: "block", reason: `같은 이름 보드(#${exact[0].id}) 원아 조회 실패 — 채택 보류` };
      else {
        const strangers = members.filter((m) => !planned.has(m.id));
        board = strangers.length
          ? { action: "block", reason: `같은 이름 보드(#${exact[0].id})에 이 반 학생이 아닌 원아 ${strangers.length}명이 있습니다 — 채택하지 않습니다(사람 확인)` }
          : { action: "exists", id: exact[0].id, name: exact[0].name };
      }
    } else board = { action: "create" };

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
          source: v.source,
        });
    }
    // 보류된 학생의 원아도 "그 반 학생의 가족"이라 잉여가 아니다 — 잉여 = 이 반 누구의 원아도 아닌 것.
    const planned = new Set(c.studentIds.flatMap((sid) => byStudent.get(sid).children.map((ch) => ch.id)));
    // extraChildren = 같은 목록을 번호와 함께(자동 해제가 번호로 내보낸다 — class-board-release.mjs). extras는 이름만(보고서·해제 리스트).
    const extraChildren = (current ?? []).filter((m) => !planned.has(m.id)).map((m) => ({ id: m.id, name: m.name ?? "?" }));
    const extras = extraChildren.map((m) => m.name);
    return { classId: c.classId, className: c.className, board, assign, hold, extras, extraChildren };
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

/**
 * 동기화가 걷지 않고 **지킬** 종강 반 연결 — 종강 반이면서 연결된 ClassNote 보드가 지금 목록에 살아 있는 반(순수).
 * 보드가 지워졌으면 지키지 않는다 → 연결이 걷히고 앱이 '보낼 반' 고르기를 띄운다(원장 2026-09-30).
 * @param {{ closedIds: readonly string[], planClassIds: readonly string[], linkedBoardByClass: Map<string, number>, liveBoardIds: Iterable<number> }} a
 * @returns {string[]}
 */
export function closedClassesToKeep({ closedIds, planClassIds, linkedBoardByClass, liveBoardIds }) {
  const inPlan = new Set(planClassIds);
  const live = new Set([...liveBoardIds].map(Number));
  return closedIds.filter((id) => !inPlan.has(id) && linkedBoardByClass.has(id) && live.has(Number(linkedBoardByClass.get(id))));
}

/**
 * 1인 보드 준비(매일 05시 provision)에서 뺄 수학 학생 — 반 보드에서 원아 확인을 마친 학생(원장 2026-11-02: 1인 보드 원아 배정 해제 → 12월 보드 삭제).
 * 그 학생은 반 보드 동기화가 확인 기록으로 원아를 판정하므로 1인 보드가 필요 없다. 안 빼면 비운 1인 보드를 다시 채우고, 지운 보드를 다시 만든다.
 * 확인 기록이 없는 학생(신입·보류)은 그대로 둔다 — 1인 보드가 아직 그 학생 원아를 처음 확인하는 유일한 출처다.
 * @param {Array<{studentId:string}>} targets
 * @param {Map<string, unknown[]>} verifiedChildren  학생 id → 확인된 원아(0302a ok)
 */
export function dropVerifiedTargets(targets, verifiedChildren) {
  return (targets ?? []).filter((t) => !((verifiedChildren?.get?.(t.studentId) ?? []).length > 0));
}
