// scripts/_classnote/sync-request-plan.mjs — **지금 반 보드 동기화**(0313a)의 판정부(순수 — Vitest가 import한다).
//
// 원장 2026-09-30 *"너무 과부하 일어나지 않게 필요한것만 동기화하게"* — 버튼은 새벽 동기화를 통째로 다시 돌리지 않는다.
// aywa DB만 보고(ClassNote 조회 0회) **0302a 기록과 달라진 반**만 고르고, 달라진 게 없으면 ClassNote에 로그인조차 하지 않는다.
//
// 반을 고르는 이유(우선순위 순 — 상한에 걸리면 앞쪽부터 한다):
//   ① 누른 자리가 지목한 반·학생의 반(scope) ② 연결 없는 새 반 ③ 반 이름이 바뀐 반 ④ 기록에 없는 학생이 있는 반(신입·반 이동)
//   ⑤ '배정 전' 보류가 있는 반 ⑥ 반을 떠난 학생이 기록에 남은 반 ⑦ 최근 등록 학생의 가입 대기 보류가 있는 반(학부모가 방금 가입했을 수 있다)
// 담임 변경은 aywa에 기록 시각이 없어 차이로 못 잡는다 — 새벽 정기 동기화가 한다(그 반을 지목해 누르면 함께 된다).
//
// ⚠️ 순수 유지 — playwright·postgres import 금지.
// 🔴 숫자(멈춤 30/20분)는 앱 `src/features/report-admin/classnote-sync.ts`와 같아야 한다(가드: classnote-sync.test.ts).

/** 대기가 이만큼 지나도 안 집혔으면 취소(분) — 앱 SYNC_PENDING_STALE_MIN과 같은 값. */
export const PENDING_STALE_MIN = 30;
/** 실행 중이 이만큼 지나면 멈춘 것(분) — 앱 SYNC_RUNNING_STALE_MIN과 같은 값. */
export const RUNNING_STALE_MIN = 20;
/** 한 번에 동기화하는 반 상한 — 반 하나 ≈ ClassNote 조회 (학생 수 × 3 + 몇) 건. 남은 반은 다음 누름·새벽이 한다. */
export const MAX_CLASSES_PER_RUN = 15;
/** 1인 보드 생성 + 원아 배정 상한(신입 준비). */
export const MAX_PROVISION_WRITES = 20;
/** '최근 등록'으로 보는 기간(일) — 이 안의 학생만 1인 보드 준비·가입 대기 재확인 대상. */
export const RECENT_DAYS = 14;

const WAIT_ASSIGN = "반 보드 배정 전";
// 학부모 가입·1인 보드가 풀리면 해결되는 보류(class-board-plan.mjs resolveStudentChildren의 사유 첫머리).
const JOIN_WAIT = ["1인 보드 없음", "ClassNote 미가입"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idList = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && UUID.test(x)))].slice(0, 50) : []);

/** DB scope(jsonb) → { full, classIds, studentIds }. 모르는 모양 = 전체(차이만 본다). 앱 normalizeScope와 같은 규칙. */
export function normalizeScope(raw) {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const classIds = idList(o.classIds);
  const studentIds = idList(o.studentIds);
  return { full: o.full === true || (!classIds.length && !studentIds.length), classIds, studentIds };
}

/**
 * 동기화할 반 고르기.
 * @param {object} a
 * @param {Array<{classId:string, className:string, studentIds:string[]}>} a.classes  대상 수학 반(loadAywa — 종강·미발송 제외)
 * @param {Map<string,{boardName:string}>} a.links  0302a 반 ↔ 보드
 * @param {Array<{class_id:string, student_id:string, status:string, reason:string|null}>} a.members  0302a 반 보드 학생 기록
 * @param {Set<string>} a.recentStudentIds  최근 등록 학생
 * @param {{full:boolean, classIds:string[], studentIds:string[]}} a.scope
 * @param {number} [a.max]
 * @returns {{ picked: Array<{classId:string, className:string, reasons:string[]}>, remaining: number }}
 */
export function selectClassesToSync({ classes, links, members, recentStudentIds, scope, max = MAX_CLASSES_PER_RUN }) {
  const memByClass = new Map();
  for (const m of members) {
    if (!memByClass.has(m.class_id)) memByClass.set(m.class_id, []);
    memByClass.get(m.class_id).push(m);
  }
  const scopeClass = new Set(scope.classIds);
  const scopeStudent = new Set(scope.studentIds);
  const out = [];
  for (const c of classes) {
    const reasons = []; // [우선순위, 사유]
    if (scopeClass.has(c.classId) || c.studentIds.some((s) => scopeStudent.has(s))) reasons.push([1, "지목한 반"]);
    if (scope.full) {
      const link = links.get(c.classId);
      const mem = memByClass.get(c.classId) ?? [];
      const inClass = new Set(c.studentIds);
      const recorded = new Set(mem.map((m) => m.student_id));
      if (!link) reasons.push([2, "새 반"]);
      else if (link.boardName !== c.className) reasons.push([3, "반 이름 변경"]);
      if (link && c.studentIds.some((s) => !recorded.has(s))) reasons.push([4, "새 학생"]);
      if (mem.some((m) => m.status === "hold" && String(m.reason ?? "").startsWith(WAIT_ASSIGN))) reasons.push([5, "배정 대기"]);
      if (mem.some((m) => !inClass.has(m.student_id))) reasons.push([6, "반을 떠난 학생"]);
      if (
        mem.some(
          (m) =>
            m.status === "hold" && recentStudentIds.has(m.student_id) && inClass.has(m.student_id) && JOIN_WAIT.some((w) => String(m.reason ?? "").startsWith(w)),
        )
      )
        reasons.push([7, "가입 확인"]);
    }
    if (reasons.length) out.push({ classId: c.classId, className: c.className, rank: Math.min(...reasons.map((r) => r[0])), reasons: reasons.map((r) => r[1]) });
  }
  out.sort((x, y) => x.rank - y.rank || x.className.localeCompare(y.className, "ko"));
  const picked = out.slice(0, Math.max(0, max)).map(({ classId, className, reasons }) => ({ classId, className, reasons }));
  return { picked, remaining: Math.max(0, out.length - picked.length) };
}

/**
 * 1인 보드 준비(프로비저닝) 대상 학생 — 지목한 학생 + (전체일 때) 최근 등록인데 원아 연결(0185a)이 아직 없는 학생.
 * 원아 연결이 있으면 이미 가입·배정된 학생이라 볼 필요가 없다.
 */
export function provisionCandidates({ recentStudentIds, childLinkedStudentIds, scope }) {
  const out = new Set(scope.studentIds);
  if (scope.full) for (const s of recentStudentIds) if (!childLinkedStudentIds.has(s)) out.add(s);
  return [...out];
}

/** 멈춘 요청의 한글 사유 — 앱 staleReason과 같은 문장. */
export const STALE_PENDING_MSG = `연동 PC가 ${PENDING_STALE_MIN}분 동안 요청을 받지 않아 취소했습니다 — 연동 PC가 켜져 있는지 확인하세요`;
export const STALE_RUNNING_MSG = `${RUNNING_STALE_MIN}분이 지나도 끝나지 않아 시간 초과로 처리했습니다 — 다시 요청할 수 있습니다`;
export const RESTARTED_MSG = "연동 PC가 동기화 도중 다시 시작돼 중단됐습니다 — 다시 요청할 수 있습니다";

/**
 * 결과 한 줄(한글) — 화면 툴팁·감사로그. 숫자는 result의 같은 키로도 남긴다(앱 syncResultBrief).
 * @param {{ noChange?:boolean, classes?:number, created?:number, renamed?:number, enrolled?:number, teachers?:number,
 *   boardsCreated?:number, assigned?:number, held?:number, remaining?:number, provisionRemaining?:number, dryRun?:boolean }} r
 */
export function summarizeSync(r) {
  if (r.noChange) return "바뀐 반이 없어 ClassNote는 건드리지 않았습니다";
  const bits = [];
  bits.push(`반 ${r.classes ?? 0}개 확인`);
  if (r.created) bits.push(`새 반 ${r.created}`);
  if (r.renamed) bits.push(`이름 변경 ${r.renamed}`);
  bits.push(`원아 배정 ${r.enrolled ?? 0}`);
  if (r.teachers) bits.push(`담임 연결 ${r.teachers}`);
  if (r.releasedChildren) bits.push(`원아 해제 ${r.releasedChildren}`);
  if (r.releasedTeachers) bits.push(`담임 해제 ${r.releasedTeachers}`);
  if (r.boardsCreated) bits.push(`1인 보드 생성 ${r.boardsCreated}`);
  if (r.assigned) bits.push(`1인 보드 배정 ${r.assigned}`);
  if (r.held) bits.push(`보류 ${r.held}(사유는 원스크린 노트 아이콘)`);
  if (r.remaining) bits.push(`남은 반 ${r.remaining}(다시 누르거나 새벽 5시에)`);
  if (r.provisionRemaining) bits.push(`남은 신입 준비 ${r.provisionRemaining}`);
  return bits.join(" · ");
}

/** 오류 → 화면용 한글 한 줄(원문은 result.raw에만). */
export function syncErrorLabel(message) {
  const m = String(message ?? "");
  if (/원아 (재)?조회 실패/.test(m)) return "ClassNote 원아 조회가 실패해 이번 동기화를 멈췄습니다 — 잠시 뒤 다시 시도하세요";
  if (/로그인|login/i.test(m)) return "ClassNote 로그인에 실패했습니다 — 연동 PC의 계정 설정을 확인하세요";
  if (/함께 사라졌다|다시 읽지 못했다/.test(m)) return "자동 해제 중 ClassNote 배정이 예상과 달라 안전하게 멈췄습니다 — ClassNote에서 그 원아·선생님의 배정을 확인해 주세요";
  if (/계획과 다르다|예상과 다르다|바뀌었다|늘었다|그대로다/.test(m)) return "동기화 중 ClassNote 반 구성이 예상과 달라 안전하게 멈췄습니다 — 새벽 정기 동기화가 다시 봅니다";
  if (/timeout|timed out/i.test(m)) return "ClassNote 응답이 늦어 멈췄습니다 — 잠시 뒤 다시 시도하세요";
  return "동기화 중 오류로 멈췄습니다 — 잠시 뒤 다시 시도하세요";
}
