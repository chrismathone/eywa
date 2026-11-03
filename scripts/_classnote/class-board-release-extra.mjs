// scripts/_classnote/class-board-release-extra.mjs — 자동 해제 **넓힌 대상**(영어 반 방 · 종강 반 보드 · 1인 보드)의 조회 묶음.
// aywa DB는 읽기만 · ClassNote는 GET만(보드 원아 목록). 계획 만들기는 class-board-release-targets.mjs(순수), 판정은 class-board-release.mjs.
//
// 원장 2026-11-03 *"수강종료(즉, 남은 과목이 1개라도 있거나 일부 반을 종료하는경우)는 즉시즉시"* — 매일 정기 동기화(전체)에서만 돈다.
// '지금 동기화'(반 몇 개만 보는 실행)는 그 반들만 본다는 규약(0302a scoped · 종강 반 연결 지키기도 전체 실행의 몫)이라 여기를 부르지 않는다
// — 수강 종료는 종료일 **다음 날**부터 '끝난 기록'이 되고, 그날 새벽 정기 동기화가 가장 이른 정리 시점이다.
// 🔴 한 보드의 원아를 못 읽으면 그 보드만 이번에 건너뛴다(빈 목록으로 삼키지 않는다 — 읽지 못한 보드에서는 아무도 내보내지 않는다).

import { fetchBoardChildren } from "./classnote-admin-core.mjs";
import { loadClassEnrollments, loadClosedBoards, loadEnglishRooms, loadOpenEnglish, loadSubjectEnrollments } from "./class-board-release-load.mjs";
import { loadLinkedBoards } from "./math-class-boards-load.mjs";
import { buildClosedPlans, buildEnglishPlans, buildPersonalPlans, closedBoardDue } from "./class-board-release-targets.mjs";

const kstToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });

/**
 * @param {import("postgres").Sql} sql
 * @param {import("playwright").Page} page
 * @param {{ tenant:string, centerId:number, boards:Array<{id:number,name:string}>, admissions:Map, students:Map, childLinks:Map<number,string>, log?:(s:string)=>void }} a
 *   boards·admissions = 방금 읽은 계획(loadPlan)의 것 · students = loadAywa의 지점 전체 학생
 * @returns {Promise<{ plans: object[], closedPlans: object[], enrollmentsByClass: Map, membersByBoard: Map, englishBoardIds: Set<number>|null, notes: Array<{group:string, className:string, text:string}> }>}
 *   plans = 판정에 넘길 계획(영어 반 방 → 종강 반 보드 → 1인 보드 순) · notes = 보고서 줄(건너뛴 것) ·
 *   englishBoardIds = 영어 반 방 표의 보드 번호(표가 없으면 null) — 운영 중 수학 반 보드 계획도 같은 번호면 둔다(F2)
 */
export async function loadExtraReleaseTargets(sql, page, { tenant, centerId, boards, admissions, students, childLinks, log = console.log }) {
  const today = kstToday();
  const live = new Set((boards ?? []).map((b) => Number(b.id)));
  const notes = [];
  const [rooms, closed, subjectEnrollments, mathLinks, openEnglish] = await Promise.all([
    loadEnglishRooms(sql, tenant), loadClosedBoards(sql, tenant), loadSubjectEnrollments(sql, tenant), loadLinkedBoards(sql, tenant), loadOpenEnglish(sql, tenant),
  ]);
  const englishBoardIds = rooms ? new Set(rooms.map((r) => Number(r.boardId))) : null;
  if (!rooms) notes.push({ group: "held", className: "", text: "영어 반 방 연결 표를 아직 쓸 수 없어 영어 반 방 자동 해제를 건너뛰었습니다" });

  // 원아를 읽을 보드 — 살아 있는 영어 반 방(종강 7일 전은 뺀다) · 종강 7일이 지난 반 보드.
  const want = new Map();
  for (const r of rooms ?? []) {
    const closedAt = r.closedAt ? String(r.closedAt).slice(0, 10) : null;
    if (r.isActive && live.has(r.boardId) && (!closedAt || closedAt >= today || closedBoardDue(closedAt, today))) want.set(r.boardId, `영어 반 방 · ${r.className}`);
  }
  for (const c of closed) if (live.has(c.boardId) && closedBoardDue(c.closedAt, today)) want.set(c.boardId, `종강 반 보드 · ${c.className}`);
  const membersByBoard = new Map();
  for (const [id, label] of want) {
    try {
      membersByBoard.set(id, await fetchBoardChildren(page, centerId, id));
    } catch (e) {
      notes.push({ group: "held", className: label, text: "원아 목록을 읽지 못해 이번에는 자동 해제를 하지 않았습니다 — 다음 동기화에서 다시 봅니다" });
      log(`[class-board] ${label}: 원아 목록 조회 실패 — ${String(e?.message ?? e).slice(0, 120)}`);
    }
  }
  const enrollmentsByClass = await loadClassEnrollments(sql, tenant, [...new Set([...(rooms ?? []).map((r) => r.classId), ...closed.map((c) => c.classId)])]);

  const english = rooms ? buildEnglishPlans({ rooms, liveBoardIds: live, membersByBoard, enrollmentsByClass, childLinks, today, mathBoardIds: mathLinks.values(), openEnglish }) : { plans: [], held: [] };
  const { plans: closedPlans, waiting, held: closedHeld } = buildClosedPlans({ closed, liveBoardIds: live, membersByBoard, today, englishBoardIds: englishBoardIds ?? [] });
  for (const h of [...english.held, ...closedHeld]) notes.push({ group: "held", ...h });
  for (const w of waiting) log(`[class-board] 종강 반 보드 ${w.className}: 종강 ${w.closedAt} — ${w.due}부터 정리합니다(늦은 보고서 발송 기한)`);
  const testNames = [...students.values()].filter((s) => s.isTest).map((s) => s.name);
  // 표(수학 반 보드·영어 반 방)에 있는 번호는 이름이 `(과목)…`이어도 1인 보드 계획에서 뺀다(A8). 영어 방 표를 못 읽었으면 수학 표만.
  const personal = buildPersonalPlans({ admissions, students, subjectEnrollments, childLinks, skipNames: testNames, linkedBoardIds: [...mathLinks.values(), ...(englishBoardIds ?? [])] });
  for (const [k, v] of personal.enrollmentsByClass) enrollmentsByClass.set(k, v);
  for (const [k, v] of personal.membersByBoard) if (!membersByBoard.has(k)) membersByBoard.set(k, v);
  return { plans: [...english.plans, ...closedPlans, ...personal.plans], closedPlans, enrollmentsByClass, membersByBoard, englishBoardIds, notes };
}
