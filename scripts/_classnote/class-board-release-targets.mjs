// scripts/_classnote/class-board-release-targets.mjs — 자동 해제 **대상 넓히기**(순수 — playwright·postgres import 금지).
//
// 원장 2026-11-03: *"수강종료(즉, 남은 과목이 1개라도 있거나 일부 반을 종료하는경우)는 즉시즉시"* — 지금까지 자동 해제는 운영 중인
// 수학 반 보드(0302a)에서만 돌아, ClassNote에 이런 잔류가 남았다(2026-11-03 점검): 종강한 수학 반 보드 · 영어 반 방(s2_0006) 반 이동·퇴원 ·
// 1인 보드 `(수학)이름`·`(영어)이름`. 여기서는 그 보드들을 **판정(class-board-release.mjs `planChildReleases`)이 받는 모양**으로 만든다 —
// 보드 + 명단 밖 원아 + 열린/끝난 수강. 가드는 판정 한 벌이 그대로 건다(새로 만들지 않는다).
//   · 영어 반 방 = 수학 반 보드와 같은 가드. 선생님 연결은 범위 밖(건드리지 않는다).
//   · 종강 반 보드 = 종강 **7일 뒤**(늦은 보고서 발송 기한 '오늘 포함 7일'이 지난 다음 날)부터 원아 + 선생님. 보드와 지난 글은 남긴다.
//   · 1인 보드 = '반' 대신 **그 학생의 그 과목** — 그 과목에 열린 수강이 없고 끝난 기록이 있을 때. 보드 삭제는 안 한다. 테스트 보드는 손대지 않는다.

import { BOARD_KIND_LABEL } from "./class-board-release.mjs";
import { normBoard } from "./board-safety.mjs";
import { PROTECTED_STUDENT_NAMES } from "./offboard-safety.mjs";

/** 종강 뒤 이만큼 지나야 정리한다 — 늦은 보고서 발송 기한(오늘 포함 7일 = 수업일 + 6일, classnote-core.mjs too_old)이 지난 다음 날. */
export const CLOSED_BOARD_GRACE_DAYS = 7;

/** 1인 보드 해제에서 손대지 않는 이름(테스트 원아 보드) — 퇴원처리 보호 이름 + 테스트 발송에 쓰는 원아. 테스트 학생(is_test)은 호출부가 더한다. */
export const PERSONAL_RELEASE_SKIP_NAMES = [...PROTECTED_STUDENT_NAMES, "학원육", "학원일", "최성효T"];

/** 1인 보드 접두 → aywa 과목. */
const PERSONAL_SUBJECTS = { 수학: { key: "math", label: "수학" }, 영어: { key: "english", label: "영어" } };

/** 'YYYY-MM-DD' + n일. */
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 종강 반 보드를 정리할 때가 됐나 — 종강일 + 7일 ≤ 오늘. 날짜를 모르면 아니다(정리하지 않는다). */
export function closedBoardDue(closedAt, today) {
  const d = String(closedAt ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return addDays(d, CLOSED_BOARD_GRACE_DAYS) <= today;
}

const labelled = (kind, name) => `${BOARD_KIND_LABEL[kind]} · ${name}`;

/**
 * 🔴 한 보드가 에이와 반 여럿에 이어져 있으면 그 보드는 통째로 둔다(2026-11-03 리뷰 F2). 영어 반 방 표(s2_0006)는 board_id가 유니크가
 * 아니다 — 한 방이 A·B 두 반에 이어진 채 A→B로 옮긴 학생은, A 계획에서 'A반에 끝난 기록'(③)으로 해제돼 **B반에서 쓰는 방을 잃는다**
 * (계획은 반마다 따로 열린 수강을 뺀다). 같은 번호가 수학 반 보드 표(0302a)와 영어 반 방 표 양쪽에 있어도 같은 까닭으로 둔다.
 */
export const sharedRoomReason = (n) => `이 반 방이 에이와 반 ${n}개에 이어져 있어 자동 해제하지 않습니다`;
export const MATH_ENGLISH_SHARED_REASON = "이 보드가 수학 반 보드와 영어 반 방 양쪽에 이어져 있어 자동 해제하지 않습니다";

/**
 * 운영 중 수학 반 보드 계획에서 영어 반 방과 같은 번호인 보드의 명단 밖 원아를 비운다(해제 0 · 원아마다 보류 줄 — 판정의 held와 같은 모양).
 * @returns {{ plans: object[], held: Array<{className:string, childName:string, why:string, text:string}> }}
 */
export function holdSharedBoards(plans, englishBoardIds) {
  const shared = new Set([...(englishBoardIds ?? [])].map(Number));
  const held = [];
  const out = (plans ?? []).map((p) => {
    if (!shared.has(Number(p?.board?.id))) return p;
    const names = p.extraChildren?.length ? p.extraChildren.map((c) => c.name ?? "?") : p.extras ?? [];
    if (!names.length) return p;
    for (const childName of names) held.push({ className: p.className, childName, why: MATH_ENGLISH_SHARED_REASON, text: `원아 해제 보류: ${childName} — ${MATH_ENGLISH_SHARED_REASON}` });
    return { ...p, extraChildren: [], extras: [] };
  });
  return { plans: out, held };
}
const childOf = (m) => ({ id: Number(m.id), name: String(m.name ?? m.child_name ?? "").trim() || "?" });

/**
 * 종강 반 보드 계획 — 0302a 연결이 남은 종강 수학 반 중 **종강 7일이 지났고 보드가 살아 있고 원아를 읽은** 것만.
 * @param {{ closed: Array<{classId:string, className:string, boardId:number, boardName:string, closedAt:string}>,
 *   liveBoardIds: Iterable<number>, membersByBoard: Map<number, Array<{id:number,name?:string}>>, today: string }} a
 * `englishBoardIds` = 영어 반 방 표의 보드 번호 전부 — 같은 번호면 그 보드는 둔다(F2).
 * @returns {{ plans: object[], waiting: Array<{className:string, closedAt:string, due:string}>, held: Array<{className:string, text:string}> }}
 *   waiting = 아직 7일이 안 된 보드(보고서 안내용) · held = 통째로 둔 보드(보고서 줄)
 */
export function buildClosedPlans({ closed, liveBoardIds, membersByBoard, today, englishBoardIds = [] }) {
  const live = new Set([...liveBoardIds].map(Number));
  const english = new Set([...englishBoardIds].map(Number));
  const plans = [];
  const waiting = [];
  const held = [];
  for (const c of closed ?? []) {
    if (!live.has(Number(c.boardId))) continue; // 보드가 지워졌다 — 할 일이 없다(연결은 동기화가 걷는다)
    if (english.has(Number(c.boardId))) { held.push({ className: labelled("closed", c.className), text: `원아 해제 보류 — ${MATH_ENGLISH_SHARED_REASON}` }); continue; }
    if (!closedBoardDue(c.closedAt, today)) {
      if (/^\d{4}-\d{2}-\d{2}/.test(String(c.closedAt ?? ""))) waiting.push({ className: c.className, closedAt: String(c.closedAt).slice(0, 10), due: addDays(String(c.closedAt).slice(0, 10), CLOSED_BOARD_GRACE_DAYS) });
      continue;
    }
    const members = membersByBoard.get(Number(c.boardId));
    if (!Array.isArray(members)) continue; // 원아를 못 읽었다 — 이번에는 손대지 않는다
    const extraChildren = members.map(childOf);
    plans.push({
      kind: "closed", teachers: true, classId: c.classId, className: labelled("closed", c.className), closedAt: String(c.closedAt).slice(0, 10),
      board: { action: "exists", id: Number(c.boardId), name: c.boardName ?? c.className }, assign: [], hold: [], extraChildren, extras: extraChildren.map((x) => x.name),
    });
  }
  return { plans, waiting, held };
}

/**
 * 영어 반 방 계획 — s2_0006 연결(사람이 확인한 반 ↔ 반 방). 명단 밖 원아 = 방 원아 − **이 반에 열린 수강이 있는 학생에게 연결(0185a)된 원아**
 * (그 밖은 판정이 ①로 다시 본다 — 이름·1인 보드·보호자 전화). 폐지 반·종강 7일이 안 된 반은 손대지 않는다. 종강 7일이 지난 반은
 * 종강 보드로(같은 판정 — ④는 최근 7일 안에 끝난 수강만 센다) — 영어 방의 선생님 연결은 범위 밖이라 `teachers:false`.
 * 🔴 한 방이 에이와 반 둘 이상에 이어져 있거나(표의 모든 줄로 센다 — 폐지·종강 반 포함) 수학 반 보드 표에도 있으면 통째로 둔다(F2).
 * @param {{ rooms: Array<{classId:string, className:string, boardId:number, boardName:string, isActive:boolean, closedAt:string|null}>,
 *   liveBoardIds: Iterable<number>, membersByBoard: Map<number, Array<{id:number,name?:string}>>,
 *   enrollmentsByClass: Map<string,{open:string[], ended:string[]}>, childLinks: Map<number,string>, today: string, mathBoardIds?: Iterable<number>,
 *   openEnglish?: Array<{studentId:string, classId:string, className:string}> }} a
 *   openEnglish = 열린 영어 수강(활성 반) — 주인이 **방 연결이 없는 다른 영어 반**에 다니면 판정이 보류한다(A6 · 계획의 `elsewhere`)
 * @returns {{ plans: object[], held: Array<{className:string, text:string}> }}  held = 통째로 둔 방(보고서 줄 — 방마다 한 줄)
 */
export function buildEnglishPlans({ rooms, liveBoardIds, membersByBoard, enrollmentsByClass, childLinks, today, mathBoardIds = [], openEnglish = [] }) {
  const live = new Set([...liveBoardIds].map(Number));
  const math = new Set([...mathBoardIds].map(Number));
  const classesOf = new Map();
  for (const r of rooms ?? []) classesOf.set(Number(r.boardId), new Set([...(classesOf.get(Number(r.boardId)) ?? []), r.classId]));
  // 학생 → 방 연결이 없는 열린 영어 반 이름들(A6). 방에 이어진 반은 표의 모든 줄로 센다.
  const roomClasses = new Set((rooms ?? []).map((r) => r.classId));
  const elsewhere = new Map();
  for (const e of openEnglish ?? []) {
    if (roomClasses.has(e.classId)) continue;
    elsewhere.set(e.studentId, [...new Set([...(elsewhere.get(e.studentId) ?? []), e.className ?? "?"])]);
  }
  const plans = [];
  const held = [];
  const heldBoards = new Set();
  for (const r of rooms ?? []) {
    if (!r.isActive || !live.has(Number(r.boardId))) continue;
    const n = classesOf.get(Number(r.boardId))?.size ?? 1;
    if (n > 1 || math.has(Number(r.boardId))) {
      if (!heldBoards.has(Number(r.boardId))) {
        heldBoards.add(Number(r.boardId));
        held.push({ className: labelled("english", r.boardName ?? r.className), text: `원아 해제 보류 — ${n > 1 ? sharedRoomReason(n) : MATH_ENGLISH_SHARED_REASON}` });
      }
      continue;
    }
    const closedAt = r.closedAt ? String(r.closedAt).slice(0, 10) : null;
    const closed = closedAt != null && closedAt < today;
    if (closed && !closedBoardDue(closedAt, today)) continue;
    const members = membersByBoard.get(Number(r.boardId));
    if (!Array.isArray(members)) continue;
    const open = new Set(enrollmentsByClass.get(r.classId)?.open ?? []);
    const extraChildren = members.map(childOf).filter((ch) => !open.has(childLinks.get(ch.id)));
    const kind = closed ? "closed" : "english";
    plans.push({
      kind, teachers: false, classId: r.classId, className: labelled("english", r.className), ...(closed ? { closedAt } : {}), elsewhere,
      board: { action: "exists", id: Number(r.boardId), name: r.boardName ?? r.className }, assign: [], hold: [], extraChildren, extras: extraChildren.map((x) => x.name),
    });
  }
  return { plans, held };
}

/**
 * 1인 보드 계획 — 운영관리 명부(원아별 지금 소속 보드)에서 `(수학)이름`·`(영어)이름` 보드를 모은다(보드 원아를 따로 읽지 않는다).
 * 단위 = 그 보드 주인 이름의 학생 × 그 과목. **그 이름의 학생 중 누구라도 그 과목에 열린 수강이 있으면**(휴원·시작 전 포함) 그 보드는
 * 보지 않는다(지금 다니는 학생 — 해제 대상이 아니다). 남은 보드의 원아는 판정이 ①②③으로 본다:
 *   ① 대조 상대 = 그 과목에 열린 수강이 있는 **학생 전체**(리뷰 A5 — 이름 이어짐·연결·보호자 전화) + 그 과목에 끝난 기록이 있는 휴원 학생(A4)
 *   · 수학 반 보드 표·영어 반 방 표에 있는 보드 번호는 이름이 `(과목)…`이어도 1인 보드로 보지 않는다(A8 — `linkedBoardIds`)
 *   ③ 끝난 기록 = 주인 이름의 학생·연결된 학생 중 그 과목 수강이 끝난 기록이 있는 학생
 * @param {{ admissions: Map<number,{name?:string, boards?:Array<{id:number,name:string}>}>,
 *   students: Map<string,{id:string,name:string,isTest?:boolean}>,
 *   subjectEnrollments: Map<string, Record<string,{open:boolean, ended:boolean}>>, childLinks: Map<number,string>, skipNames?: Iterable<string>,
 *   linkedBoardIds?: Iterable<number> }} a
 * @returns {{ plans: object[], enrollmentsByClass: Map<string,{open:string[], ended:string[]}>, membersByBoard: Map<number, Array<{id:number}>> }}
 */
export function buildPersonalPlans({ admissions, students, subjectEnrollments, childLinks, skipNames = [], linkedBoardIds = [] }) {
  const skip = new Set([...PERSONAL_RELEASE_SKIP_NAMES, ...skipNames].map(normBoard));
  // `(영어)…`·`(수학)…`로 시작해도 수학 반 보드 표·영어 반 방 표에 있는 번호는 1인 보드가 아니다(리뷰 A8 — 그 보드는 반 보드 판정 몫).
  const linkedIds = new Set([...(linkedBoardIds ?? [])].map(Number));
  const boards = new Map(); // 보드 번호 → { id, name, subject, owner, children[] }
  for (const [childId, a] of admissions ?? []) {
    for (const b of a?.boards ?? []) {
      const m = normBoard(b.name).match(/^\((수학|영어)\)(.+)$/);
      if (!m) continue;
      const id = Number(b.id);
      if (!Number.isSafeInteger(id) || id <= 0 || linkedIds.has(id)) continue;
      if (!boards.has(id)) boards.set(id, { id, name: String(b.name).trim(), subject: PERSONAL_SUBJECTS[m[1]], owner: m[2], children: [] });
      boards.get(id).children.push({ id: Number(childId), name: String(a.name ?? "").trim() || "?" });
    }
  }
  const byName = new Map();
  for (const s of students.values()) {
    const k = normBoard(s.name);
    if (k) byName.set(k, [...(byName.get(k) ?? []), s]);
  }
  const rec = (sid, key) => subjectEnrollments.get(sid)?.[key] ?? { open: false, ended: false };
  // ① 대조 상대 = 그 과목에 열린 수강이 있는 **학생 전체**(리뷰 A5 — 연결된 학생만 보면 한 사람이 기록 둘로 갈린 경우(#148)를 놓친다) +
  //   그 과목에 끝난 기록이 있는 휴원 학생(A4).
  const openOf = { math: [], english: [] };
  const onHoldOf = { math: [], english: [] };
  for (const s of students.values()) {
    for (const key of ["math", "english"]) {
      const r = rec(s.id, key);
      if (r.open) openOf[key].push(s.id);
      else if (r.ended && s.status === "on_hold") onHoldOf[key].push(s.id);
    }
  }
  const plans = [];
  const enrollmentsByClass = new Map();
  const membersByBoard = new Map();
  for (const b of boards.values()) {
    if (skip.has(b.owner)) continue;
    const named = byName.get(b.owner) ?? [];
    if (named.some((s) => s.isTest)) continue;
    // 그 이름의 학생이 그 과목을 지금 다닌다 — 해제 대상이 아니다(보고서에도 싣지 않는다).
    if (named.some((s) => rec(s.id, b.subject.key).open)) continue;
    const linked = [...new Set(b.children.map((ch) => childLinks.get(ch.id)).filter((sid) => sid && students.has(sid)))];
    const candidates = [...new Set([...named.map((s) => s.id), ...linked])];
    const classId = `personal:${b.id}`;
    const ended = candidates.filter((sid) => rec(sid, b.subject.key).ended);
    enrollmentsByClass.set(classId, {
      open: openOf[b.subject.key],
      onHold: onHoldOf[b.subject.key],
      ended,
      // 그 과목이 마지막으로 끝난 날(해제 ④ 최근 7일 · ④-b 남길 보드 고르기)
      endedOn: Object.fromEntries(ended.map((sid) => [sid, rec(sid, b.subject.key).endedOn ?? null]).filter(([, d]) => d)),
    });
    membersByBoard.set(b.id, b.children.map((ch) => ({ id: ch.id })));
    plans.push({
      kind: "personal", subjectLabel: b.subject.label, classId, className: labelled("personal", b.name),
      board: { action: "exists", id: b.id, name: b.name }, assign: [], hold: [], extraChildren: b.children, extras: b.children.map((ch) => ch.name),
    });
  }
  plans.sort((x, y) => x.className.localeCompare(y.className, "ko"));
  return { plans, enrollmentsByClass, membersByBoard };
}

/**
 * 종강 반 보드의 선생님 해제 대상(planTeacherReleases `closed`) — 원아 해제 뒤 그 보드에 남은 원아 수를 함께 넘긴다.
 * @param {object[]} plans  buildClosedPlans의 계획(원아 해제 전 원아 목록 그대로)
 * @param {Array<{boardId:number, childId:number}>} released  실제로(계획만 볼 때는 계획상) 내보낸 원아
 */
export function closedTeacherBoards(plans, released) {
  const gone = new Map();
  for (const r of released ?? []) gone.set(Number(r.boardId), (gone.get(Number(r.boardId)) ?? new Set()).add(Number(r.childId)));
  return (plans ?? [])
    .filter((p) => p.kind === "closed" && p.teachers === true && p.board?.id != null)
    .map((p) => {
      const out = gone.get(Number(p.board.id)) ?? new Set();
      return { className: p.className, boardId: Number(p.board.id), boardName: p.board.name, closed: true, remainingChildren: (p.extraChildren ?? []).filter((c) => !out.has(Number(c.id))).length };
    });
}
