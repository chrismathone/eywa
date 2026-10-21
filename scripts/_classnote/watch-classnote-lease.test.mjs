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

async function oneLoop({ local = true, approved = true, legacy = false, missingSchema = false, moduleOn = true, loseAfterFirst = false, managed = false, drainAfterFirst = false } = {}) {
  const calls = [], writes = [], exits = [], tasks = [];
  let held = false;
  const sql = Object.assign(async (parts, ...values) => {
    const text = parts.join("?");
    if (/^\s*insert/i.test(text)) writes.push({ text, values });
    return [{ active: legacy }];
  }, { json: (value) => value, end: async () => {} });
  const work = Object.fromEntries(stages.map((name) => [name, async () => {
    calls.push(name);
    if (name === "processQueueOnce" && loseAfterFirst) held = false;
    return { ran: false, processed: 0, claimed: 0 };
  }]));
  const common = { ...work, managed, legacyCutover: async () => false, result:()=>{}, activity:async(task)=>{tasks.push(task??"idle");},
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
    setTimeout: () => { throw new Error("fixture loop complete"); }, clearTimeout() {},
    setInterval: () => ({ unref() {} }),
  }, { timeout: 1000 });
  return { calls, writes, exits, tasks };
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
