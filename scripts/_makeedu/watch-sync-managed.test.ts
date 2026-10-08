import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve("scripts/_makeedu/watch-sync-requests.cjs"), "utf8");
async function cycle({ login = false, drain = false } = {}) {
  const scripts: { name: string; forced: string | undefined }[] = [], events: string[] = [], stages: string[] = [];
  const tenant = "fixture-tenant";
  const sql = Object.assign(async (parts: string[], ...values: unknown[]) => {
    const text = parts.join("?");
    if (text.includes("set status = 'running'")) { expect(values).toEqual([tenant]); return [{ id: "fixture-request", requested_by: null }]; }
    if (text.includes("count(*)")) return [{ n: 1 }];
    return [];
  }, { end: async () => {} });
  const managed = { managed: true, state: async (phase: string) => { stages.push(phase); return { drain: drain && scripts.length > 0 }; },
    legacyCutover: async () => { throw Error("Legacy control is not used by the app"); }, result: (task: string) => events.push(task) };
  const brokerCall = async (action: string, body: { finish?: unknown; kind?: string }) => {
    if (action === "schedule") { stages.push(body.finish ? "schedule-finish" : "schedule-claim"); return { job: body.finish ? null : { kind: login ? "login" : "sync", bucket: "2026-10-09T00:00:00Z" } }; }
    if (action === "event") { events.push(body.kind!); return { ok: true }; }
    throw Error("Unexpected broker call");
  };
  const modules: Record<string, unknown> = {
    child_process: { spawn: (_exe: unknown, args: string[], options: { env: Record<string, string> }) => {
      scripts.push({ name: path.basename(args[0]), forced: options.env.MAKEEDU_FORCE });
      const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter()});
      queueMicrotask(()=>child.emit("close",0));return child;
    } }, fs: { mkdirSync() {}, appendFileSync() {} }, os: { hostname: () => "fixture-PC" }, path,
    postgres: () => sql, "./lib.cjs": { resolveTenantId: async () => tenant },
    "./weekly-push.cjs": { weeklyBucketOf: () => "fixture-week", runWeeklyPushEnqueue: async () => { stages.push("weekly-enqueue"); return { status: "empty" }; } },
    "../_sync-agent/managed-worker.cjs": managed, "../_sync-agent/remote-db.cjs": { brokerCall },
  };
  try {
    await vm.runInNewContext(source, { require: (name: string) => { if (!(name in modules)) throw Error("Unexpected module"); return modules[name]; },
      __dirname: path.resolve("scripts/_makeedu"), process: { env: {}, execPath: "fixture-node",stdout:{write(){}},stderr:{write(){}} }, console: { log() {} },
      setInterval: () => ({ unref() {} }), clearInterval() {}, setTimeout: () => { throw Error("fixture cycle complete"); } }, { timeout: 1000 });
  } catch (e) { expect((e as Error).message).toBe("fixture cycle complete"); }
  return { scripts, stages, events };
}
describe("actual managed Makeedu watcher wiring without external writes", () => {
  it.each([false, true])("keeps manual sync, schedule (%s), weekly enqueue and consultation push", async login => {
    const result = await cycle({ login });
    expect(result.scripts).toEqual([{ name: "sync-all.cjs", forced: "true" }, { name: login ? "check-session.mjs" : "sync-all.cjs", forced: "false" }, { name: "push-consultations.cjs", forced: undefined }]);
    expect(result.stages).toEqual(["cycle", "stage", "schedule-claim", "schedule-finish", "stage", "weekly-enqueue", "stage"]);
    expect(result.events).toEqual(["syncNow", "job_started", "job_succeeded", "push"]);
  });
  it("finishes the current request and stops before scheduled or outbound work after drain", async () => {
    const result = await cycle({ drain: true });
    expect(result.scripts).toEqual([{ name: "sync-all.cjs", forced: "true" }]);
    expect(result.stages).toEqual(["cycle", "stage", "cycle"]);
  });
});
