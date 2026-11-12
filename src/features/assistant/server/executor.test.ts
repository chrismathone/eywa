// 학원 비서 실행기 — 실행 계획 검사(앱 검사와 따로) · 오류 문장 · 셀 변환.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/observability/report-error", () => ({ reportWarning: () => undefined, reportError: () => undefined }));

import plans from "./__fixtures__/explain-plans.json";
import { formatDateTime } from "../components/report-format";
import { cell, openAssistantDb, planProblem, queryError } from "./executor";

describe("cell — 시각은 시간대를 붙인 ISO(브라우저 시간대와 무관하게 같은 시각)", () => {
  it("timestamptz(1184) → 한국 시각 +09:00", () => {
    const out = cell(new Date("2026-11-06T05:30:00Z"), 1184);
    expect(out).toBe("2026-11-06T14:30:00+09:00");
    // 화면 서식이 같은 시각을 읽는다(실제로 만드는 형식 그대로 — 적대 리뷰 2026-11-06).
    expect(formatDateTime(out as string)).toBe("26.11.06 14:30");
  });
  it("timestamp(1114, 시간대 없음) → 적힌 벽시계 그대로 +09:00", () => {
    // postgres.js와 같은 방식(시간대 없는 글자 → 서버 현지 시각).
    const out = cell(new Date("2026-11-06 14:30:00"), 1114);
    expect(out).toBe("2026-11-06T14:30:00+09:00");
  });
  it("date(1082) → 날짜 글자 · numeric 글자 → 숫자 · 객체 → JSON", () => {
    expect(cell(new Date("2026-11-06"), 1082)).toBe("2026-11-06");
    expect(cell("12345.50", 1700)).toBe(12345.5);
    expect(cell({ a: 1 }, 3802)).toBe('{"a":1}');
    expect(cell(null, 25)).toBeNull();
  });
});

describe("planProblem — 플래너가 실제로 해석한 함수", () => {
  it("보기 조회 · 온톨로지 조인 · 가림 칸 · 날짜 함수의 실제 계획(PGlite EXPLAIN VERBOSE)은 통과", () => {
    for (const [name, plan] of Object.entries(plans)) expect(planProblem(plan), name).toBeNull();
  });
  it("다른 스키마의 함수는 거절(public 보안 정의자 · extensions · net)", () => {
    expect(planProblem([{ Plan: { Output: ["public.auth_tenant_id_base()"] } }])).toMatch(/public\.auth_tenant_id_base/);
    expect(planProblem([{ Plan: { Output: ["extensions.hmac('a'::text, 'b'::text, 'sha256'::text)"] } }])).toMatch(/extensions\.hmac/);
    expect(planProblem([{ Plan: { Output: ["net.http_get('https://x'::text)"] } }])).toMatch(/net\.http_get|http_get/);
  });
  it("pg_catalog에 있어도 위험한 함수는 거절", () => {
    for (const fn of ["set_config('role'::text, 'postgres'::text, true)", "pg_advisory_lock(1)", "pg_terminate_backend(1)", "query_to_xml('select 1'::text, true, true, ''::text)", "pg_sleep('1'::double precision)", "current_setting('assistant.binding'::text)"]) {
      expect(planProblem([{ Plan: { Output: [fn] } }]), fn).not.toBeNull();
    }
  });
  it("pg_catalog로 한정한 보통 함수와 bound_tenant는 통과", () => {
    expect(planProblem([{ Plan: { Output: ["pg_catalog.date_trunc('month'::text, s.created_at)"], "InitPlan": ["assistant_private.bound_tenant()"] } }])).toBeNull();
  });
});

describe("queryError — 화면에는 한국어, AI에게는 원문", () => {
  it("시간 초과 · 없는 칸", () => {
    const t = queryError({ code: "57014", message: "canceling statement due to statement timeout" });
    expect(t.message).toMatch(/8초/);
    expect(t.detail).toMatch(/statement timeout/);
    expect(queryError({ code: "42703", message: 'column "nme" does not exist' }).message).toBe("없는 칸을 썼습니다");
    expect(queryError(new Error("weird")).message).toBe("조회하지 못했습니다");
  });
});

describe("openAssistantDb", () => {
  it("연결 문자열이 없으면 한국어 안내로 멈춘다", async () => {
    const before = process.env.ASSISTANT_DATABASE_URL;
    delete process.env.ASSISTANT_DATABASE_URL;
    await expect(openAssistantDb("t", { userId: null, keys: ["master"] })).rejects.toThrow(/설정되지 않았습니다/);
    if (before !== undefined) process.env.ASSISTANT_DATABASE_URL = before;
  });
});

describe("조회 오류의 종류 — 연결·서버 쪽은 쪼개도 같다(전수 조회가 다시 하지 않게 · 재리뷰 2026-11-09)", () => {
  it("SQLSTATE 조회 오류는 query · 연결·서버 쪽은 connection", () => {
    expect(queryError({ code: "42703", message: "column x does not exist" }).kind).toBe("query");
    expect(queryError({ code: "57014", message: "canceling statement due to statement timeout" }).kind).toBe("query");
    expect(queryError({ code: "CONNECT_TIMEOUT", message: "write CONNECT_TIMEOUT" }).kind).toBe("connection");
    expect(queryError({ code: "08006", message: "connection failure" }).kind).toBe("connection");
    expect(queryError({ code: "57P01", message: "terminating connection" }).kind).toBe("connection");
    expect(queryError(new Error("socket hang up")).kind).toBe("connection");
  });
});
