import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve("scripts/_classnote/watch-classnote-queue.mjs"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const stages = ["processQueueOnce", "processNoticesOnce", "processClassNoticesOnce", "processRecallsOnce", "autoSyncTick",
  "processSyncRequestOnce", "processParentRepliesOnce", "processParentReactionsOnce", "provisionDailyOnce", "syncMathClassBoardsDaily",
  "syncChildMapOnce", "pollParentPostsOnce", "pollParentCommentsOnce", "kickVideoWorker", "kickLinkVideoCompress", "kickVideoReviewExtract", "pollReportReadsOnce", "snapshotBoardRosterOnce"];

async function oneLoop({ local = true, approved = true, legacy = false, missingSchema = false, moduleOn = true, loseAfterFirst = false, managed = false, drainAfterFirst = false, dueToday = false, loops = 1 } = {}) {
  const calls = [], writes = [], exits = [], tasks = [], childmapOpts = [];
  let ticks = 0;
  let held = false;
  const sql = Object.assign(async (parts, ...values) => {
    const text = parts.join("?");
    if (/^\s*insert/i.test(text)) writes.push({ text, values });
    return [{ active: legacy }];
  }, { json: (value) => value, end: async () => {} });
  const work = Object.fromEntries(stages.map((name) => [name, async (...args) => {
    calls.push(name);
    if (name === "syncChildMapOnce") childmapOpts.push(args[2] ?? {});
    if (name === "processQueueOnce" && loseAfterFirst) held = false;
    return { ran: false, processed: 0, claimed: 0 };
  }]));
  const common = { ...work, managed, classBoardSyncDueToday: () => (dueToday ? "2026-11-03" : null), legacyCutover: async () => false, result:()=>{}, activity:async(task)=>{tasks.push(task??"idle");},
    state:async(_phase,task)=>{if(task)tasks.push(task);return {drain:drainAfterFirst&&calls.includes("processQueueOnce")};},
    waitForVideoIdle:async()=>{calls.push("video-drained");},waitForAttachmentIdle:async()=>{calls.push("attachments-drained");},
    stopLinkVideoCompress:()=>{calls.push("link-compress-stopped");},waitForLinkCompressIdle:async()=>{calls.push("link-compress-drained");},stopVideoReviewExtract:()=>{calls.push("review-extract-stopped");},waitForReviewExtractIdle:async()=>{calls.push("review-extract-drained");},videoWorkerBusy:()=>false, BATCH: 2, resolveTenant: async () => "tenant-fixture", isClassnoteModuleEnabled: async () => moduleOn,
    launchBrowser: async () => { calls.push("browser"); return { close: async () => {} }; }, closeClassnoteAdminSession: async () => {},
    autoSyncMode: () => "on", stateFile: () => null, stateDirLabel: () => "fixture", isWorkerIssueLine: () => false,
    loadWorkerVideoDriveSetting: async () => ({ enabled: false, rootId: null }), videoArchiveHeartbeat: () => ({}),
    videoStorageStatus: () => ({}), videoStorageKeyFor: () => "fixture", LEASE_SECONDS: 180, LEASE_REFRESH_MS: 30_000,
    createLocalWorkerLock: () => ({ get held() { return local; }, acquire: async () => local,release:async()=>{calls.push("lock-released");} }),
    workerLeaseApi: () => ({}), createExecutionLease: () => ({ get held() { return held; },
      acquire: async () => { calls.push("lease"); if (missingSchema) throw new Error("fixture missing schema"); held = approved; return approved; },
      assertHeld: () => { if (!held) throw new Error("fixture lease lost"); },
    }),
  };
  await vm.runInNewContext(compiled, {
    exports: {},
    require: (name) => name === "postgres" ? () => sql : name === "node:fs" ? {} : name === "node:os" ? { hostname: () => "same-host" }
      : name === "node:path" ? path : name === "node:crypto" ? { randomUUID: () => "fixture-instance" } : common,
    process: { argv: ["node", "worker", "--post"], env: { DATABASE_URL: "fixture-only", CLASSNOTE_UPLOAD_ID: "fixture", CLASSNOTE_UPLOAD_PW: "fixture" },
      exit: (code) => exits.push(code) },
    console: { log() {}, error() {} },
    // End after the first loop/denial; no operational timer, browser, DB or file is used.
    // loops > 1 = 폴 대기(`new Promise((r) => setTimeout(r, POLL_MS))`)를 그만큼 바로 넘겨 다음 폴을 돌린다.
    setTimeout: (fn) => { if (++ticks < loops) { fn(); return 0; } throw new Error("fixture loop complete"); }, clearTimeout() {},
    setInterval: () => ({ unref() {} }),
  }, { timeout: 1000 });
  return { calls, writes, exits, tasks, childmapOpts };
}

describe("실제 클래스노트 실행기의 잠금 배선", () => {
  it.each([{ local: false }, { approved: false }, { legacy: true }, { missingSchema: true }])("잠금/스키마/구 워커 조건에서 발송과 heartbeat 쓰기를 시작하지 않는다: %j", async (options) => {
    const result = await oneLoop(options);
    expect(result.calls.filter((name) => stages.includes(name))).toEqual([]);
    expect(result.calls).not.toContain("browser");
    expect(result.writes).toEqual([]);
  });
  it("승인된 실행은 기존 18개 처리 단계를 순서대로 유지한다", async () => {
    const result = await oneLoop();
    expect(result.calls.filter((name) => stages.includes(name))).toEqual(stages);
    const payload = result.writes[0].values.find((value) => value?.executionInstanceId);
    expect(payload).toMatchObject({ executionInstanceId: "fixture-instance", executionLeaseVersion: 1, postMode: true });
  });
  it("통합 앱도 기존 18개 처리 단계를 같은 순서로 연결한다", async () => {
    const result = await oneLoop({ managed: true });
    expect(result.calls.filter((name) => stages.includes(name))).toEqual(stages);
    expect(result.writes).toHaveLength(1);
    // 단계마다 이어서 할 일을 연동 앱에 알린다(업데이트가 기다리는 작업 표시, 1.0.7) — 쉬기 전엔 비운다.
    expect(result.tasks).toEqual(["queue", "notice", "classNotice", "recall", "autoSync", "syncNow", "parentReply", "parentReaction", "provision",
      "classBoardSync", "childmap", "posts", "comments", "video", "reads", "roster", "idle"]);
  });
  it("새벽 반 보드 정기 동기화가 돌 차례면 그 바로 앞에서 원아 연결을 한 번 새로 만든다(원장 2026-11-02 A안 — 신입 첫 배정 출처)", async () => {
    const result = await oneLoop({ dueToday: true, managed: true });
    const seq = result.calls.filter((name) => stages.includes(name));
    const i = seq.indexOf("syncMathClassBoardsDaily");
    expect(seq.slice(i - 2, i + 2)).toEqual(["provisionDailyOnce", "syncChildMapOnce", "syncMathClassBoardsDaily", "syncChildMapOnce"]);
    expect(result.childmapOpts[0]).toMatchObject({ force: true, apply: true });
    expect(result.childmapOpts[1]?.force).toBeFalsy(); // 정기 3.5는 20시간 주기 그대로(앞 실행으로 주기가 채워져 실제로는 안 돈다)
    const p = result.tasks.indexOf("provision");
    expect(result.tasks.slice(p, p + 4)).toEqual(["provision", "childmap", "classBoardSync", "childmap"]);
  });
  it("정기 동기화가 '오늘 함' 표식 전에 실패해 차례가 계속 참이어도 원아 연결 강제 갱신은 하루 한 번뿐(폴마다 ClassNote 로그인 금지)", async () => {
    const result = await oneLoop({ dueToday: true, loops: 3 });
    expect(result.calls.filter((name) => name === "syncMathClassBoardsDaily")).toHaveLength(3);
    expect(result.childmapOpts.filter((o) => o.force === true)).toHaveLength(1);
  });
  it("첫 단계 뒤 잠금이 소실되면 다음 작업을 시작하지 않는다", async () => {
    const result = await oneLoop({ loseAfterFirst: true });
    expect(result.calls.filter((name) => stages.includes(name))).toEqual(["processQueueOnce"]);
  });
  it("모듈 OFF는 기존처럼 모든 업무를 쉬고 상태만 보고한다", async () => {
    const result = await oneLoop({ moduleOn: false });
    expect(result.calls.filter((name) => stages.includes(name))).toEqual([]);
    expect(result.writes).toHaveLength(1);
  });
});

it("통합 앱의 종료 요청은 현재 작업 뒤 다음 단계를 시작하지 않고 영상·첨부 마무리를 기다린다(`/v` 압축은 끊고 기다린다)", async()=>{
  const result=await oneLoop({managed:true,drainAfterFirst:true});
  expect(result.calls.filter(name=>stages.includes(name))).toEqual(["processQueueOnce"]);
  expect(result.calls).toContain("video-drained");expect(result.calls).toContain("attachments-drained");
  expect(result.calls.indexOf("link-compress-stopped")).toBeLessThan(result.calls.indexOf("link-compress-drained"));expect(result.calls.at(-1)).toBe("lock-released");
});
