// 반 보드 자동 동기화 — 실행부(요청 한 줄 넣기)와 대조 조회. DB는 가짜로 갈아 끼운다.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ input: null, loadFail: null }));
vi.mock("./auto-sync-load.mjs", async (orig) => ({
  ...(await orig()),
  loadAutoSyncInputs: async () => {
    if (m.loadFail) throw m.loadFail;
    return m.input;
  },
}));

const { autoSyncMode, autoSyncTick, createAutoSyncRunner, isMissingTable, readRequestRows } = await import("./classnote-auto-sync.mjs");
const { AUTO_CHECK_MS } = await import("./auto-sync-plan.mjs");
const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), "utf8");

const MIN = 60_000;
const NOON = Date.UTC(2026, 9, 3, 3, 0, 0); // KST 12:00
const cls = (classId, className, studentIds, over = {}) => ({ classId, className, studentIds, teacherId: "t1", ...over });

/** postgres.js 흉내 — 요청 표 조회·요청 넣기·감사로그만 온다. `requests`는 최신순, `age`(분 전에 끝남). */
function fakeSql({ requests = [], conflict = false } = {}) {
  const calls = { selects: 0, inserts: [], audits: [] };
  const box = { requests };
  const sql = (strings, ...values) => {
    const text = strings.join("?");
    if (text.includes("from classnote_sync_requests")) {
      calls.selects++;
      return Promise.resolve(box.requests.map((r) => ({ id: r.id ?? "x", status: r.status, auto: r.auto ?? null, age_ms: r.age == null ? null : r.age * MIN })));
    }
    if (text.includes("insert into classnote_sync_requests")) {
      if (conflict) return Promise.resolve([]);
      calls.inserts.push(values[1]);
      return Promise.resolve([{ id: `req-${calls.inserts.length}` }]);
    }
    if (text.includes("insert into audit_logs")) {
      calls.audits.push(values);
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };
  sql.json = (v) => v;
  return { sql, calls, box };
}
/** 가반: 기록에 있는 학생이 반을 떠났다(되돌릴 수 있는 쪽 — 완충 2분). */
const leftOne = () => ({
  classes: [cls("a", "가반", ["s1"]), cls("b", "나반", ["s3"])],
  links: new Map([["a", { boardName: "가반" }], ["b", { boardName: "나반" }]]),
  members: [{ class_id: "a", student_id: "s1", status: "ok" }, { class_id: "a", student_id: "s9", status: "ok" }, { class_id: "b", student_id: "s3", status: "ok" }],
});
const tick = (sql, runner, at, over = {}) => autoSyncTick(sql, { tenant: "t", post: true, log: () => {}, now: at, runner, env: {}, ...over });

beforeEach(() => {
  m.input = leftOne();
  m.loadFail = null;
});

describe("자동 동기화 실행부", () => {
  it("달라진 반이 2분 그대로면 그 반만 지목한 요청 한 줄을 넣는다 — 학생은 싣지 않는다(신입 1인 보드 준비는 자동에서 안 한다)", async () => {
    const { sql, calls } = fakeSql();
    const runner = createAutoSyncRunner();
    expect(await tick(sql, runner, NOON)).toMatchObject({ checked: true, changes: 1 });
    expect(await tick(sql, runner, NOON + MIN)).toMatchObject({ checked: true });
    expect(calls.inserts).toEqual([]);
    const r = await tick(sql, runner, NOON + 2 * MIN);
    expect(r).toMatchObject({ checked: true, requested: 1 });
    expect(calls.inserts).toEqual([{ classIds: ["a"], auto: true }]);
    expect(calls.inserts[0]).not.toHaveProperty("studentIds");
    // 감사로그 — 자동 요청임과 반·사유가 남는다
    expect(calls.audits).toHaveLength(1);
    expect(calls.audits[0]).toEqual(expect.arrayContaining(["system:classnote-auto-sync", "classnote_board_sync_request"]));
    expect(calls.audits[0].at(-1)).toMatchObject({ requestId: "req-1", auto: true, classCount: 1, studentCount: 0, classes: [{ name: "가반", reasons: ["반을 떠난 학생"] }] });
  });
  it("🔴 넣는 쪽(새 학생)은 10분 그대로여야 요청한다", async () => {
    m.input = { ...leftOne(), classes: [cls("a", "가반", ["s1", "s9", "s2"]), cls("b", "나반", ["s3"])] };
    const { sql, calls } = fakeSql();
    const runner = createAutoSyncRunner();
    for (let i = 0; i < 10; i++) await tick(sql, runner, NOON + i * MIN);
    expect(calls.inserts).toEqual([]);
    expect(await tick(sql, runner, NOON + 10 * MIN)).toMatchObject({ requested: 1 });
  });
  it("대조는 1분에 한 번만(그 사이 폴은 DB를 읽지 않는다) · 달라진 반이 없으면 요청 표도 읽지 않는다", async () => {
    const { sql, calls } = fakeSql();
    const runner = createAutoSyncRunner();
    m.input = { ...leftOne(), members: [{ class_id: "a", student_id: "s1", status: "ok" }, { class_id: "b", student_id: "s3", status: "ok" }] }; // 기록과 같다
    expect((await tick(sql, runner, NOON)).checked).toBe(true);
    expect((await tick(sql, runner, NOON + 15_000)).checked).toBe(false);
    expect((await tick(sql, runner, NOON + AUTO_CHECK_MS - 1)).checked).toBe(false);
    expect((await tick(sql, runner, NOON + AUTO_CHECK_MS)).checked).toBe(true);
    expect(calls.selects).toBe(0);
  });
  it("살아 있는 요청이 있거나 방금 끝났으면 넣지 않는다 · 그 사이 누가 먼저 넣었으면(충돌) 시도로 치지 않고 다음에 다시", async () => {
    const live = fakeSql({ requests: [{ status: "running" }] });
    const r1 = createAutoSyncRunner();
    await tick(live.sql, r1, NOON);
    expect(await tick(live.sql, r1, NOON + 3 * MIN)).toMatchObject({ why: "이미 동기화 요청이 있음" });
    expect(live.calls.inserts).toEqual([]);
    const cool = fakeSql({ requests: [{ status: "done", age: 1 }] });
    const r2 = createAutoSyncRunner();
    await tick(cool.sql, r2, NOON);
    expect(await tick(cool.sql, r2, NOON + 3 * MIN)).toMatchObject({ why: "방금 동기화가 끝나 쉬는 중" });
    const clash = fakeSql({ conflict: true });
    const r3 = createAutoSyncRunner();
    await tick(clash.sql, r3, NOON);
    expect(await tick(clash.sql, r3, NOON + 3 * MIN)).toMatchObject({ requested: 0, why: "다른 요청이 먼저 들어옴" });
    expect(r3.state.tried.size).toBe(0);
    expect(r3.state.last).toBeNull();
    expect(clash.calls.audits).toEqual([]);
  });
  it("🔴 넣은 요청이 실패로 끝나면 시도로 세지 않고 간격을 늘려 다시 한다(5 → 15분 …)", async () => {
    const { sql, calls, box } = fakeSql();
    const runner = createAutoSyncRunner();
    await tick(sql, runner, NOON);
    expect(await tick(sql, runner, NOON + 2 * MIN)).toMatchObject({ requested: 1 });
    // 그 요청이 실패로 끝났다(1분 전)
    box.requests = [{ id: "req-1", status: "failed", auto: true, age: 1 }];
    const logs = [];
    await autoSyncTick(sql, { tenant: "t", post: true, log: (l) => logs.push(l), now: NOON + 4 * MIN, runner, env: {} });
    expect(logs.join("\n")).toContain("직전 자동 동기화가 실패로 끝났습니다");
    expect(runner.state.tried.get("a")).toMatchObject({ count: 0, fails: 1 });
    expect(calls.inserts).toHaveLength(1); // 아직 5분 전
    box.requests = [{ id: "req-1", status: "failed", auto: true, age: 6 }];
    expect(await tick(sql, runner, NOON + 9 * MIN)).toMatchObject({ requested: 1 });
    // 두 번째도 실패 → 15분
    box.requests = [{ id: "req-2", status: "failed", auto: true, age: 6 }, { id: "req-1", status: "failed", auto: true, age: 12 }];
    await tick(sql, runner, NOON + 16 * MIN);
    expect(await tick(sql, runner, NOON + 20 * MIN)).toMatchObject({ why: "자동 동기화가 실패해 간격을 두고 다시 시도" });
    expect(calls.inserts).toHaveLength(2);
  });
  it("🔴 담임만 바뀐 반 — 실패로 끝나면 같은 회차에 다시 잡히고 실패 횟수가 이어진다(결과 확정이 대조보다 먼저다)", async () => {
    const same = { ...leftOne(), members: [{ class_id: "a", student_id: "s1", status: "ok" }, { class_id: "b", student_id: "s3", status: "ok" }] }; // 학생은 기록과 같다
    const changed = { ...same, classes: [cls("a", "가반", ["s1"], { teacherId: "t2" }), cls("b", "나반", ["s3"])] };
    const { sql, calls, box } = fakeSql();
    const runner = createAutoSyncRunner();
    m.input = same;
    await tick(sql, runner, NOON); // 담임 기준을 잡는다
    m.input = changed;
    await tick(sql, runner, NOON + MIN);
    expect(await tick(sql, runner, NOON + 3 * MIN)).toMatchObject({ requested: 1 });
    expect(calls.audits[0].at(-1)).toMatchObject({ classes: [{ name: "가반", reasons: ["담임 변경"] }] });
    // 실행 중 — 기준이 옮겨져 달라진 반이 없지만 결과를 기다리므로 시도 기록을 지우지 않는다
    box.requests = [{ id: "req-1", status: "running", auto: true, age: null }];
    expect(await tick(sql, runner, NOON + 4 * MIN)).toMatchObject({ changes: 0 });
    expect(runner.state.tried.size).toBe(1);
    // 실패로 끝났다 → 같은 회차에 기준이 되돌아가 다시 잡히고, 실패 1번으로 남는다
    box.requests = [{ id: "req-1", status: "failed", auto: true, age: 1 }];
    expect(await tick(sql, runner, NOON + 6 * MIN)).toMatchObject({ changes: 1, why: "자동 동기화가 실패해 간격을 두고 다시 시도" });
    expect([...runner.state.tried.values()]).toEqual([{ key: "T:t2", count: 0, fails: 1 }]);
    // 간격(5분)이 지나면 다시 요청한다
    box.requests = [{ id: "req-1", status: "failed", auto: true, age: 6 }];
    expect(await tick(sql, runner, NOON + 11 * MIN)).toMatchObject({ requested: 1 });
    expect(calls.inserts).toHaveLength(2);
  });
  it("🔴 dry-run PC · 꺼 둔 PC · 반 보드를 쓰지 않는 지점은 아무것도 넣지 않는다", async () => {
    const { sql, calls } = fakeSql();
    expect(await tick(sql, createAutoSyncRunner(), NOON, { post: false })).toEqual({ checked: false });
    expect(await tick(sql, createAutoSyncRunner(), NOON, { env: { CLASSNOTE_BOARD_AUTO_SYNC: "off" } })).toEqual({ checked: false });
    m.input = { ...leftOne(), links: new Map() };
    const none = createAutoSyncRunner();
    await tick(sql, none, NOON);
    expect(await tick(sql, none, NOON + 3 * MIN)).toMatchObject({ changes: 0, why: "반 보드를 쓰지 않는 지점" });
    expect(calls.inserts).toEqual([]);
  });
  it("지켜보기 모드는 무엇을 요청했을지 로그에만 남기고 넣지 않는다(같은 상태는 두 번까지만 적는다 — 매분 되풀이하지 않는다)", async () => {
    const { sql, calls } = fakeSql();
    const logs = [];
    const runner = createAutoSyncRunner();
    const env = { CLASSNOTE_BOARD_AUTO_SYNC: "observe" };
    for (let i = 0; i <= 40; i++) await autoSyncTick(sql, { tenant: "t", post: true, log: (l) => logs.push(l), now: NOON + i * MIN, runner, env });
    expect(calls.inserts).toEqual([]);
    expect(logs.filter((l) => l.includes("(지켜보기)")).length).toBe(2);
    expect(logs.filter((l) => l.includes("더 시도하지 않는 반 1개")).length).toBe(1); // 주차 사실은 한 번 적는다
    expect(autoSyncMode({})).toBe("on");
    expect(autoSyncMode({ CLASSNOTE_BOARD_AUTO_SYNC: " OFF " })).toBe("off");
    expect(autoSyncMode({ CLASSNOTE_BOARD_AUTO_SYNC: "0" })).toBe("off");
  });
  it("대조가 실패하면 그 회차만 건너뛴다(던지지 않는다 — 발송은 계속) · 표가 없을 때만 10분 쉰다(사유를 한 번 적는다)", async () => {
    const { sql, calls } = fakeSql();
    const runner = createAutoSyncRunner();
    const logs = [];
    const go = (at) => autoSyncTick(sql, { tenant: "t", post: true, log: (l) => logs.push(l), now: at, runner, env: {} });
    m.loadFail = new Error("connection reset");
    expect(await go(NOON)).toMatchObject({ checked: true, why: "대조 실패" });
    // 🔴 칸이 없다는 오류는 '표 없음'이 아니다 — 조용히 쉬지 않고 매번 사유를 남긴다
    m.loadFail = Object.assign(new Error('column c.teacher_id does not exist'), { code: "42703" });
    expect(await go(NOON + MIN)).toMatchObject({ checked: true, why: "대조 실패" });
    expect(logs.filter((l) => l.includes("대조 실패")).length).toBe(2);
    m.loadFail = Object.assign(new Error('relation "classnote_class_boards" does not exist'), { code: "42P01" });
    expect(await go(NOON + 2 * MIN)).toEqual({ checked: false });
    m.loadFail = null;
    expect(await go(NOON + 7 * MIN)).toEqual({ checked: false }); // 아직 10분 전
    expect((await go(NOON + 13 * MIN)).checked).toBe(true);
    expect(logs.filter((l) => l.includes("표가 아직 없어")).length).toBe(1);
    expect(calls.inserts).toEqual([]);
    expect(isMissingTable({ code: "42883", message: "function x() does not exist" })).toBe(false);
  });
});

describe("요청 기록 읽기 — 간격은 DB가 잰 경과로", () => {
  it("살아 있는 요청 · 마지막으로 끝난 때(DB 경과에서 환산) · 잇달아 실패한 자동 요청 수", () => {
    const now = NOON;
    expect(readRequestRows([], now)).toEqual({ hasLive: false, lastFinishedAt: null, failStreak: 0 });
    expect(readRequestRows([{ id: "1", status: "pending", auto: true, age_ms: null }], now).hasLive).toBe(true);
    const r = readRequestRows(
      [
        { id: "4", status: "failed", auto: true, age_ms: "120000" }, // 숫자가 글자로 와도
        { id: "3", status: "failed", auto: true, age_ms: 600000 },
        { id: "2", status: "done", auto: true, age_ms: 1200000 },
        { id: "1", status: "failed", auto: true, age_ms: 1800000 },
      ],
      now,
    );
    expect(r).toEqual({ hasLive: false, lastFinishedAt: now - 120000, failStreak: 2 });
    // 사람이 누른 요청의 실패는 자동의 실패로 세지 않는다
    expect(readRequestRows([{ id: "9", status: "failed", auto: null, age_ms: 1000 }], now).failStreak).toBe(0);
  });
});

describe("대조 조회 — 가볍게, 동기화 본체와 같은 대상", () => {
  const load = read("auto-sync-load.mjs");
  const code = load.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""); // 주석을 뺀 본문
  it("🔴 학생 표는 '지금 다니는 재원생' 조각 안에서만 닿는다 · 전화번호를 읽지 않는다 · 보류 사유 글을 받지 않는다", () => {
    expect(code).not.toMatch(/phone/);
    expect(code).not.toMatch(/(from|join)\s+students\b/); // 학생 표를 직접 조회하지 않는다(조각은 다른 파일에 있다)
    expect(code).not.toMatch(/reason/);
    expect(code).not.toMatch(/class_schedules|class_delegations/); // 교시 담당·위임은 자동이 보지 않는다
  });
  it("🔴 한 번의 왕복 — 이 파일의 조회는 하나뿐이고, 실행부는 달라진 반이 있을 때만 요청 표를 한 번 더 읽는다", () => {
    expect(code.match(/sql`/g)).toHaveLength(1);
    const run = read("classnote-auto-sync.mjs");
    expect(run).toContain("const req = changes.length ? readRequestRows(await requestRows(), now) : { hasLive: false, lastFinishedAt: null, failStreak: 0 };");
    expect(run).toContain("(rows ??= await sql`"); // 결과 확정과 판정이 같은 조회를 나눠 쓴다(한 회차에 한 번)
    expect(run.match(/from classnote_sync_requests/g)).toHaveLength(1);
    expect(run.match(/requestRows\(\)/g)).toHaveLength(2);
    // 모듈 스위치는 워커 루프가 이미 읽었다 — 여기서 또 읽지 않는다
    expect(run).not.toContain("isClassnoteModuleEnabled");
  });
  it("🔴 대상 반·지금 다니는 학생의 정의는 동기화 본체와 같은 SQL 조각을 쓴다(따로 적지 않는다) · 수강엔 지점 필터", () => {
    const body = read("math-class-boards-load.mjs");
    expect(load).toContain("${targetClassWhere(sql, tenant, today)}");
    expect(load).toContain("${currentEnrollmentOn(sql, tenant, today)}");
    expect(body).toContain("left join enrollments e on e.class_id = c.id and ${currentEnrollmentOn(sql, tenant, today)}");
    expect(body).toContain("where ${targetClassWhere(sql, tenant, today)}");
    expect(body).toContain("sql`e.tenant_id = ${tenant} and (e.end_date is null or e.end_date >= ${today})");
    // 2026-11-05 원장 *"휴원 중인 학생은 클래스노트 배정을 하지말것"* — 그 수강의 휴원·대기도 대상 학생에서 뺀다(리뷰 2026-11-05 시험 공백).
    expect(load + body).toContain("and not coalesce(e.on_hold, false)");
    // 조건 본문은 조각 한 곳에만 있다
    expect((body + load).match(/c\.subject in \('math', 'subject_1'\) and \(c\.closed_at is null/g)).toHaveLength(1);
    expect((body + load).match(/s\.status = 'enrolled' and not coalesce\(s\.is_test, false\)/g)).toHaveLength(1);
  });
  it("조회 결과를 판정 입력 모양으로 바꾼다", async () => {
    const { loadAutoSyncInputs } = await vi.importActual("./auto-sync-load.mjs");
    const row = {
      classes: [{ id: "a", name: "가반", teacher: "t1", students: ["s1"] }, { id: "b", name: "나반", teacher: null, students: [] }],
      links: [{ class_id: "a", board_name: "가반" }],
      members: [{ class_id: "a", student_id: "s1", status: "ok" }],
    };
    const sql = () => Promise.resolve([row]);
    const out = await loadAutoSyncInputs(sql, "t");
    expect(out.classes).toEqual([{ classId: "a", className: "가반", studentIds: ["s1"], teacherId: "t1" }, { classId: "b", className: "나반", studentIds: [], teacherId: null }]);
    expect(out.links.get("a")).toEqual({ boardName: "가반" });
    expect(out.members).toHaveLength(1);
  });
});

describe("워커 연결", () => {
  const watch = read("watch-classnote-queue.mjs");
  it("자동 대조는 요청 처리 바로 앞에서 돈다(넣은 요청을 같은 폴이 집는다) · 지원 표식은 실제로 켜져 있을 때만", () => {
    const tickAt = watch.indexOf("await autoSyncTick(db(), { tenant, post: POST, log })");
    expect(tickAt).toBeGreaterThan(-1);
    expect(tickAt).toBeLessThan(watch.indexOf("await processSyncRequestOnce("));
    // ClassNote 기능이 꺼진 지점은 루프가 그 전에 돌아간다(자동 대조까지 오지 않는다)
    expect(watch.indexOf("if (!(await isClassnoteModuleEnabled(db(), tenant))) {")).toBeGreaterThan(-1);
    expect(watch.indexOf("if (!(await isClassnoteModuleEnabled(db(), tenant))) {")).toBeLessThan(tickAt);
    // dry-run PC는 자동 대조를 하지 않는다 — 표식도 거짓으로 둔다(앱의 설명 문구가 이 값을 읽는다)
    expect(watch).toMatch(/WORKER_CAPS = \{[^}]*autoBoardSync: POST && autoSyncMode\(\) === "on"/);
  });
  it("자동 요청은 결과·보고서(멈춘 회차 포함)·감사로그에 '자동'으로 남는다", () => {
    const req = read("classnote-sync-request.mjs");
    expect(req).toContain("row.scope.auto === true");
    expect(req).toContain('result: auto ? { ...result, auto: true } : result');
    expect(req).toContain("ok: false, error: label, events, log, ...(auto ? { summary: { auto: true } } : {}) });");
    expect(req).toContain("await audit(sql, tenant, row.id, result, null, auto);");
    expect(req).toContain("await audit(sql, tenant, row.id, partial, label, auto);");
  });
});
