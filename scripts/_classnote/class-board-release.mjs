// scripts/_classnote/class-board-release.mjs — 수학 **반 보드 자동 해제** 판정(순수 함수 — playwright·postgres import 금지).
//
// 원장 2026-10-02: *"자동 해제라는건 실제 에이와와 클래스노트를 동기화 할 정도로 반이동 같은 경우도 해제하라는 뜻"* ·
//   *"담임이 바뀌면 옛 담임은 해제"* · *"반 삭제는 됐고, 반 이름 변경, 학생 배정 및 해제, 강사 배정 및 해제만 에이와와 통일시켜"* ·
//   *"동기화 할때도 자동 해제되게 해줘야해"*.
// 동기화는 지금까지 배정만 했다(해제는 사람이 ClassNote 화면에서). 여기서 **누구를 내보낼지**를 정한다 — 실행은
// class-board-release-apply.mjs(원아 `…/enrollments/{번호}/out` · 선생님 `…/employments/{번호}/out`, 2026-10-02 실측).
// 대상은 **반 보드(0302a 연결)** 뿐이다. 1인 보드 `(수학)이름`·`(영어)이름`은 건드리지 않는다. 보드 삭제도 하지 않는다.
//
// 🔴 해제는 "명단 밖"이라는 **없음의 증거**로 움직인다 — 조회가 비거나 계획이 틀리면 지금 다니는 학생을 내보낸다. 그래서
//    "이 반 학생이 아니다"를 **양쪽에서** 확인한 원아만 내보낸다:
//   ① 이 반에 열린 수강(종료일이 없거나 오늘 이후 — 휴원·시작 전 포함)이 있는 학생 누구의 원아일 수 있으면 보류한다:
//      이름이 이어지거나 · 원아 링크(0185a)가 그 학생이거나 · 그 학생의 1인 보드에 있거나 · 보호자 전화가 같으면(형제 포함).
//   ② **누구의 원아인지 아는** 원아만 내보낸다 — 원아 링크 또는 1인 보드 주인으로 aywa 학생이 **한 명으로** 특정돼야 한다.
//      모르거나(둘 다 없음) · 후보가 둘 이상이거나(이름이 같은 두 학생 · 링크와 1인 보드 주인이 다름) · ClassNote 운영관리 명부에
//      그 원아가 없으면(1인 보드·전화 대조를 못 한다) 보류한다(사람 확인).
//   ③ 그 학생의 **이 반 수강이 끝난 기록**이 있어야 한다(종료일이 어제까지) — "명단에 없다"(없음)가 아니라 "끝났다"(있음)가 근거다.
//      이 반을 수강한 적이 없는 학생의 원아(사람이 ClassNote에서 넣은 체험·임시 원아)는 내보내지 않는다. 반의 수강 기록을 못 읽었으면 보류.
//   ④ 한 반에서 한 번에 내보낼 수가 많고 보드의 절반을 넘으면 그 반은 통째로 보류한다(반이 통째로 바뀐 것은 사람이 확인).
//   ⑤ 한 회차 전체 상한. 넘으면 남은 것은 다음 동기화가 이어서 한다.
//   선생님: ⑥ 우리가 아는 선생님(aywa 직원 ↔ ClassNote 선생님 대응표)만 — 모르는 계정(원장·관리자·시험 계정)은 건드리지 않는다.
//          ⑦ 그 반의 담임이 비어 있거나 재직 중이 아니면 아무도 해제하지 않는다
//          ⑧ 지금 담임·예약된 새 담임·교시 담당(앞으로 시작할 교시 · 이름만 적힌 교시 포함)·위임은 남긴다.
//          ⑨ 남길 사람 중 대응표에 없는 이름이 있으면 그 반은 보류한다(이름이 달라 같은 사람을 못 알아본 것일 수 있다).
//          ⑩ 남길 사람 중 한 명 이상이 그 반 보드에 **이미 연결돼 있을 때만** 푼다(풀고 나서 선생님이 0명인 보드를 만들지 않는다).
//      🔑 aywa가 기준이다(원장 *"강사 배정 및 해제만 에이와와 통일"*) — 그 반을 함께 보는 선생님은 aywa에 교시 담당·위임으로
//         적어야 남는다. ClassNote 화면에서 손으로만 붙인 연결은 다음 동기화가 푼다.

import { childNameConsistent, reservedBoardName } from "./class-board-plan.mjs";
import { normBoard } from "./board-safety.mjs";
import { phoneMatches } from "./offboard-safety.mjs";

/** 한 반에서 이만큼을 넘고 보드 원아의 절반도 넘으면 통째로 보류. */
export const RELEASE_CLASS_SOFT_LIMIT = 4;
/** 한 회차에 내보내는 원아 상한. */
export const RELEASE_RUN_LIMIT = 40;
/** 한 회차에 해제하는 선생님 연결 상한. */
export const TEACHER_RELEASE_RUN_LIMIT = 20;

/** 1인 보드 이름(`(과목)이름`)이 가리키는 학생 이름(공백 제거). 1인 보드 모양이 아니면 null. */
export function personalOwnerName(boardName) {
  const m = normBoard(boardName).match(/^\([^)]*\)(.+)$/);
  return m ? m[1] : null;
}

/**
 * 원아 해제 계획.
 * @param {Array<{classId:string, className:string, board:{action:string,id?:number,name?:string}, extraChildren?:Array<{id:number,name:string}>}>} plans
 *   최신 계획(보드 원아를 방금 읽은 것)
 * @param {object} ctx
 * @param {Map<string, {open:string[], ended:string[]}>} ctx.enrollmentsByClass  반 → open = **열린 수강**이 있는 학생 id(휴원·시작 전 포함) ·
 *   ended = 그 반 수강이 끝난 기록이 있는 학생 id. 반이 없으면(조회 누락) 보류.
 * @param {Map<string,{id:string,name:string,phones?:string[]}>} ctx.students  전 학생(유효이름·전화)
 * @param {Map<number, Array<{id:number}>>} ctx.membersByBoard
 * @param {Map<number,{phone:string|null, boardNames:string[]}>} ctx.admissions  운영관리 명부(원아 → 보호자 전화·소속 보드 이름)
 * @param {Map<number,string>} ctx.childLinks  원아 id → 학생 id(0185a)
 * @param {number} [ctx.runLimit]
 * @returns {{ releases: Array<{classId:string, className:string, boardId:number, childId:number, childName:string, studentId:string|null, studentName:string, reason:string}>,
 *            held: Array<{className:string, childName:string, why:string, text:string}> }}  why = 보류 사유만(해제 리스트 라벨용)
 */
export function planChildReleases(plans, { enrollmentsByClass, students, membersByBoard, admissions, childLinks, runLimit = RELEASE_RUN_LIMIT }) {
  // 유효이름(공백 제거) → 학생 id들 — 1인 보드 주인을 학생으로 되짚는다.
  const byName = new Map();
  for (const s of students.values()) {
    const k = normBoard(s.name);
    if (k) byName.set(k, [...(byName.get(k) ?? []), s.id]);
  }
  const releases = [];
  const held = [];
  const hold = (p, ch, why) => held.push({ className: p.className, childName: ch.name, why, text: `원아 해제 보류: ${ch.name} — ${why}` });

  for (const p of plans ?? []) {
    if (p.board?.action !== "exists" || p.board.id == null) continue;
    const extras = p.extraChildren ?? [];
    if (!extras.length) continue;
    // 반 보드만 — 1인 보드·전체방 모양의 이름이 붙은 보드에서는 아무도 내보내지 않는다(연결표가 틀렸을 때의 마지막 방어).
    if (reservedBoardName(p.board.name ?? p.className) || reservedBoardName(p.className)) {
      for (const ch of extras) hold(p, ch, "반 보드 이름이 1인 보드·전체방 모양이라 손대지 않습니다");
      continue;
    }
    const rec = enrollmentsByClass.get(p.classId);
    // 이 반의 수강 기록을 읽지 못했다 — 아무도 내보내지 않는다.
    if (!rec) {
      for (const ch of extras) hold(p, ch, "에이와 반 수강 기록을 읽지 못해 확인할 수 없습니다");
      continue;
    }
    const keeperIds = rec.open ?? [];
    const ended = new Set(rec.ended ?? []);
    const keepers = keeperIds.map((id) => students.get(id)).filter(Boolean);
    if (keepers.length !== keeperIds.length) {
      for (const ch of extras) hold(p, ch, "반 명단의 학생 정보를 다 읽지 못했습니다");
      continue;
    }
    const keeperSet = new Set(keeperIds);
    const keeperNames = new Set(keepers.map((k) => normBoard(k.name)));
    const mine = [];
    for (const ch of extras) {
      const adm = admissions.get(Number(ch.id)) ?? null;
      // 명부에 없는 원아 — 1인 보드·보호자 전화를 대조할 수 없다. 원아 링크 하나만 믿고 내보내지 않는다(배정 쪽 가드와 같은 규칙).
      if (!adm) { hold(p, ch, "ClassNote 운영관리 명부에 없어 누구의 원아인지 대조할 수 없습니다"); continue; }
      const linked = childLinks.get(Number(ch.id)) ?? null;
      const ownerNames = [...new Set((adm.boardNames ?? []).map(personalOwnerName).filter(Boolean))];
      // ① 이 반 학생의 원아일 수 있다 — 하나라도 걸리면 보류.
      const twin = keepers.find((k) => childNameConsistent(k.name, ch.name));
      if (twin) { hold(p, ch, `이 반 학생 '${twin.name}'의 원아일 수 있습니다(이름이 이어짐)`); continue; }
      if (linked && keeperSet.has(linked)) { hold(p, ch, `이 반 학생 '${students.get(linked)?.name ?? "?"}'에 연결된 원아입니다`); continue; }
      const boardOwner = ownerNames.find((n) => keeperNames.has(n));
      if (boardOwner) { hold(p, ch, `이 반 학생 '${boardOwner}'의 1인 보드에 있는 원아입니다`); continue; }
      const phoneTwin = adm.phone ? keepers.find((k) => phoneMatches(k.phones ?? [], [adm.phone]) === true) : null;
      if (phoneTwin) { hold(p, ch, `이 반 학생 '${phoneTwin.name}'와 보호자 전화가 같습니다(형제일 수 있어 확인 필요)`); continue; }
      // ② 누구의 원아인지 알아야 내보낸다.
      // 1인 보드 이름은 같은 이름의 학생을 전부 가리킨다(퇴원한 동명 학생 포함). 원아 링크가 그 후보 안에 있으면 링크가 그중 누구인지를 정한다.
      const named = ownerNames.map((n) => byName.get(n) ?? []);
      const owners = new Set(linked ? [linked] : []);
      if (!(linked && named.every((ids) => ids.includes(linked)))) for (const ids of named) for (const id of ids) owners.add(id);
      if (!owners.size) { hold(p, ch, "누구의 원아인지 확인하지 못했습니다(원아 연결·1인 보드 없음)"); continue; }
      // 후보가 둘 이상 — 이름이 같은 두 학생이거나, 원아 링크와 1인 보드 주인이 서로 다른 학생을 가리킨다. 어느 쪽인지 사람이 본다.
      if (owners.size > 1) { hold(p, ch, `누구의 원아인지 하나로 정하지 못했습니다(후보 ${owners.size}명 — 이름이 같은 학생이거나 원아 연결이 1인 보드와 다름)`); continue; }
      // ③ 그 학생의 이 반 수강이 끝난 기록이 있어야 한다(수강한 적 없는 학생의 원아는 사람이 넣은 것일 수 있다).
      const owner = [...owners][0];
      const ownerName = students.get(owner)?.name ?? "?";
      if (!ended.has(owner)) { hold(p, ch, `'${ownerName}' 학생은 이 반 수강 기록이 없습니다(누가 넣었는지 확인 필요)`); continue; }
      mine.push({
        classId: p.classId, className: p.className, boardId: Number(p.board.id), childId: Number(ch.id), childName: ch.name,
        studentId: owner, studentName: ownerName, reason: `${ownerName} 학생의 이 반 수강이 끝났습니다(반 이동·수강 종료)`,
      });
    }
    // ④ 한꺼번에 너무 많다 — 반이 통째로 바뀐 것인지 사람이 본다.
    const boardSize = (membersByBoard.get(Number(p.board.id)) ?? []).length;
    if (mine.length > RELEASE_CLASS_SOFT_LIMIT && mine.length * 2 > boardSize) {
      for (const m of mine) hold(p, { name: m.childName }, `이 반 해제 대상이 ${mine.length}명으로 반 보드(${boardSize}명)의 절반을 넘습니다(ClassNote에서 직접 확인)`);
      continue;
    }
    releases.push(...mine);
  }
  // ⑤ 회차 상한
  if (releases.length > runLimit) {
    for (const r of releases.splice(runLimit)) {
      const why = "한 번에 해제하는 수를 넘어 다음 동기화에서 합니다";
      held.push({ className: r.className, childName: r.childName, why, text: `원아 해제 미룸: ${r.childName} — ${why}` });
    }
  }
  return { releases, held };
}

/**
 * 선생님 해제 계획 — 반 보드에 연결돼 있지만 **지금 그 반 담당이 아닌** 선생님.
 * @param {{ boards: Array<{className:string, boardId:number, boardName?:string, homeroom:string|null, homeroomActive?:boolean, keepNames:string[]}>,
 *   emps: Array<{id:number, teacher_id:number, class_in_charge:number, is_approved?:boolean}>,
 *   teacherMap: Record<string, number>, runLimit?: number }} a
 *   boards = 이번 동기화가 본 반 보드(확인된 것) · keepNames = 남길 사람(담임·교시 담당·위임)의 aywa 표시 이름
 * @returns {{ releases: Array<{className:string, boardId:number, employmentId:number, teacherId:number, teacher:string}>, held: Array<{className:string, text:string}> }}
 */
export function planTeacherReleases({ boards, emps, teacherMap, runLimit = TEACHER_RELEASE_RUN_LIMIT }) {
  const nameOf = new Map(Object.entries(teacherMap).map(([name, id]) => [Number(id), name]));
  const releases = [];
  const held = [];
  for (const b of boards ?? []) {
    if (b.boardId == null) continue;
    // ⑥ 아는 선생님의 살아 있는 연결만 본다(해제된 연결은 is_approved:false로 남는다).
    const linked = (emps ?? []).filter((e) => Number(e.class_in_charge) === Number(b.boardId) && e.is_approved === true && nameOf.has(Number(e.teacher_id)));
    if (!linked.length) continue;
    const keep = new Set((b.keepNames ?? []).map((n) => teacherMap[n]).filter((id) => id != null).map(Number));
    const stale = linked.filter((e) => !keep.has(Number(e.teacher_id)));
    if (!stale.length) continue;
    const names = stale.map((e) => nameOf.get(Number(e.teacher_id))).join(", ");
    if (reservedBoardName(b.boardName ?? b.className)) { held.push({ className: b.className, text: `담임 해제 보류(${names}) — 반 보드 이름이 1인 보드·전체방 모양이라 손대지 않습니다` }); continue; }
    // ⑦ 담임이 비어 있거나 재직 중이 아닌 반 — 누가 맡는지 정해지지 않은 상태에서 선생님을 빼지 않는다.
    if (!b.homeroom) { held.push({ className: b.className, text: `담임 해제 보류(${names}) — 에이와에 이 반 담임이 없습니다` }); continue; }
    if (b.homeroomActive === false) { held.push({ className: b.className, text: `담임 해제 보류(${names}) — 이 반 담임 '${b.homeroom}'이(가) 재직 중이 아닙니다(새 담임을 정한 뒤 정리됩니다)` }); continue; }
    // ⑨ 남길 사람 중 대응표에 없는 이름 — 같은 사람을 다른 이름으로 적은 것일 수 있다.
    const unknown = (b.keepNames ?? []).filter((n) => teacherMap[n] == null);
    if (unknown.length) { held.push({ className: b.className, text: `담임 해제 보류(${names}) — 이 반 담당 '${unknown.join(", ")}'의 ClassNote 계정을 몰라 확인할 수 없습니다` }); continue; }
    // ⑩ 남길 사람이 이 보드에 한 명도 연결돼 있지 않다 — 풀면 선생님이 0명인 보드가 된다.
    if (!linked.some((e) => keep.has(Number(e.teacher_id)))) { held.push({ className: b.className, text: `담임 해제 보류(${names}) — 지금 담당이 아직 이 반 보드에 연결되지 않았습니다` }); continue; }
    for (const e of stale) releases.push({ className: b.className, boardId: Number(b.boardId), employmentId: Number(e.id), teacherId: Number(e.teacher_id), teacher: nameOf.get(Number(e.teacher_id)) });
  }
  if (releases.length > runLimit) {
    for (const r of releases.splice(runLimit)) held.push({ className: r.className, text: `담임 해제 미룸(${r.teacher}) — 한 번에 해제하는 수를 넘어 다음 동기화에서 합니다` });
  }
  return { releases, held };
}

/** 계획에서 해제한 원아를 뺀다(그 뒤의 기록·해제 리스트·보고서가 지금 상태를 말하게). 계획 배열을 제자리에서 고친다. */
export function dropReleasedExtras(plans, released) {
  const gone = new Map();
  for (const r of released ?? []) gone.set(Number(r.boardId), (gone.get(Number(r.boardId)) ?? new Set()).add(Number(r.childId)));
  for (const p of plans ?? []) {
    if (p.board?.action !== "exists" || p.board.id == null) continue;
    const ids = gone.get(Number(p.board.id));
    if (!ids?.size) continue;
    p.extraChildren = (p.extraChildren ?? []).filter((c) => !ids.has(Number(c.id)));
    p.extras = p.extraChildren.map((c) => c.name);
  }
}

