// 반 보드 자동 동기화 — 판정(순수). 언제, 어느 반을 요청하는가 · 무엇을 요청하지 않는가.
import { describe, expect, it } from "vitest";
import {
  AUTO_COOLDOWN_MS,
  AUTO_FAIL_BACKOFF_MS,
  AUTO_FAILS_PER_STATE,
  AUTO_MAX_RUNS_PER_HOUR,
  AUTO_MAX_WAIT_MS,
  AUTO_STABLE_ADD_MS,
  AUTO_STABLE_MS,
  createAutoSyncState,
  detectAutoChanges,
  isAutoQuiet,
  kstMinuteOfDay,
  markAutoRequested,
  mergeTeacherChanges,
  planAutoSync,
  settleAutoRequest,
  teacherKeyOf,
} from "./auto-sync-plan.mjs";
import { MAX_CLASSES_PER_RUN, selectClassesToSync } from "./sync-request-plan.mjs";

const MIN = 60_000;
const NOON = Date.UTC(2026, 9, 3, 3, 0, 0); // KST 12:00
const cls = (classId, className, studentIds = [], over = {}) => ({ classId, className, studentIds, teacherId: "t1", ...over });
const mem = (class_id, student_id, status = "ok") => ({ class_id, student_id, status });
const links = (o) => new Map(Object.entries(o).map(([id, boardName]) => [id, { boardName }]));
const detect = (classes, lk, members = []) => detectAutoChanges({ classes, links: lk, members });
const plan = (state, changes, at, over = {}) => planAutoSync(state, { now: at, changes, hasLive: false, lastFinishedAt: null, ...over });
/** 되돌릴 수 있는 쪽 변화(반을 떠난 학생) — 완충 2분 */
const left = (key = "k1", id = "a") => [{ classId: id, className: `반-${id}`, reasons: ["반을 떠난 학생"], key, stateKey: key, additive: false }];
/** 넣는 쪽 변화(새 학생) — 완충 10분 */
const added = (key = "k1", id = "a") => [{ classId: id, className: `반-${id}`, reasons: ["새 학생"], key, stateKey: key, additive: true }];

describe("무엇이 달라졌나 — aywa 쪽 변화만 본다", () => {
  it("새 학생 · 반을 떠난 학생 · 반 이름 변경 · (학생이 있는) 새 반을 잡는다 — 넣는 쪽인지도 함께", () => {
    const classes = [cls("a", "가반", ["s1", "s2"]), cls("b", "나반", ["s3"]), cls("c", "다반 새이름", ["s4"]), cls("d", "라반", ["s5"]), cls("e", "마반", ["s6"])];
    const lk = links({ a: "가반", b: "나반", c: "다반", e: "마반" });
    const members = [mem("a", "s1"), mem("b", "s3"), mem("b", "s9"), mem("c", "s4"), mem("e", "s6")];
    expect(detect(classes, lk, members).map((c) => [c.className, c.reasons, c.additive])).toEqual([
      ["가반", ["새 학생"], true],
      ["나반", ["반을 떠난 학생"], false],
      ["다반 새이름", ["반 이름 변경"], false],
      ["라반", ["새 반"], true],
    ]);
  });
  it("ClassNote 쪽 사정(학부모 가입 대기·배정 대기 보류)은 자동이 보지 않는다 — 버튼과 새벽 정기 동기화가 한다", () => {
    const classes = [cls("a", "가반", ["s1", "s2"])];
    const members = [{ ...mem("a", "s1", "hold"), reason: "반 보드 배정 전 — 다음 동기화에" }, { ...mem("a", "s2", "hold"), reason: "ClassNote 미가입·미배정(1인 보드 원아 0명)" }];
    expect(detect(classes, links({ a: "가반" }), members)).toEqual([]);
    // 같은 데이터를 버튼의 전체 대조는 잡는다(판정 함수는 한 벌 — 자동은 그중 aywa 쪽 변화만 고른다)
    const full = selectClassesToSync({ classes, links: links({ a: "가반" }), members, recentStudentIds: new Set(["s2"]), scope: { full: true, classIds: [], studentIds: [] } });
    expect(full.picked[0].reasons).toEqual(["배정 대기", "가입 확인"]);
  });
  it("🔴 학생이 없는 새 반은 자동으로 만들지 않는다(만들다 만 반의 보드가 ClassNote에 남는다)", () => {
    expect(detect([cls("n", "새로 만든 반", [])], links({ x: "다른 반" }))).toEqual([]);
    expect(detect([cls("n", "새로 만든 반", ["s1"])], links({ x: "다른 반" })).map((c) => c.reasons)).toEqual([["새 반"]]);
  });
  it("🔴 개명과 새 반은 이름이 아니라 연결(반 id)로 가른다 — 이름이 같은 다른 반이 있어도 섞이지 않는다", () => {
    // 옛 반(old)의 보드가 '중2A'라는 이름을 쥐고 있다. 새로 만든 반(fresh)의 이름도 '중2A'다 → 연결이 없으니 **새 반**이다(개명 아님).
    // 연결이 있는 반(ren)의 이름이 달라졌다 → **개명**이다(새 반 아님).
    const classes = [cls("fresh", "중2A", ["s1"]), cls("ren", "중3B", ["s2"])];
    const lk = links({ old: "중2A", ren: "중2B" });
    const out = detect(classes, lk, [mem("ren", "s2")]);
    expect(out.map((c) => [c.classId, c.reasons])).toEqual([["fresh", ["새 반"]], ["ren", ["반 이름 변경"]]]);
  });
  it("달라진 게 없으면 빈 목록 · 대상 반이 아닌 반(종강·미발송)의 기록은 보지 않는다", () => {
    expect(detect([cls("a", "가반", ["s1"])], links({ a: "가반", gone: "종강한 반" }), [mem("a", "s1"), mem("gone", "s9")])).toEqual([]);
  });
  it("상태 표식은 조회 순서와 무관하다(순서가 바뀔 때마다 '새 상태'로 보이면 완충이 끝나지 않는다)", () => {
    const a = detect([cls("a", "가반", ["s1", "s2", "s3"])], links({ a: "가반", b: "나반" }), [mem("a", "s1"), mem("a", "s9")])[0].key;
    const b = detect([cls("a", "가반", ["s3", "s1", "s2"])], links({ b: "나반", a: "가반" }), [mem("a", "s9"), mem("a", "s1")])[0].key;
    expect(a).toBe(b);
  });
});

describe("완충 — 달라진 상태가 그대로일 때만", () => {
  it("되돌릴 수 있는 쪽(반을 떠난 학생·개명·담임)은 2분 그대로면 요청", () => {
    const st = createAutoSyncState();
    expect(plan(st, left(), NOON).action).toBe("wait");
    expect(plan(st, left(), NOON + MIN).action).toBe("wait");
    const r = plan(st, left(), NOON + AUTO_STABLE_MS);
    expect(r.action).toBe("request");
    expect(r.picked.map((p) => p.classId)).toEqual(["a"]);
  });
  it("🔴 넣는 쪽(새 학생·새 반 = 원아 배정·보드 생성)은 10분 — 잘못 배정했다 몇 분 뒤 지운 수강의 원아가 남의 반 보드에 남지 않게", () => {
    const st = createAutoSyncState();
    plan(st, added(), NOON);
    expect(plan(st, added(), NOON + AUTO_STABLE_MS).action).toBe("wait");
    expect(plan(st, added(), NOON + AUTO_STABLE_ADD_MS - MIN).action).toBe("wait");
    expect(plan(st, added(), NOON + AUTO_STABLE_ADD_MS).action).toBe("request");
    // 그 사이 되돌리면(수강 삭제) 차이가 사라져 아무것도 하지 않는다
    const st2 = createAutoSyncState();
    plan(st2, added(), NOON);
    expect(plan(st2, [], NOON + 5 * MIN)).toMatchObject({ action: "none" });
    expect(st2.pending.size).toBe(0);
  });
  it("그 사이 또 바뀌면(고치는 중) 시계를 다시 잰다", () => {
    const st = createAutoSyncState();
    plan(st, left("k1"), NOON);
    expect(plan(st, left("k2"), NOON + 1.5 * MIN).action).toBe("wait");
    expect(plan(st, left("k2"), NOON + 3 * MIN).action).toBe("wait"); // k2가 된 지 1.5분
    expect(plan(st, left("k2"), NOON + 3.5 * MIN).action).toBe("request");
  });
  it("되돌릴 수 있는 쪽은 계속 바뀌어도 처음 달라진 때부터 30분이 지나면 그때 상태로 간다(끝없이 미루지 않는다)", () => {
    const st = createAutoSyncState();
    let r;
    for (let i = 0; i <= AUTO_MAX_WAIT_MS / MIN; i++) {
      r = plan(st, left(`k${i}`), NOON + i * MIN);
      if (i < AUTO_MAX_WAIT_MS / MIN) expect(r.action).toBe("wait");
    }
    expect(r.action).toBe("request");
  });
  it("🔴 넣는 쪽은 30분 상한으로 풀지 않는다 — 30분째에 방금(1분 전) 잘못 넣은 학생이 그대로 배정되지 않게", () => {
    const st = createAutoSyncState();
    // 같은 반에 신입을 0·9·18·27분에 차례로 넣고, 29분에 한 명을 더(잘못) 넣었다 — 매번 10분을 못 채웠다
    const keyAt = (i) => `k${[0, 9, 18, 27, 29].filter((m) => m <= i).length}`;
    for (let i = 0; i < 39; i++) expect(plan(st, added(keyAt(i)), NOON + i * MIN).action, `${i}분`).toBe("wait");
    // 29분의 상태가 10분 그대로였을 때 비로소 나간다
    expect(plan(st, added(keyAt(39)), NOON + 39 * MIN).action).toBe("request");
    // 계속 바뀌는 넣는 쪽 반은 준비된 다른 반을 끝없이 붙들지도, 딸려 나가지도 않는다 — 묶어 기다린 지 30분이면 다른 반만 먼저 간다
    const st2 = createAutoSyncState();
    const both = (i) => [...added(`n${i}`, "a"), ...(i >= 1 ? left("b1", "b") : [])];
    // b는 1분에 달라져 3분에 준비됐고 a를 기다린다 — b가 달라진 지 30분(31분째)이면 b만 간다
    for (let i = 0; i <= 30; i++) expect(plan(st2, both(i), NOON + i * MIN).action, `${i}분`).toBe("wait");
    const r = plan(st2, both(31), NOON + 31 * MIN);
    expect(r.action).toBe("request");
    expect(r.picked.map((p) => p.classId)).toEqual(["b"]);
  });
  it("🔴 다른 가드로 오래 기다린 반이 방금 또 바뀌었으면 완충을 다시 건다(기다린 시간을 '계속 바뀌는 중' 30분에 세지 않는다)", () => {
    const st = createAutoSyncState();
    plan(st, left("k1"), NOON);
    // 살아 있는 요청 때문에 40분 기다림
    for (let i = 1; i <= 40; i++) expect(plan(st, left("k1"), NOON + i * MIN, { hasLive: true }).action).toBe("wait");
    // 41분째에 또 바뀌었다 → 요청이 풀려도 완충 2분을 다시 기다린다
    expect(plan(st, left("k2"), NOON + 41 * MIN).action).toBe("wait");
    expect(plan(st, left("k2"), NOON + 42 * MIN).action).toBe("wait");
    expect(plan(st, left("k2"), NOON + 43 * MIN).action).toBe("request");
  });
  it("아직 바뀌는 중인 반이 있으면 다른 반도 함께 기다려 한 번에 묶는다", () => {
    const st = createAutoSyncState();
    plan(st, left("a1", "a"), NOON);
    const both = [...left("a1", "a"), ...left("b1", "b")];
    expect(plan(st, both, NOON + 2 * MIN).action).toBe("wait"); // a는 준비됐지만 b가 방금 바뀌었다
    expect(plan(st, both, NOON + 4 * MIN).picked.map((p) => p.classId)).toEqual(["a", "b"]);
  });
  it("🔴 서로 엇갈려 바뀌는 두 반이 요청을 끝없이 미루지 않는다 — 묶어 기다린 지 30분이면 준비된 반만 먼저 보낸다", () => {
    const st = createAutoSyncState();
    // a는 0·4·8…분, b는 2·6·10…분에 바뀐다 — 어느 때에도 한쪽은 완충(2분) 전이고, 둘 다 완충을 채운 뒤 바뀌어 '계속 바뀌는 중'도 아니다
    const at = (i) => [...left(`a${Math.floor(i / 4)}`, "a"), ...(i >= 2 ? left(`b${Math.floor((i + 2) / 4)}`, "b") : [])];
    let first = null;
    for (let i = 0; i <= 40 && !first; i++) {
      const r = plan(st, at(i), NOON + i * MIN);
      if (r.action === "request") first = { i, ids: r.picked.map((p) => p.classId) };
    }
    // 묶음 대기는 2분에 시작했다 → 32분에 그때 준비된 반(b — 30분에 바뀌어 완충을 채웠다)만 간다. a는 방금(32분) 바뀌어 남는다
    expect(first).toEqual({ i: 32, ids: ["b"] });
    markAutoRequested(st, [st.pending.get("b")], NOON + 32 * MIN, "req-1");
    expect(st.groupWaitSince).toBeNull(); // 요청을 냈으면 묶음 대기를 다시 센다
    expect(st.pending.has("a")).toBe(true);
  });
});

describe("중복·간격·되풀이 방지", () => {
  it("살아 있는 요청이 있으면 만들지 않는다 · 방금 끝났으면 5분 쉰다", () => {
    const st = createAutoSyncState();
    plan(st, left(), NOON);
    expect(plan(st, left(), NOON + 3 * MIN, { hasLive: true })).toMatchObject({ action: "wait", why: "이미 동기화 요청이 있음" });
    expect(plan(st, left(), NOON + 3 * MIN, { lastFinishedAt: NOON + 2 * MIN })).toMatchObject({ action: "wait", why: "방금 동기화가 끝나 쉬는 중" });
    expect(plan(st, left(), NOON + 2 * MIN + AUTO_COOLDOWN_MS, { lastFinishedAt: NOON + 2 * MIN }).action).toBe("request");
  });
  it("자동 요청이 잇달아 실패하면 간격을 5 → 15 → 60분으로 늘린다(로그인 실패를 5분마다 되풀이하지 않는다)", () => {
    const wait = (streak, afterMs) => {
      const st = createAutoSyncState();
      plan(st, left(), NOON - 10 * MIN);
      return plan(st, left(), NOON + afterMs, { lastFinishedAt: NOON, failStreak: streak }).action;
    };
    expect(AUTO_FAIL_BACKOFF_MS).toEqual([5 * MIN, 15 * MIN, 60 * MIN]);
    expect(wait(1, 4 * MIN)).toBe("wait");
    expect(wait(1, 5 * MIN)).toBe("request");
    expect(wait(2, 14 * MIN)).toBe("wait");
    expect(wait(2, 15 * MIN)).toBe("request");
    expect(wait(3, 59 * MIN)).toBe("wait");
    expect(wait(7, 59 * MIN)).toBe("wait");
    expect(wait(7, 60 * MIN)).toBe("request");
  });
  it("🔴 동기화가 끝났는데도 안 풀리는 차이는 같은 상태로 두 번까지만 — 그 뒤엔 상태가 바뀔 때까지 다시 하지 않는다", () => {
    const st = createAutoSyncState();
    let t = NOON;
    for (let n = 1; n <= 2; n++) {
      plan(st, left(), t);
      t += 10 * MIN;
      const r = plan(st, left(), t);
      expect(r.action).toBe("request");
      markAutoRequested(st, r.picked, t, `req-${n}`);
      settleAutoRequest(st, "done");
      t += MIN;
    }
    for (let i = 1; i <= 30; i++) expect(plan(st, left(), t + i * 10 * MIN)).toMatchObject({ action: "none", parked: 1 });
    // 상태가 바뀌면 다시 본다
    plan(st, left("k2"), t + 400 * MIN);
    expect(plan(st, left("k2"), t + 403 * MIN).action).toBe("request");
  });
  it("🔴 실패로 끝난 요청은 '끝난 시도'로 세지 않는다 — ClassNote가 잠깐 안 되던 사이의 두 번으로 주차되지 않는다(실패 세 번이면 주차)", () => {
    const st = createAutoSyncState();
    let t = NOON;
    for (let n = 1; n <= AUTO_FAILS_PER_STATE; n++) {
      plan(st, left(), t);
      t += 10 * MIN;
      const r = plan(st, left(), t);
      expect(r.action, `${n}번째`).toBe("request");
      markAutoRequested(st, r.picked, t, `req-${n}`);
      settleAutoRequest(st, "failed");
      expect(st.tried.get("a")).toEqual({ key: "k1", count: 0, fails: n });
      t += MIN;
    }
    expect(plan(st, left(), t + 100 * MIN)).toMatchObject({ action: "none", parked: 1 });
  });
  it("아직 끝나지 않은 요청은 확정하지 않는다 · 기록에서 못 찾으면(밀려남) 끝난 것으로 둔다", () => {
    const st = createAutoSyncState();
    plan(st, left(), NOON);
    const r = plan(st, left(), NOON + 3 * MIN);
    markAutoRequested(st, r.picked, NOON + 3 * MIN, "req-1");
    settleAutoRequest(st, "running");
    expect(st.last?.id).toBe("req-1");
    settleAutoRequest(st, null);
    expect(st.last).toBeNull();
    expect(st.tried.get("a")).toEqual({ key: "k1", count: 1, fails: 0 });
  });
  it("🔴 돌려 쓰는 반 이름(A→B, B→C): 막혔던 개명은 다른 반의 보드 이름이 바뀌면 상태가 달라져 다시 시도된다", () => {
    const before = detect([cls("a", "PJ2", ["s1"]), cls("b", "PJ3", ["s2"])], links({ a: "PJ1", b: "PJ2" }), [mem("a", "s1"), mem("b", "s2")]);
    // 첫 회차: b는 PJ3로 바뀌고, a는 'PJ2' 보드가 아직 있어 못 바꿨다 → 연결표에서 b의 보드 이름만 달라진다
    const after = detect([cls("a", "PJ2", ["s1"]), cls("b", "PJ3", ["s2"])], links({ a: "PJ1", b: "PJ3" }), [mem("a", "s1"), mem("b", "s2")]);
    expect(after.map((c) => c.classId)).toEqual(["a"]);
    expect(after[0].key).not.toBe(before.find((c) => c.classId === "a").key);
    // 학생만 달라진 반의 표식은 다른 반의 보드 이름과 무관하다(남의 개명 때문에 다시 돌지 않는다)
    const s1 = detect([cls("x", "가반", ["s1", "s2"])], links({ x: "가반", y: "나반" }), [mem("x", "s1")])[0].key;
    const s2 = detect([cls("x", "가반", ["s1", "s2"])], links({ x: "가반", y: "나반2" }), [mem("x", "s1")])[0].key;
    expect(s1).toBe(s2);
  });
  it("한 시간 상한 · 한 번에 반 15개까지(나머지는 다음에)", () => {
    const st = createAutoSyncState();
    st.runs = Array.from({ length: AUTO_MAX_RUNS_PER_HOUR }, (_, i) => NOON - i * MIN);
    plan(st, left(), NOON);
    expect(plan(st, left(), NOON + 3 * MIN)).toMatchObject({ action: "wait", why: "한 시간 자동 동기화 상한에 닿음" });
    expect(plan(st, left(), NOON + 63 * MIN).action).toBe("request"); // 한 시간이 지나면 풀린다
    const st2 = createAutoSyncState();
    const many = Array.from({ length: 20 }, (_, i) => left("k", `c${String(i).padStart(2, "0")}`)[0]);
    plan(st2, many, NOON);
    const r = plan(st2, many, NOON + 3 * MIN);
    expect(r.picked.length).toBe(MAX_CLASSES_PER_RUN);
    markAutoRequested(st2, r.picked, NOON + 3 * MIN, "req");
    expect(st2.pending.size).toBe(5); // 남은 반은 기억에 남아 다음 회차에 간다
  });
  it("🔴 밤(23:00~06:00 KST)에는 돌지 않는다 — 밤사이 것은 새벽 5시 정기 동기화가 맞춘다", () => {
    const at = (h, m = 0) => Date.UTC(2026, 9, 3, h - 9, m, 0); // KST 시각
    expect(kstMinuteOfDay(at(24))).toBe(0);
    expect([at(22, 59), at(23), at(24), at(26), at(29, 59), at(30)].map(isAutoQuiet)).toEqual([false, true, true, true, true, false]);
    const st = createAutoSyncState();
    plan(st, left(), at(22, 50));
    expect(plan(st, left(), at(22, 53)).action).toBe("request");
    const st2 = createAutoSyncState();
    plan(st2, left(), at(22, 59));
    expect(plan(st2, left(), at(23, 5))).toMatchObject({ action: "wait", why: "밤에는 쉼(새벽 정기 동기화가 맞춘다)" });
    expect(plan(st2, left(), at(24, 44)).action).toBe("wait");
    expect(plan(st2, left(), at(29, 59)).action).toBe("wait");
    // 06:00에 풀린다 — 새벽 동기화가 이미 맞췄으면 차이가 없어 아무것도 안 한다. 남아 있으면 그때 요청한다.
    expect(plan(st2, left(), at(30)).action).toBe("request");
    expect(plan(createAutoSyncState(), [], at(30)).action).toBe("none");
  });
  it("🔴 밤사이 기다린 반이 05:59에 또 바뀌었으면 06:00에 바로 나가지 않는다(완충을 다시 건다)", () => {
    const at = (h, m = 0) => Date.UTC(2026, 9, 3, h - 9, m, 0);
    const st = createAutoSyncState();
    plan(st, left("k1"), at(22, 59));
    for (let m = 0; m < 59; m += 10) plan(st, left("k1"), at(29, m));
    plan(st, left("k2"), at(29, 59));
    expect(plan(st, left("k2"), at(30)).action).toBe("wait");
    expect(plan(st, left("k2"), at(30, 1)).action).toBe("request");
  });
  it("요청을 실제로 넣기 전에는 '시도'로 치지 않는다(그 사이 누가 먼저 눌러 못 넣은 회차)", () => {
    const st = createAutoSyncState();
    plan(st, left(), NOON);
    const r = plan(st, left(), NOON + 3 * MIN);
    expect(r.action).toBe("request");
    expect(st.tried.size).toBe(0);
    expect(st.runs.length).toBe(0);
    expect(plan(st, left(), NOON + 4 * MIN).action).toBe("request"); // 다음 분에 다시 낸다
  });
});

describe("담임 변화 — 워커가 처음 본 값이 기준", () => {
  const lk = links({ a: "가반", b: "나반" });
  it("처음 볼 때는 기준만 잡는다(변화로 치지 않는다) · 그 뒤 담임이 달라지면 변화", () => {
    const st = createAutoSyncState();
    expect(mergeTeacherChanges(st, [], [cls("a", "가반", ["s1"]), cls("b", "나반", ["s2"])], lk)).toEqual([]);
    const out = mergeTeacherChanges(st, [], [cls("a", "가반", ["s1"], { teacherId: "t2" }), cls("b", "나반", ["s2"])], lk);
    expect(out.map((c) => [c.classId, c.reasons, c.stateKey, c.additive])).toEqual([["a", ["담임 변경"], "T:t2", false]]);
    expect(teacherKeyOf({ teacherId: null })).toBe("");
  });
  it("요청을 넣으면 기준을 지금 값으로 옮긴다(같은 변화로 다시 돌지 않는다) · 되돌리면 변화가 사라진다", () => {
    const st = createAutoSyncState();
    mergeTeacherChanges(st, [], [cls("a", "가반", ["s1"])], lk);
    const changed = [cls("a", "가반", ["s1"], { teacherId: "t2" })];
    plan(st, mergeTeacherChanges(st, [], changed, lk), NOON);
    const r = plan(st, mergeTeacherChanges(st, [], changed, lk), NOON + 3 * MIN);
    expect(r.action).toBe("request");
    markAutoRequested(st, r.picked, NOON + 3 * MIN, "req-1");
    expect(mergeTeacherChanges(st, [], changed, lk)).toEqual([]);
    settleAutoRequest(st, "done");
    expect(mergeTeacherChanges(st, [], changed, lk)).toEqual([]);
    // 되돌린 경우(요청 전)
    const st2 = createAutoSyncState();
    mergeTeacherChanges(st2, [], [cls("a", "가반", ["s1"])], lk);
    expect(mergeTeacherChanges(st2, [], changed, lk).length).toBe(1);
    expect(mergeTeacherChanges(st2, [], [cls("a", "가반", ["s1"])], lk)).toEqual([]);
  });
  it("🔴 그 요청이 실패로 끝났으면 기준을 되돌린다 — 담임 변화가 조용히 사라지지 않고 다시 잡힌다", () => {
    const st = createAutoSyncState();
    mergeTeacherChanges(st, [], [cls("a", "가반", ["s1"])], lk);
    const changed = [cls("a", "가반", ["s1"], { teacherId: "t2" })];
    plan(st, mergeTeacherChanges(st, [], changed, lk), NOON);
    const r = plan(st, mergeTeacherChanges(st, [], changed, lk), NOON + 3 * MIN);
    markAutoRequested(st, r.picked, NOON + 3 * MIN, "req-1");
    settleAutoRequest(st, "failed");
    expect(mergeTeacherChanges(st, [], changed, lk).map((c) => c.reasons)).toEqual([["담임 변경"]]);
  });
  it("새로 대상이 된 반·반 보드가 아직 없는 반은 기준만 지금 값으로 둔다(보드가 생긴 뒤 옛 값과 비교해 한 번 더 돌지 않게)", () => {
    const st = createAutoSyncState();
    mergeTeacherChanges(st, [], [cls("a", "가반", ["s1"])], lk);
    expect(mergeTeacherChanges(st, [], [cls("a", "가반", ["s1"]), cls("z", "새 반", ["s9"], { teacherId: "t5" })], lk)).toEqual([]);
    expect(mergeTeacherChanges(st, [], [cls("a", "가반", ["s1"]), cls("z", "새 반", ["s9"], { teacherId: "t6" })], lk)).toEqual([]); // z는 연결(보드)이 없다
    // 보드가 생겼다(연결됨) — 그때의 담임(t6)이 기준이다
    expect(mergeTeacherChanges(st, [], [cls("a", "가반", ["s1"]), cls("z", "새 반", ["s9"], { teacherId: "t6" })], links({ a: "가반", z: "새 반" }))).toEqual([]);
  });
  it("학생 변화와 겹치면 한 줄로 합친다 — 되풀이 방지 표식은 학생 쪽 것 그대로(담임이 섞여도 같은 상태를 세 번 돌지 않는다)", () => {
    const st = createAutoSyncState();
    mergeTeacherChanges(st, [], [cls("a", "가반", ["s1"])], lk);
    const out = mergeTeacherChanges(st, left("k"), [cls("a", "가반", ["s1"], { teacherId: "t2" })], lk);
    expect(out).toHaveLength(1);
    expect(out[0].reasons).toEqual(["반을 떠난 학생", "담임 변경"]);
    expect(out[0].stateKey).toBe("k");
    expect(out[0].key).not.toBe("k");
    // 첫 요청(학생 + 담임) → 끝남 → 담임 기준이 옮겨져 표식이 'k'로 돌아와도 시도 횟수는 이어진다
    plan(st, out, NOON);
    const r1 = plan(st, out, NOON + 3 * MIN);
    markAutoRequested(st, r1.picked, NOON + 3 * MIN, "req-1");
    settleAutoRequest(st, "done");
    plan(st, left("k"), NOON + 4 * MIN);
    const r2 = plan(st, left("k"), NOON + 14 * MIN);
    expect(r2.action).toBe("request");
    markAutoRequested(st, r2.picked, NOON + 14 * MIN, "req-2");
    settleAutoRequest(st, "done");
    expect(plan(st, left("k"), NOON + 30 * MIN)).toMatchObject({ action: "none", parked: 1 });
  });
  it("🔴 학생·이름 쪽이 이미 멈춘 반이라도 그 뒤 바뀐 담임은 따로 보낸다(묻히지 않는다) — 한 번만, 멈춘 쪽 기록은 그대로", () => {
    const st = createAutoSyncState();
    const base = [cls("a", "가반", ["s1"])];
    mergeTeacherChanges(st, [], base, lk);
    // 같은 상태(k)로 두 번 돌아 멈췄다
    let t = NOON;
    for (let n = 1; n <= 2; n++) {
      plan(st, mergeTeacherChanges(st, left("k"), base, lk), t);
      t += 10 * MIN;
      const r = plan(st, mergeTeacherChanges(st, left("k"), base, lk), t);
      markAutoRequested(st, r.picked, t, `req-${n}`);
      settleAutoRequest(st, "done");
      t += MIN;
    }
    expect(plan(st, mergeTeacherChanges(st, left("k"), base, lk), t)).toMatchObject({ action: "none", parked: 1 });
    // 담임이 바뀌었다 → 담임만 담은 줄로 완충(2분) 뒤 나간다
    const changed = [cls("a", "가반", ["s1"], { teacherId: "t2" })];
    expect(plan(st, mergeTeacherChanges(st, left("k"), changed, lk), t + MIN)).toMatchObject({ action: "wait", parked: 1 });
    const r = plan(st, mergeTeacherChanges(st, left("k"), changed, lk), t + 3 * MIN);
    expect(r.action).toBe("request");
    expect(r.picked.map((p) => [p.classId, p.reasons])).toEqual([["a", ["담임 변경"]]]);
    markAutoRequested(st, r.picked, t + 3 * MIN, "req-3");
    settleAutoRequest(st, "done");
    // 담임 기준이 옮겨졌다 → 다시 학생 쪽만 남고, 그쪽은 여전히 멈춰 있다(횟수가 지워지지 않았다)
    expect(st.tried.get("a")).toEqual({ key: "k", count: 2, fails: 0 });
    for (let i = 4; i <= 40; i += 4) expect(plan(st, mergeTeacherChanges(st, left("k"), changed, lk), t + i * MIN)).toMatchObject({ action: "none", parked: 1 });
  });
  it("🔴 담임만 바뀐 줄도 같은 값으로 세 번 실패하면 멈춘다 — 요청 뒤 차이가 안 보이는 동안에도 실패 횟수가 이어진다", () => {
    const st = createAutoSyncState();
    mergeTeacherChanges(st, [], [cls("a", "가반", ["s1"])], lk);
    const changed = [cls("a", "가반", ["s1"], { teacherId: "t2" })];
    const now = () => mergeTeacherChanges(st, [], changed, lk);
    let t = NOON;
    for (let n = 1; n <= AUTO_FAILS_PER_STATE; n++) {
      plan(st, now(), t);
      t += 10 * MIN;
      const r = plan(st, now(), t);
      expect(r.action, `${n}번째`).toBe("request");
      markAutoRequested(st, r.picked, t, `req-${n}`);
      // 실행 중 — 기준이 옮겨져 차이가 안 보이지만 시도 기록은 남아 있다
      t += MIN;
      expect(plan(st, now(), t, { hasLive: true }).action).toBe("none");
      expect(st.tried.size).toBe(1);
      // 실패로 끝남(실행부는 대조보다 먼저 확정한다) → 기준이 되돌아가 같은 회차에 다시 잡힌다
      settleAutoRequest(st, "failed");
      t += MIN;
    }
    expect(plan(st, now(), t)).toMatchObject({ action: "none", parked: 1 });
    expect(plan(st, now(), t + 300 * MIN)).toMatchObject({ action: "none", parked: 1 });
    // 담임이 또 바뀌면(다른 값) 다시 본다
    const again = [cls("a", "가반", ["s1"], { teacherId: "t3" })];
    plan(st, mergeTeacherChanges(st, [], again, lk), t + 301 * MIN);
    expect(plan(st, mergeTeacherChanges(st, [], again, lk), t + 303 * MIN).action).toBe("request");
    // 성공으로 끝난 담임 요청의 기록은 다음 회차에 정리된다(남아서 쌓이지 않는다)
    const st2 = createAutoSyncState();
    mergeTeacherChanges(st2, [], [cls("a", "가반", ["s1"])], lk);
    plan(st2, mergeTeacherChanges(st2, [], changed, lk), NOON);
    const r2 = plan(st2, mergeTeacherChanges(st2, [], changed, lk), NOON + 3 * MIN);
    markAutoRequested(st2, r2.picked, NOON + 3 * MIN, "req-1");
    settleAutoRequest(st2, "done");
    plan(st2, mergeTeacherChanges(st2, [], changed, lk), NOON + 4 * MIN);
    expect(st2.tried.size).toBe(0);
  });
});
