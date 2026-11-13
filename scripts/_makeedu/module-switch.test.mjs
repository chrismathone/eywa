import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import L from "./lib.cjs";

describe("makeedu 지점 스위치", () => {
  it.each([
    [undefined, true],
    [{ preset: "generic" }, false],
    [{ preset: "generic", modules: { disabled: [] } }, true],
    [{ modules: { disabled: ["makeedu"] } }, false],
  ])("저장 원문 %j를 앱과 같은 판정으로 읽는다", async (stored, enabled) => {
    const sql = async () => stored ? [{ module_settings: stored }] : [];
    expect(await L.isMakeeduModuleEnabled(sql, "tenant")).toBe(enabled);
  });

  it("조회 실패를 실행 허용으로 바꾸지 않는다", async () => {
    await expect(L.isMakeeduModuleEnabled(async () => { throw Error("offline"); }, "tenant")).rejects.toThrow("offline");
  });

  it("강제 동기화도 꺼진 모듈이면 외부 실행·쓰기 없이 끝난다", async () => {
    const calls = [];
    const sql = async (parts) => { calls.push(parts.join("?")); return [{ module_settings: { modules: { disabled: ["makeedu"] } } }]; };
    sql.end = async () => {};
    const source = fs.readFileSync("scripts/_makeedu/sync-all.cjs", "utf8");
    await vm.runInNewContext(source, {
      __dirname: "scripts/_makeedu", console: { log() {}, error() {} },
      process: { argv: ["node", "sync-all.cjs", "--apply"], env: { MAKEEDU_FORCE: "true" }, exit: () => { throw Error("unexpected exit"); } },
      require: (name) => {
        if (name === "postgres") return () => sql;
        if (name === "./lib.cjs") return { ...L, resolveTenantId: async () => "tenant" };
        if (name === "child_process") return { spawnSync: () => { throw Error("external execution"); } };
        if (name === "path") return {};
        throw Error(name);
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("module_settings");
  });

  it("워처는 꺼진 동안 요청·예약·역동기화를 쉬고 다시 켜면 처리한다", async () => {
    let cycles = 0, claims = 0, schedules = 0, weekly = 0;
    const sql = async (parts) => {
      const query = parts.join("?");
      if (query.includes("module_settings")) return [{ module_settings: { modules: { disabled: cycles === 1 ? ["makeedu"] : [] } } }];
      if (query.includes("update makeedu_sync_requests")) { claims++; return []; }
      return [];
    };
    sql.end = async () => {};
    const source = fs.readFileSync("scripts/_makeedu/watch-sync-requests.cjs", "utf8");
    await vm.runInNewContext(source, {
      __dirname: "scripts/_makeedu", console: { log() {} }, process: { env: {} },
      setInterval: () => ({ unref() {} }), clearInterval() {}, setTimeout: (done) => done(),
      require: (name) => {
        if (name === "postgres") return () => sql;
        if (name === "./lib.cjs") return { ...L, resolveTenantId: async () => "tenant" };
        if (name === "../_sync-agent/managed-worker.cjs") return {
          managed: true, state: async (stage) => ({ drain: stage === "cycle" && ++cycles > 2 }), activity: async () => {},
        };
        if (name === "../_sync-agent/remote-db.cjs") return { brokerCall: async () => { expect(cycles).toBe(2); schedules++; return {}; } };
        if (name === "./weekly-push.cjs") return {
          weeklyBucketOf: () => "week", runWeeklyPushEnqueue: async () => { expect(cycles).toBe(2); weekly++; return { status: "empty" }; },
        };
        if (name === "os") return { hostname: () => "fixture" };
        if (name === "path") return { resolve: (...p) => p.join("/"), join: (...p) => p.join("/") };
        if (name === "fs" || name === "child_process") return {};
        throw Error(name);
      },
    });
    expect(claims).toBe(1);
    expect(schedules).toBe(1);
    expect(weekly).toBe(1);
  });
});
