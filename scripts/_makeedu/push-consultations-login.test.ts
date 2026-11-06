// @vitest-environment node
/**
 * push-consultations.cjs — makeedu에 로그인하지 못하면(자동 로그인 멈춤 · 사람 확인) 집어 온 요청을 'running'에 묶지 않고
 * **기존 마감 문장**(finish … 'error')으로 닫는다(팀장 결정 2026-11-06). 그리고 그 마감이 로그인 시도를 늘리지 않는다:
 *   ① 워처는 'pending'만 세어 이 스크립트를 부른다(error는 안 집는다).
 *   ② 주간 자동 적재는 pending·running만 걸러 error 상담을 주 1회 다시 실을 수 있다 → 다시 돌아도 login-guard가
 *      세션 → 멈춤 표시 순으로 막아 **ID/PW 화면을 한 번도 열지 않는다**(아래 두 번째 실행).
 * 실제 스크립트 원문을 vm으로 돌린다 — DB·브라우저는 대역, login-guard는 진짜(세션 파일·멈춤 표시는 임시 폴더). makeedu·DB 요청 없음.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = require_("./login-guard.cjs") as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const L = require_("./lib.cjs") as any;
const SOURCE = fs.readFileSync(path.join(HERE, "push-consultations.cjs"), "utf8");

type Query = { text: string; values: unknown[] };
const stats = { contexts: 0, loginFormTouched: 0, gotos: [] as string[] };

// 저장 세션이 끊긴 makeedu 흉내 — main.do로 가면 로그인 화면에 머문다. ID/PW 칸을 건드리면 센다(일어나면 안 됨).
const fakeBrowser = {
  newContext: async () => {
    stats.contexts++;
    const page = {
      goto: async (url: string) => {
        stats.gotos.push(url);
      },
      url: () => "https://school.makeedu.co.kr/login.do",
      locator: (sel: string) => {
        // 세션 확인의 로그인 폼 검사는 허용(읽기만) — ID/PW 칸(#membId·password)을 찾으면 센다
        if (/loginPopProc|login-bot-check/.test(sel)) return { count: async () => 0 };
        stats.loginFormTouched++;
        throw new Error("ID/PW 화면을 열면 안 된다");
      },
    };
    return { newPage: async () => page, close: async () => {}, storageState: async () => ({ cookies: [], origins: [] }) };
  },
  close: async () => {},
};

async function runPush({ apply, claims, launchFails = false }: { apply: boolean; claims: string[]; launchFails?: boolean }) {
  const queries: Query[] = [];
  const sqlFn = (parts: TemplateStringsArray | unknown, ...values: unknown[]) => {
    if (!Array.isArray(parts) || !("raw" in (parts as object))) return { helper: parts }; // sql(ids) 꼴
    const text = (parts as string[]).join("?");
    queries.push({ text, values });
    if (text.includes("set status = 'running'")) return Promise.resolve(claims.map((id) => ({ id, consultation_id: `c-${id}` })));
    if (text.includes("from enrollment_consultations")) return Promise.resolve(claims.map((id) => ({ id: `c-${id}`, prospect_name: "가상", outcome: "pending" })));
    return Promise.resolve([]);
  };
  const sql = Object.assign(sqlFn, { end: async () => {} });
  const errors: string[] = [];
  const exitCode = await new Promise<number | null>((resolve) => {
    const proc = { argv: ["node", "push-consultations.cjs", ...(apply ? ["--apply"] : [])], env: { DATABASE_URL: "agent://fixture" }, exit: (c: number) => resolve(c) };
    const modules: Record<string, unknown> = {
      path,
      postgres: () => sql,
      "./lib.cjs": { ...L, resolveTenantId: async () => "fixture-tenant" },
      "./login-guard.cjs": G,
      playwright: {
        chromium: {
          launch: async () => {
            if (launchFails) throw new Error("browserType.launch: Executable doesn't exist at C:\\Users\\someone\\AppData\\Local\\ms-playwright\\chromium\\chrome.exe\nmore");
            return fakeBrowser;
          },
        },
      },
    };
    vm.runInNewContext(SOURCE, {
      require: (name: string) => {
        if (!(name in modules)) throw new Error(`Unexpected module ${name}`);
        return modules[name];
      },
      process: proc,
      console: { log() {}, warn() {}, error: (...a: unknown[]) => errors.push(a.join(" ")) },
    });
    setTimeout(() => resolve(null), 5000); // 끝나지 않으면 null
  });
  return { exitCode, errors, queries };
}

const finishes = (qs: Query[]) =>
  qs.filter((q) => q.text.includes("update makeedu_push_requests") && q.text.includes("finished_at = now()")).map((q) => ({ status: q.values[0], error: String(q.values[2]), id: q.values[3] }));
const backToPending = (qs: Query[]) => qs.filter((q) => q.text.includes("set status = 'pending', started_at = null where id = ?")).map((q) => q.values[0]);

describe("push-consultations — 로그인 못 하면 요청을 error로 마감 · 다시 돌아도 ID/PW 0회", () => {
  let dir = "";
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "makeedu-push-login-"));
    const sessionFile = path.join(dir, "state", "makeedu", "session.json");
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, JSON.stringify({ cookies: [{ name: "JSESSIONID", value: "expired", domain: "school.makeedu.co.kr", path: "/" }], origins: [] }));
    for (const k of ["MAKEEDU_SESSION_FILE", "MAKEEDU_ID", "MAKEEDU_PW", "MAKEEDU_STORAGE_STATE"]) saved[k] = process.env[k];
    Object.assign(process.env, { MAKEEDU_SESSION_FILE: sessionFile, MAKEEDU_ID: "fixture-id", MAKEEDU_PW: "fixture-pw" });
    delete process.env.MAKEEDU_STORAGE_STATE;
    // 앞선 실행이 사람 확인에 막혀 남긴 멈춤 표시(같은 자격)
    G.writeBlock(sessionFile, G.classifyLoginResult({ result: "CAPTCHA_REQUIRED" }), "fixture-id", "fixture-pw");
    stats.contexts = 0;
    stats.loginFormTouched = 0;
    stats.gotos = [];
    G._resetAttemptForTest();
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("--apply: 집어 온 요청 전부 기존 마감 문장으로 error(사유 = 멈춤 문구) · running에 남는 것 없음 · 실행은 실패로 끝남", async () => {
    const r = await runPush({ apply: true, claims: ["r1", "r2"] });
    expect(r.exitCode).toBe(1);
    expect(r.errors.join("\n")).toMatch(/ERR makeedu 자동 로그인 멈춤 \[CAPTCHA_REQUIRED\]/);
    const done = finishes(r.queries);
    expect(done.map((d) => d.id).sort()).toEqual(["r1", "r2"]);
    for (const d of done) {
      expect(d.status).toBe("error");
      // 사람이 읽을 사유 — '보내지 못함' + 로그인 한 벌의 한글 사유(코드 꼬리표 없이)
      expect(d.error).toBe("makeedu에 로그인하지 못해 보내지 못했습니다 — makeedu가 자동 로그인에 사람 확인을 요구합니다 — 동기화 PC의 AYWA 연동 앱에서 'makeedu 다시 로그인'이 필요합니다");
      expect(d.error).not.toMatch(/fixture-id|fixture-pw/);
    }
    expect(backToPending(r.queries)).toEqual([]);
    expect(stats.loginFormTouched).toBe(0); // ID/PW 칸을 건드리지 않았다
    expect(stats.contexts).toBe(1); // 세션 확인 한 번뿐
  });

  it("마감 뒤 주간 적재로 다시 실려 또 돌아도 로그인 시도는 늘지 않는다(세션 확인만 · ID/PW 0회)", async () => {
    await runPush({ apply: true, claims: ["r1"] });
    G._resetAttemptForTest(); // 다음 실행(새 프로세스)
    const again = await runPush({ apply: true, claims: ["r3"] });
    expect(finishes(again.queries)).toEqual([expect.objectContaining({ id: "r3", status: "error" })]);
    expect(stats.contexts).toBe(2); // 실행마다 세션 확인 한 번
    expect(stats.loginFormTouched).toBe(0);
    expect(stats.gotos.every((u) => u.endsWith("/main.do"))).toBe(true);
  });

  it("브라우저를 못 띄워도 집은 요청을 error로 마감(running에 남지 않음 · 사유 첫 줄 · 경로는 가림)", async () => {
    const r = await runPush({ apply: true, claims: ["r1", "r2"], launchFails: true });
    expect(r.exitCode).toBe(1);
    const done = finishes(r.queries);
    expect(done.map((d) => d.id).sort()).toEqual(["r1", "r2"]);
    for (const d of done) {
      expect(d.status).toBe("error");
      expect(d.error).toMatch(/^makeedu 접속 준비\(브라우저\)에 실패해 보내지 못했습니다 — browserType\.launch: Executable doesn't exist at …$/);
      expect(d.error).not.toMatch(/someone|Users|more/); // 사용자 폴더 경로·둘째 줄은 싣지 않는다
    }
    expect(stats.contexts).toBe(0);
  });

  it("dry-run(--apply 없음): 마감하지 않고 기존 문장으로 대기(pending)로 되돌린다", async () => {
    const r = await runPush({ apply: false, claims: ["r1", "r2"] });
    expect(r.exitCode).toBe(1);
    expect(finishes(r.queries)).toEqual([]);
    expect(backToPending(r.queries).sort()).toEqual(["r1", "r2"]);
  });

  it("다시 집는 쪽 — 워처는 'pending'만 세고, 이 스크립트도 'pending'만 집는다(error는 저절로 다시 안 돈다)", () => {
    const watcher = fs.readFileSync(path.join(HERE, "watch-sync-requests.cjs"), "utf8");
    expect(watcher).toMatch(/select count\(\*\)::int n from makeedu_push_requests where status = 'pending' and tenant_id/);
    expect(SOURCE).toMatch(/update makeedu_push_requests set status = 'running', started_at = now\(\)\s+where status = 'pending' and tenant_id/);
    // 주간 적재는 pending·running만 거른다 → error 상담은 주 1회 다시 실릴 수 있다(위 두 번째 실행이 그 경우).
    const weekly = fs.readFileSync(path.join(HERE, "weekly-push.cjs"), "utf8");
    expect(weekly).toMatch(/status in \('pending','running'\)/);
  });
});
