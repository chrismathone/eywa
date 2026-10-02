// scripts/_classnote/auto-sync-plan.mjs — **반 보드 자동 동기화**의 판정부(순수 — Vitest가 import한다).
//
// 원장 2026-10-03: *"워커에 에이와 웹훅을 연동시켜 즉각적인 클래스노트 동기화 가능함?"* → *"적절한 방어가드와 중복방지 오류 방지가
// 들어간 합리적인 최적 동기화 … 오작동을 일으키지않는범위내에서"* · *"병목현상과 전체 조회 등 느려질만한 요소 전체 검수 철저히"* ·
// *"반 이름이 바뀌는 경우와 반이 새로 생성되는 경우 등을 헷갈리지않고 잘 구분하도록"*.
//
// 웹훅(앱 → 연동 PC)은 쓰지 않는다 — 연동 PC는 학원 안쪽 망이라 밖에서 부를 수 없다. 대신 워커가 **1분마다 aywa DB만** 보고
// 지난 동기화 기록(0302a)과 달라진 반을 찾아, 그 반만 기존 '지금 반 보드 동기화' 요청(0313a)으로 넘긴다. 실제 동기화는
// 버튼·새벽 정기 동기화와 **같은 코드·같은 가드**를 탄다 — 여기서 새로 하는 일은 "언제, 어느 반을"뿐이다.
// 저장 지점마다 요청을 심지 않는 이유: 예약된 반 이름 변경·퇴원 예약 처리·시간표 가져오기처럼 사람이 누르지 않는 변경이 빠진다.
//
// 가드(전부 여기서 판정한다):
//   ① 완충 — 달라진 상태가 **그대로 유지될 때만** 돈다. 🔴 넣는 쪽(새 반·새 학생 = 보드 생성·원아 배정)은 10분, 그 밖(개명·담임·
//      반을 떠난 학생)은 2분. 넣은 것은 자동으로 되돌릴 수 없다 — 잘못 배정했다가 몇 분 뒤 지운 수강은 "끝난 기록"이 없어
//      자동 해제의 근거가 안 되고, 원아가 남의 반 보드에 남는다. 해제 쪽은 자체 가드(끝난 수강 기록)가 있어 짧아도 된다.
//      개명·담임·반을 떠난 학생은 계속 바뀌는 중이어도 처음 달라진 때부터 30분이 지나면 그때 상태로 간다(끝없이 미루지 않는다).
//      다른 가드 때문에 기다린 시간은 이 30분에 세지 않는다(쿨다운으로 오래 기다린 반이 방금 또 바뀌었는데 완충 없이 나가지 않게).
//      🔴 넣는 쪽은 이 30분으로 풀지 않는다 — 10분 그대로여야만 나간다(30분째에 방금 잘못 넣은 학생이 1분 만에 배정되지 않게).
//      끝없이 바뀌는 반은 새벽 정기 동기화가 맞춘다. 아직 바뀌는 중인 반이 있으면 준비된 반도 함께 기다려 한 번에 묶되,
//      그 기다림이 30분을 넘으면 준비된 반만 먼저 보낸다(서로 엇갈려 바뀌는 두 반이 요청을 끝없이 미루지 않게).
//   ② 중복 방지 — 살아 있는 요청이 있으면 만들지 않는다(DB도 지점당 하나만 허락한다).
//   ③ 간격 — 마지막 요청이 끝나고 5분(버튼 쿨다운과 같은 값) · 자동 요청이 **실패**로 끝났으면 5 → 15 → 60분으로 늘린다 · 시간당 상한.
//   ④ 되풀이 방지 — 동기화가 끝났는데도 안 풀리는 차이(이름을 못 바꾸는 반·채택할 수 없는 같은 이름 보드 …)는 **같은 상태로는** 두 번까지,
//      실패가 이어지는 반은 세 번까지. 상태가 바뀌면(다른 반의 보드 이름이 바뀌어 길이 열림 포함) 다시 본다. 그 밖엔 새벽 정기 동기화가 한다.
//      담임 변경은 학생·이름 쪽과 **따로** 센다 — 학생·이름 쪽이 이미 멈춘 반이라도 그 뒤 바뀐 담임은 따로 보낸다(묻히지 않게).
//      ⚠️ 한 요청에 묶인 반은 실패도 함께 센다(요청은 통째로 실패한다) — 한 보드 때문에 세 번 실패하면 같이 묶인 반도 그 상태로는 멈춘다.
//   ⑤ 밤(23:00~06:00 KST)에는 돌지 않는다 — 날짜가 바뀌며 예약된 수강 시작·종료가 한꺼번에 차이로 잡히고 예약 작업(퇴원·반 이름·담임,
//      00:05~00:35)이 이어서 돈다. 밤사이 것은 지금까지처럼 **새벽 5시 정기 동기화**가 한 번에 맞춘다(한밤에 학부모 쪽 변화를 만들지 않는다).
//   ⑥ 🔴 반 이름 변경과 새 반은 **이름이 아니라 연결표(반 id ↔ 보드 번호)로** 가른다 — 연결이 있는 반의 이름이 달라졌으면 개명,
//      연결이 없는 반이면 새 반이다. 이름이 같은 다른 반(종강 반이 쥔 이름·돌려 쓰는 반 이름)과 섞지 않는다. 판정 규칙은
//      버튼과 **한 벌**(`classDiffReasons`, sync-request-plan.mjs)이고, 실제 채택·생성·개명 가드는 class-board-plan.mjs가 한다.
//   ⑦ 학생이 없는 새 반은 자동으로 만들지 않는다 — 만들다 만 반·잘못 만든 반의 보드가 ClassNote에 남는다(보드는 자동으로 지우지 않는다).
//   ⑧ 신입 1인 보드 준비(이름으로 원아를 붙이는 단계)는 자동에서 하지 않는다 — 버튼과 새벽 정기 동기화만 한다.
// 자동이 보는 변화 = aywa 쪽 변화뿐(새 반·반 이름·새 학생·반을 떠난 학생·담임). ClassNote 쪽 사정(학부모 가입 대기·배정 대기)을
// 다시 확인하는 일, 교시 담당·위임·예약 담임의 변화(연결은 담임만 한다 — 나머지는 '남길 사람'만 넓힌다)는 지금처럼 새벽이 본다.
//
// ⚠️ 순수 유지 — playwright·postgres import 금지.
import { MAX_CLASSES_PER_RUN, classDiffReasons } from "./sync-request-plan.mjs";

const MIN = 60_000;
/** 대조 주기 — 이보다 자주 DB를 읽지 않는다. */
export const AUTO_CHECK_MS = MIN;
/** 완충 — 개명·담임·반을 떠난 학생(되돌릴 수 있거나 자체 가드가 있는 변화). */
export const AUTO_STABLE_MS = 2 * MIN;
/** 완충 — 새 반·새 학생(보드 생성·원아 배정: 넣은 뒤엔 자동으로 못 되돌린다). */
export const AUTO_STABLE_ADD_MS = 10 * MIN;
/** 계속 바뀌는 중이어도 처음 달라진 때부터 이만큼 지나면 그때 상태로 동기화한다. */
export const AUTO_MAX_WAIT_MS = 30 * MIN;
/** 마지막 요청이 끝난 뒤 이만큼은 쉰다 — 앱 SYNC_COOLDOWN_MIN(5분)과 같은 값. */
export const AUTO_COOLDOWN_MS = 5 * MIN;
/** 자동 요청이 잇달아 실패했을 때의 간격(1번째·2번째·3번째 이상). */
export const AUTO_FAIL_BACKOFF_MS = [5 * MIN, 15 * MIN, 60 * MIN];
/** 한 시간에 자동으로 만드는 요청 상한(예상 못 한 되풀이의 마지막 방어선). */
export const AUTO_MAX_RUNS_PER_HOUR = 6;
/** 같은 상태로 다시 시도하는 횟수 상한(동기화가 끝났는데도 안 풀린 경우). */
export const AUTO_TRIES_PER_STATE = 2;
/** 같은 상태로 실패가 이어질 때의 상한 — 이만큼 실패하면 상태가 바뀔 때까지 다시 하지 않는다. */
export const AUTO_FAILS_PER_STATE = 3;
/** 밤에 쉬는 구간(KST, 하루 중 분) — [from, to). from > to면 자정을 넘긴다. */
export const AUTO_QUIET_KST_MIN = { from: 23 * 60, to: 6 * 60 };

// 자동이 보는 차이 = aywa 쪽 변화(버튼의 판정 번호 — sync-request-plan.mjs 머리 주석): ② 새 반 ③ 반 이름 변경 ④ 새 학생 ⑥ 반을 떠난 학생.
const AUTO_RANKS = new Set([2, 3, 4, 6]);
const NEW_CLASS = 2;
const RENAMED = 3;
const NEW_STUDENT = 4;
const SEP = "\u0001";
const TEACHER_REASON = "담임 변경";
const TEACHER_TRY = `${SEP}T`;

/** 시도 기록의 자리 — 반(학생·이름 쪽 상태)과 담임 전용 줄은 따로 센다(멈춘 반의 담임 변경이 묻히지 않게). */
const tryIdOf = (line) => (line.teacherOnly ? `${line.classId}${TEACHER_TRY}` : line.classId);
/** 담임만 달라진 줄 — 표식은 담임 값뿐이다(같은 담임 변경이 세 번 실패하면 그 값으로는 멈춘다). */
const teacherLine = (c, teacherKey) => ({ classId: c.classId, className: c.className, reasons: [TEACHER_REASON], key: `T:${teacherKey}`, stateKey: `T:${teacherKey}`, additive: false, teacherKey, teacherOnly: true });

/** 담임 표식 — 값이 달라지면 담임이 바뀐 것이다(교시 담당·위임·예약 담임은 보지 않는다 — 연결은 담임만 한다). */
export function teacherKeyOf(c) {
  return String(c.teacherId ?? "");
}

/**
 * aywa와 지난 동기화 기록의 차이(반별) — 버튼과 같은 규칙(`classDiffReasons`)에서 aywa 쪽 변화만 고른다.
 * `key` = 그 반의 지금 상태 표식. 완충(그대로인가)과 되풀이 방지(같은 상태로 또 하지 않는다)에 쓴다. 개명·새 반은 **다른 반의 보드
 * 이름**에 길이 막힐 수 있어(돌려 쓰는 반 이름: A→B, B→C) 연결된 보드 이름 전체를 표식에 넣는다 — 다른 반이 이름을 비켜 주면
 * 표식이 달라져 다시 본다. 표식은 전부 정렬해서 만든다(조회 순서에 따라 값이 달라지면 매분 "새 상태"로 보인다).
 * @param {{ classes: Array<{classId:string, className:string, studentIds:string[]}>, links: Map<string,{boardName:string}>,
 *   members: Array<{class_id:string, student_id:string, status:string}> }} input
 * @returns {Array<{classId:string, className:string, reasons:string[], key:string, stateKey:string, additive:boolean}>}
 */
export function detectAutoChanges({ classes, links, members }) {
  const memByClass = new Map();
  for (const m of members) {
    if (!memByClass.has(m.class_id)) memByClass.set(m.class_id, []);
    memByClass.get(m.class_id).push(m);
  }
  const allBoardNames = [...links.values()].map((l) => String(l.boardName ?? "")).sort().join(SEP);
  const none = new Set();
  const out = [];
  for (const c of classes) {
    const link = links.get(c.classId);
    const mem = memByClass.get(c.classId) ?? [];
    const found = classDiffReasons(c, link, mem, none).filter(([rank]) => AUTO_RANKS.has(rank));
    if (!found.length) continue;
    const ranks = new Set(found.map(([rank]) => rank));
    // ⑦ 학생이 없는 새 반은 자동으로 만들지 않는다(새벽 정기 동기화가 본다).
    if (ranks.has(NEW_CLASS) && !c.studentIds.length) continue;
    const key = [
      c.className,
      link ? String(link.boardName ?? "") : "(연결 없음)",
      [...c.studentIds].sort().join(","),
      mem.map((m) => `${m.student_id}:${m.status}`).sort().join(","),
      ranks.has(NEW_CLASS) || ranks.has(RENAMED) ? allBoardNames : "",
    ].join(SEP);
    out.push({
      classId: c.classId,
      className: c.className,
      reasons: found.map(([, label]) => label),
      key,
      stateKey: key,
      // 넣는 쪽(보드 생성·원아 배정)이 섞였는가 — 긴 완충을 건다.
      additive: ranks.has(NEW_CLASS) || ranks.has(NEW_STUDENT),
    });
  }
  return out;
}

/** 워커 프로세스가 사는 동안의 기억(재시작하면 비워진다 — 그때 다시 볼 뿐이다. 실패 간격은 DB의 요청 기록에서 다시 계산한다). */
export function createAutoSyncState() {
  return {
    /** classId → { …change, since(이 상태가 된 때), firstSince(처음 달라진 때) } */
    pending: new Map(),
    /** 시도 기록의 자리(반 id · 담임 전용 줄은 따로) → { key(stateKey), count(끝난 요청 수), fails(실패한 요청 수) } */
    tried: new Map(),
    /** 준비된 반이 아직 바뀌는 중인 반을 기다리기 시작한 때(묶음 대기의 30분 상한) · null = 기다리는 중이 아님 */
    groupWaitSince: null,
    /** classId → 담임 표식(처음 본 값이 기준 — 그 뒤 달라지면 변화) · null = 아직 기준 없음 */
    teacherBase: null,
    /** 자동 요청을 만든 시각들(시간당 상한) */
    runs: [],
    /** 방금 넣은 자동 요청 — 끝난 결과(성공·실패)를 보고 시도 횟수·담임 기준을 확정한다 */
    last: null,
  };
}

/**
 * 담임 변화를 차이에 합친다 — aywa엔 "담임이 언제 바뀌었나"가 없어서, 워커가 처음 본 값을 기준으로 삼고 그 뒤의 변화를 잡는다
 * (워커가 꺼져 있던 사이의 변화는 새벽 정기 동기화가 맞춘다). 새로 대상이 된 반·반 보드가 아직 없는 반은 기준만 지금 값으로 둔다
 * (붙일 보드가 없다 — 보드가 생길 때 동기화가 그때의 담임을 연결한다).
 * @returns 합친 차이 목록(반마다 한 줄)
 */
export function mergeTeacherChanges(state, changes, classes, links) {
  const now = new Map(classes.map((c) => [c.classId, teacherKeyOf(c)]));
  if (!state.teacherBase) {
    state.teacherBase = now;
    return changes;
  }
  const byClass = new Map(changes.map((c) => [c.classId, c]));
  for (const id of [...state.teacherBase.keys()]) if (!now.has(id)) state.teacherBase.delete(id);
  for (const c of classes) {
    const key = now.get(c.classId);
    if (!state.teacherBase.has(c.classId) || !links.has(c.classId)) {
      state.teacherBase.set(c.classId, key);
      continue;
    }
    if (state.teacherBase.get(c.classId) === key) continue;
    const cur = byClass.get(c.classId);
    // 학생 변화와 겹치면 한 줄로 — 되풀이 방지 표식(stateKey)은 학생·이름 쪽 것 그대로다(담임이 섞여도 같은 상태를 더 돌지 않게).
    if (cur) byClass.set(c.classId, { ...cur, reasons: [...cur.reasons, TEACHER_REASON], key: `${cur.key}${SEP}T:${key}`, teacherKey: key });
    else byClass.set(c.classId, teacherLine(c, key));
  }
  return [...byClass.values()];
}

/** KST 기준 하루 중 몇 분째인가(0~1439). */
export function kstMinuteOfDay(nowMs) {
  const kst = new Date(nowMs + 9 * 3600_000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

/** 밤(쉬는 구간)인가. */
export function isAutoQuiet(nowMs) {
  const m = kstMinuteOfDay(nowMs);
  const { from, to } = AUTO_QUIET_KST_MIN;
  return from <= to ? m >= from && m < to : m >= from || m < to;
}

const stableMsOf = (p) => (p.additive ? AUTO_STABLE_ADD_MS : AUTO_STABLE_MS);

/**
 * 지금 요청을 만들 것인가 — 기억(`state.pending`)만 갱신하고, 요청을 만든 것으로 치지는 않는다(실제로 넣은 뒤 `markAutoRequested`).
 * @param {object} a
 * @param {number} a.now
 * @param {Array<{classId:string, className:string, reasons:string[], key:string, stateKey:string|null, additive:boolean, teacherKey?:string}>} a.changes
 * @param {boolean} a.hasLive  살아 있는 요청(대기·실행 중)이 있는가
 * @param {number|null} a.lastFinishedAt  마지막으로 끝난 요청의 시각(ms — DB 시계로 잰 경과에서 환산)
 * @param {number} [a.failStreak]  가장 최근부터 잇달아 실패한 자동 요청 수(DB의 요청 기록에서 센다)
 * @returns {{ action:"none"|"wait"|"request", why:string, picked?:Array<object>, parked:number }}
 */
export function planAutoSync(state, { now, changes, hasLive, lastFinishedAt, failStreak = 0 }) {
  const seen = new Set();
  const seenTry = new Set();
  const parkedIds = new Set();
  // ④ 이 줄은 같은 상태로 이미 할 만큼 했는가 — 상태가 달라졌으면 기록을 지우고 다시 본다.
  const exhausted = (line) => {
    if (line.stateKey == null) return false;
    const id = tryIdOf(line);
    seenTry.add(id);
    const t = state.tried.get(id);
    if (!t) return false;
    if (t.key !== line.stateKey) {
      state.tried.delete(id);
      return false;
    }
    return t.count >= AUTO_TRIES_PER_STATE || t.fails >= AUTO_FAILS_PER_STATE;
  };
  for (const change of changes) {
    seen.add(change.classId);
    let c = change;
    if (exhausted(c)) {
      // 다시 하지 않는다(상태가 바뀌거나 새벽 정기 동기화가 볼 때까지). 다만 그 뒤 바뀐 담임은 따로 보낸다.
      parkedIds.add(c.classId);
      c = c.teacherKey != null && !c.teacherOnly ? teacherLine(c, c.teacherKey) : null;
      if (c && exhausted(c)) c = null;
    }
    if (!c) {
      state.pending.delete(change.classId);
      continue;
    }
    const prev = state.pending.get(c.classId);
    if (!prev) state.pending.set(c.classId, { ...c, since: now, firstSince: now });
    else if (prev.key !== c.key) {
      // 또 바뀌었다 — 완충을 다시 잰다. '계속 바뀌는 중' 상한(30분)은 **쉬지 않고 바뀐 시간**만 센다: 이미 완충을 채우고
      // 다른 가드(쿨다운·살아 있는 요청·밤)로 기다리던 반이 방금 또 바뀐 것이면 상한도 지금부터 다시 센다(완충 없이 나가지 않게).
      const wasSettled = now - prev.since >= stableMsOf(prev);
      state.pending.set(c.classId, { ...c, since: now, firstSince: wasSettled ? now : prev.firstSince });
    }
  }
  for (const id of [...state.pending.keys()]) if (!seen.has(id)) state.pending.delete(id); // 차이가 사라졌다(되돌렸거나 이미 동기화됨)
  // 결과를 기다리는 요청의 시도 기록은 차이가 안 보여도 남긴다 — 담임 줄은 요청하는 순간 기준이 옮겨져 차이가 사라지는데,
  // 그때 지우면 실패를 셀 자리가 없다(끝난 뒤 확정하고, 그다음 회차에 정리된다).
  const awaiting = new Set((state.last?.items ?? []).map((it) => it.tryId));
  for (const id of [...state.tried.keys()]) if (!seenTry.has(id) && !awaiting.has(id)) state.tried.delete(id);
  const parked = parkedIds.size;
  if (!state.pending.size) {
    state.groupWaitSince = null;
    return { action: "none", why: parked ? "같은 상태로 다시 하지 않는 반만 남음" : "달라진 반 없음", parked };
  }

  const gated = (why) => ({ action: "wait", why, parked });
  if (isAutoQuiet(now)) return gated("밤에는 쉼(새벽 정기 동기화가 맞춘다)");
  if (hasLive) return gated("이미 동기화 요청이 있음");
  if (lastFinishedAt != null) {
    const failing = failStreak > 0;
    const gap = failing ? AUTO_FAIL_BACKOFF_MS[Math.min(failStreak, AUTO_FAIL_BACKOFF_MS.length) - 1] : AUTO_COOLDOWN_MS;
    if (now - lastFinishedAt < gap) return gated(failing ? "자동 동기화가 실패해 간격을 두고 다시 시도" : "방금 동기화가 끝나 쉬는 중");
  }
  state.runs = state.runs.filter((t) => now - t < 3600_000);
  if (state.runs.length >= AUTO_MAX_RUNS_PER_HOUR) return gated("한 시간 자동 동기화 상한에 닿음");

  const all = [...state.pending.values()];
  const stable = (p) => now - p.since >= stableMsOf(p);
  // 쉬지 않고 바뀌는 반 — 30분이 지나면 그때 상태로 간다. 🔴 넣는 쪽은 여기 넣지 않는다(완충 10분을 채워야만 나간다).
  const overdue = (p) => !p.additive && now - p.firstSince >= AUTO_MAX_WAIT_MS;
  const ready = all.filter((p) => stable(p) || overdue(p));
  const waiting = { action: "wait", why: "변경이 이어지는 중(잠시 뒤 한 번에)", parked };
  if (!ready.length) return waiting;
  // ① 아직 바뀌는 중(완충 전)인 반이 있으면 준비된 반도 함께 기다린다(한 번에 묶어 돈다) — 그 기다림이 30분을 넘으면 준비된 반만 먼저 간다.
  if (ready.length < all.length && !all.some(overdue)) {
    state.groupWaitSince ??= now;
    if (now - state.groupWaitSince < AUTO_MAX_WAIT_MS) return waiting;
  }
  const picked = ready.sort((a, b) => a.firstSince - b.firstSince || a.className.localeCompare(b.className, "ko")).slice(0, MAX_CLASSES_PER_RUN);
  return { action: "request", why: "달라진 반 동기화", picked, parked };
}

/**
 * 요청을 실제로 넣은 뒤 부른다 — 시도·시간당 횟수를 적고, 담임 기준을 지금 값으로 옮긴다(옛 기준은 기억해 둔다 — 실패하면 되돌린다).
 * `requestId`가 없으면(지켜보기 모드) 결과를 기다리지 않는다.
 */
export function markAutoRequested(state, picked, now, requestId = null) {
  state.runs.push(now);
  state.groupWaitSince = null;
  const items = [];
  for (const p of picked) {
    const tryId = tryIdOf(p);
    if (p.stateKey != null) {
      const t = state.tried.get(tryId);
      const same = t && t.key === p.stateKey;
      state.tried.set(tryId, { key: p.stateKey, count: (same ? t.count : 0) + 1, fails: same ? t.fails : 0 });
    }
    state.pending.delete(p.classId);
    let prevTeacher;
    if (p.teacherKey != null && state.teacherBase) {
      prevTeacher = state.teacherBase.get(p.classId);
      state.teacherBase.set(p.classId, p.teacherKey);
    }
    items.push({ classId: p.classId, tryId, stateKey: p.stateKey ?? null, teacherKey: p.teacherKey ?? null, prevTeacher });
  }
  state.last = requestId ? { id: requestId, items } : null;
}

/**
 * 방금 넣은 자동 요청이 끝났다 — **실패**였으면 그 시도를 '끝난 시도'에서 빼고 실패로 세며, 담임 기준을 되돌린다(다음에 다시 잡히게).
 * 성공(done)이면 그대로 둔다. 아직 끝나지 않았으면 아무것도 하지 않는다.
 * @param {"done"|"failed"|"pending"|"running"|null} status  그 요청의 지금 상태(null = 기록에서 못 찾음 — 오래돼 밀려났다)
 */
export function settleAutoRequest(state, status) {
  if (!state.last) return;
  if (status === "pending" || status === "running") return;
  if (status === "failed") {
    for (const it of state.last.items) {
      const t = it.stateKey != null ? state.tried.get(it.tryId) : null;
      if (t && t.key === it.stateKey) state.tried.set(it.tryId, { key: t.key, count: Math.max(0, t.count - 1), fails: t.fails + 1 });
      if (it.teacherKey != null && state.teacherBase && state.teacherBase.get(it.classId) === it.teacherKey && it.prevTeacher !== undefined)
        state.teacherBase.set(it.classId, it.prevTeacher);
    }
  }
  state.last = null;
}
