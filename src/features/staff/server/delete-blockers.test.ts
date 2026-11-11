import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrationFiles } from "@/lib/db/migrations-corpus.mjs";
const m = vi.hoisted(() => ({ rpc: vi.fn(), explain: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: m.rpc }) }));
vi.mock("@/lib/supabase/db-error", () => ({ explainDbError: m.explain }));
import { deleteStaffAccount, staffDeleteBlockedMessage } from "./delete-blockers";

beforeEach(() => { vi.resetAllMocks(); m.explain.mockImplementation((_e: unknown, o: { fallback: string }) => ({ message: o.fallback })); });
describe("직원 완전 삭제 — 한 거래로(막히면 아무것도 지워지지 않는다)", () => {
  it("지점·직원은 서버가 넘기고, 지워지면 로그인 계정 유무를 돌려준다", async () => {
    m.rpc.mockResolvedValue({ data: { status: "deleted", login: true }, error: null });
    expect(await deleteStaffAccount("tenant", "u")).toEqual({ ok: true, loginDeleted: true });
    expect(m.rpc).toHaveBeenCalledWith("delete_staff_account", { p_tenant: "tenant", p_user: "u" });
    m.rpc.mockResolvedValue({ data: { status: "deleted", login: false }, error: null });
    expect(await deleteStaffAccount("tenant", "u")).toEqual({ ok: true, loginDeleted: false });
  });
  it("삭제를 막는 기록이 있으면 비활성 처리를 안내한다 — 표 이름 원문은 내지 않는다", async () => {
    m.rpc.mockResolvedValue({ data: { status: "blocked", tables: ["academy_work_records", "academy_work_record_events", "organization_okr", "some_future_table"] }, error: null });
    const r = await deleteStaffAccount("tenant", "u");
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error).toContain("업무 문서 · 조직·OKR 목표 외 1종"); expect(r.error).toContain("퇴사(비활성)"); expect(r.error).not.toMatch(/[a-z]+_[a-z]+/); }
  });
  it("🔴 호출 실패(함수 없음 포함)·모르는 응답은 삭제로 치지 않는다", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "function not found" } });
    expect((await deleteStaffAccount("tenant", "u")).ok).toBe(false);
    m.rpc.mockResolvedValue({ data: null, error: null });
    expect((await deleteStaffAccount("tenant", "u")).ok).toBe(false);
    m.rpc.mockResolvedValue({ data: { status: "not_found" }, error: null });
    expect(await deleteStaffAccount("tenant", "u")).toEqual({ ok: false, error: "대상 직원을 찾을 수 없습니다" });
  });
  it("검사가 못 본 갈래로 DB가 거절해도 '다시 시도'나 남의 표 사정이 아니라 비활성 처리를 안내한다", async () => {
    // 지움 규칙이 다른 FK · NOT NULL · 따라 고쳐지는 이력 표의 '고치지 마라' 트리거(학원 비서 의견 처리 이력 등).
    for (const [code, message] of [["23503", "violates foreign key"], ["23502", "null value"], ["42501", "처리 이력은 고치지 않고 새 줄로 남깁니다"], ["P0001", "기록은 새 버전으로 보완해 주세요"]]) {
      m.rpc.mockResolvedValue({ data: null, error: { code, message } });
      const r = await deleteStaffAccount("tenant", "u");
      expect(r.ok).toBe(false);
      if (!r.ok) { expect(r.error).toContain("퇴사(비활성)"); expect(r.error).not.toContain("처리 이력"); expect(r.error).not.toContain("새 버전"); }
    }
  });
  it("보호 계정 거절은 그 문장 그대로 · 그 밖의 오류(교착·시간 초과)는 일반 안내", async () => {
    m.explain.mockImplementation(() => ({ message: "보호된 계정입니다 — 삭제할 수 없습니다. 운영자에게 요청하세요." }));
    m.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "보호된 계정입니다 — 삭제할 수 없습니다. 운영자에게 요청하세요." } });
    expect(await deleteStaffAccount("tenant", "u")).toEqual({ ok: false, error: "보호된 계정입니다 — 삭제할 수 없습니다. 운영자에게 요청하세요." });
    // 함수 실행권이 빠진 경우(42501이지만 기록 탓이 아니다) — '남은 기록' 안내로 바꾸지 않는다.
    m.explain.mockImplementation(() => ({ message: "이 작업을 할 권한이 없습니다 — 계정 권한을 확인해 주세요" }));
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied for function delete_staff_account" } });
    expect(await deleteStaffAccount("tenant", "u")).toEqual({ ok: false, error: "이 작업을 할 권한이 없습니다 — 계정 권한을 확인해 주세요" });
    m.explain.mockImplementation(() => ({ message: "다른 저장과 동시에 처리되어 실패했습니다 — 다시 시도해 주세요" }));
    m.rpc.mockResolvedValue({ data: null, error: { code: "40P01", message: "deadlock detected" } });
    expect(await deleteStaffAccount("tenant", "u")).toEqual({ ok: false, error: "다른 저장과 동시에 처리되어 실패했습니다 — 다시 시도해 주세요" });
  });
  it("모르는 표뿐이어도 한글 안내", () => { expect(staffDeleteBlockedMessage(["x_y"])).toContain("그 밖의 업무 기록"); });
  it("🔴 삭제 경로는 Auth 서버를 따로 부르지 않는다 — 두 번에 나눠 지우면 로그인만 사라지거나(계정 먼저) 직원 행이 되살아난다(직원 행 먼저)", () => {
    const src = readFileSync(join(process.cwd(), "src/features/staff/server/account-actions.ts"), "utf8");
    const start = src.indexOf("export async function deleteStaff("), fn = src.slice(start, src.indexOf("\nexport async function", start + 10));
    expect(fn).toContain("deleteStaffAccount(actor.tenantId, id)");
    expect(fn).not.toMatch(/auth\.admin\.deleteUser/);
    expect(fn).not.toMatch(/\.from\("users"\)\s*\.delete\(\)/);
  });
  it("🔴 DB 함수는 로그인 계정 → 직원 행 순서로 잠그고, 검사 → 직원 행 → 로그인 계정 순서로 지운다", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/s2_0060_delete_staff_account.sql"), "utf8").replace(/--[^\n]*/g, "");
    const at = (needle: string) => { const i = sql.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
    const lockLogin = at("from auth.users u where u.id = p_user for update"), lockRow = at("from public.users u where u.id = p_user and u.tenant_id = p_tenant for update");
    const check = at("public.staff_delete_blockers(p_user)"), delRow = at("delete from public.users"), delLogin = at("delete from auth.users");
    expect(lockLogin).toBeLessThan(lockRow); expect(lockRow).toBeLessThan(check); expect(check).toBeLessThan(delRow); expect(delRow).toBeLessThan(delLogin);
    expect(sql).toMatch(/revoke all on function public\.delete_staff_account\(uuid, uuid\) from public, anon, authenticated/);
  });
  it("🔴 삭제 차단 검사의 마지막 정의는 FK 없는 문서 속 담당자 둘(관찰 기록 · 콜&상담 여정 기록)을 모두 센다 — 다시 정의할 때 한 갈래를 빠뜨리지 않게", () => {
    const defs = (migrationFiles() as Array<{ name: string; sql: string }>).filter((f) => /create (or replace )?function public\.staff_delete_blockers\(/.test(f.sql.replace(/--[^\n]*/g, "")));
    expect(defs.length).toBeGreaterThan(0);
    const last = defs.at(-1)!.sql.replace(/--[^\n]*/g, "");
    for (const table of ["academy_knowledge_records", "enrollment_journey_records"]) {
      expect(last, table).toContain(`from public.${table} where document->>''ownerId'' = $1`);
    }
    expect(last).toMatch(/revoke all on function public\.staff_delete_blockers\(uuid\) from public, anon, authenticated/);
  });
});
