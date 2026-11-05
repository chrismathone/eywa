import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { notionConfigFor } from "@/lib/notion/client";

/**
 * Notion 업무 연동 — **학원 경계 잠금**(2026-09-22).
 *
 * 이 연동은 한 학원의 Notion 워크스페이스를 가리키는 전역 토큰 하나다. 지점 조건 없이 켜져 있던 동안 둘째 지점
 * 원장이 그 워크스페이스의 담당자 명단을 보고, 업무를 읽고·완료하고·댓글을 달 수 있었다. 그래서 판정은
 * `notionConfigFor(학원)` 한 곳이고, Notion을 부르는 액션은 모두 그 판정을 먼저 지나야 한다.
 */

const ENV_KEYS = ["NOTION_TOKEN", "NOTION_TASKS_DATABASE_ID", "NOTION_TENANT_ID"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function setEnv(token?: string, db?: string, tenant?: string) {
  const vals = { NOTION_TOKEN: token, NOTION_TASKS_DATABASE_ID: db, NOTION_TENANT_ID: tenant };
  for (const k of ENV_KEYS) {
    const v = vals[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("notionConfigFor — 연동 학원 판정", () => {
  it("토큰·DB·학원이 모두 맞을 때만 켜진다", () => {
    setEnv("tok", "db-1", "tenant-a");
    expect(notionConfigFor("tenant-a")).toEqual({ dbId: "db-1" });
  });

  it("🔴 다른 학원은 꺼진다", () => {
    setEnv("tok", "db-1", "tenant-a");
    expect(notionConfigFor("tenant-b")).toBeNull();
  });

  it("🔴 NOTION_TENANT_ID가 없으면 어느 학원도 켜지지 않는다(fail-closed)", () => {
    setEnv("tok", "db-1", undefined);
    expect(notionConfigFor("tenant-a")).toBeNull();
  });

  it("학원을 모르면(세션 없음) 꺼진다", () => {
    setEnv("tok", "db-1", "tenant-a");
    expect(notionConfigFor(null)).toBeNull();
    expect(notionConfigFor(undefined)).toBeNull();
  });

  it("토큰이나 DB가 없으면 꺼진다 · 끝 개행은 지운다", () => {
    setEnv(undefined, "db-1", "tenant-a");
    expect(notionConfigFor("tenant-a")).toBeNull();
    setEnv("tok", undefined, "tenant-a");
    expect(notionConfigFor("tenant-a")).toBeNull();
    setEnv("tok\n", " db-1 \n", "tenant-a\n");
    expect(notionConfigFor("tenant-a")).toEqual({ dbId: "db-1" });
  });
});

describe("Notion 액션 — 모두 학원 판정을 지난다", () => {
  const actions = readFileSync(path.join(__dirname, "server", "notion-actions.ts"), "utf8");
  const server = readFileSync(path.join(__dirname, "server", "notion.ts"), "utf8");

  /** export된 async 함수 본문들. */
  function bodies(src: string): { name: string; body: string }[] {
    const out: { name: string; body: string }[] = [];
    const re = /export async function (\w+)\(/g;
    let m: RegExpExecArray | null;
    const starts: { name: string; at: number }[] = [];
    while ((m = re.exec(src))) starts.push({ name: m[1], at: m.index });
    starts.forEach((s, i) => out.push({ name: s.name, body: src.slice(s.at, starts[i + 1]?.at ?? src.length) }));
    return out;
  }

  it.each(bodies(actions))("$name: 학원 판정(notionConfigFor·requireReader·requireEditor) 또는 학원을 넘긴 조회", ({ body }) => {
    const gated =
      /notionConfigFor\(/.test(body) ||
      /await requireReader\(\)/.test(body) ||
      /await requireEditor\(\)/.test(body) ||
      /resolveMonthlyTasks\([^)]*actor\.tenantId\)/.test(body);
    expect(gated).toBe(true);
  });

  it("requireReader·requireEditor 자체가 notionConfigFor를 본다", () => {
    for (const name of ["requireReader", "requireEditor"]) {
      const at = actions.indexOf(`async function ${name}(`);
      expect(at).toBeGreaterThan(-1);
      const body = actions.slice(at, actions.indexOf("\n}\n", at));
      expect(body).toContain("notionConfigFor(actor.tenantId)");
    }
  });

  it("서버 모듈은 Notion 환경변수를 직접 읽지 않는다(판정은 client.ts 한 곳)", () => {
    expect(server).not.toMatch(/process\.env\.NOTION/);
    expect(actions).not.toMatch(/process\.env\.NOTION/);
  });

  it("옛 전역 판정 함수는 사라졌다(되살리면 학원 조건 없이 켜진다)", () => {
    const client = readFileSync(path.join(__dirname, "..", "..", "..", "lib", "notion", "client.ts"), "utf8");
    expect(client).not.toMatch(/export function isNotionConfigured/);
    expect(client).not.toMatch(/export function notionTasksDatabaseId/);
  });
});

describe("이메일 자동연결 — 읽기 권한이면 저장하지 않는다(원장 2026-11-05)", () => {
  const actions = readFileSync(path.join(__dirname, "server", "notion-actions.ts"), "utf8");
  const server = readFileSync(path.join(__dirname, "server", "notion.ts"), "utf8");

  it("🔴 prepareStaffNotionMappingRow는 쓰기 판정을 저장(setStaffNotionUserIdRow)보다 먼저 본다", () => {
    const at = server.indexOf("export async function prepareStaffNotionMappingRow(");
    expect(at).toBeGreaterThan(-1);
    const body = server.slice(at, server.indexOf("export async function", at + 1));
    const guard = body.indexOf('if (!canWrite) return { state: "none" };');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf("setStaffNotionUserIdRow("));
  });

  it("prepareNotionMapping은 그 판정에 직원관리 쓰기 권한(canWriteTenant staff)을 넘긴다", () => {
    const at = actions.indexOf("export async function prepareNotionMapping(");
    const body = actions.slice(at, actions.indexOf("export async function", at + 1));
    expect(body).toMatch(/prepareStaffNotionMappingRow\(\s*staffId,\s*actor\.tenantId,\s*await canWriteTenant\(actor\.systemRole, "staff"\)/);
  });
});
