import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * 퇴사자 권한 정리 — 서버 쪽(쓰기 · 감사로그 · 캐시) + 퇴사 경로 배선(원장 2026-11-09 *"퇴사시 같이 사라지게"*).
 * 상태를 가진 모의 DB로 학원 설정 쓰기 규칙을 본다: 방금 읽은 값 위에 그 사람의 주는 값만 · updated_at 비교(겹치면 다시 읽기) · permissions.rev + 1.
 * 🔴 좁히는 값(역할보다 낮은 개인 메뉴 줄)은 남긴다(리뷰 r1 F1) · 정리 실패도 감사로그(F8).
 */
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const m = vi.hoisted(() => ({
  row: null as null | { data: unknown; updated_at: string },
  /** 다음 쓰기 직전에 다른 저장이 먼저 쓰는 횟수(겹침 흉내). */
  raceWrites: 0,
  writes: [] as { data: unknown; updated_at: string }[],
  logs: [] as unknown[],
  /** 설정 표 조회가 던진다(네트워크 예외 흉내). */
  throwOnFrom: false,
  tags: [] as string[],
  readError: null as null | { message: string },
}));
vi.mock("next/cache", () => ({ updateTag: (tag: string) => m.tags.push(tag), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/features/audit/server/log", () => ({ logAction: async (args: unknown) => { m.logs.push(args); } }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./platform-settings", () => ({ platformAccountIds: vi.fn() }));

function fakeDb() {
  return {
    from: (table: string) => {
      expect(table).toBe("tenant_settings");
      if (m.throwOnFrom) throw new Error("synthetic network");
      const state: { patch?: { data: unknown; updated_at: string }; at?: string } = {};
      const q = {
        select: () => q,
        eq: (col: string, v: string) => {
          if (col === "updated_at") state.at = v;
          return q;
        },
        maybeSingle: async () => ({ data: m.readError ? null : m.row && { ...m.row }, error: m.readError }),
        update: (patch: { data: unknown; updated_at: string }) => {
          state.patch = patch;
          return q;
        },
      };
      const selectAfterUpdate = async () => {
        if (m.raceWrites > 0) {
          m.raceWrites--;
          m.row = { data: m.row!.data, updated_at: `${m.row!.updated_at}x` }; // 다른 저장이 먼저 썼다
        }
        if (!m.row || state.at !== m.row.updated_at) return { data: [], error: null };
        m.row = { data: state.patch!.data, updated_at: state.patch!.updated_at };
        m.writes.push(state.patch!);
        return { data: [{ tenant_id: "t-1" }], error: null };
      };
      q.select = ((...args: unknown[]) => (state.patch && args[0] === "tenant_id" ? selectAfterUpdate() : q)) as typeof q.select;
      return q;
    },
  };
}

const { dropPersonFromSettings } = await import("./retired-people");

beforeEach(() => {
  m.row = {
    updated_at: "2026-11-09T10:00:00.000Z",
    data: {
      permissions: {
        rev: 7,
        overrides: [{ menu: "staff", role: "admin", access: "full" }],
        // 전자결재 전체 = 관리자 역할 칸(없음)보다 더 준다 → 지운다 · 직원관리 없음 = 역할 칸(전체)을 좁힌다 → 남긴다.
        userOverrides: [{ userId: A, menu: "approvals", access: "full" }, { userId: A, menu: "staff", access: "none" }],
        specialAccess: { payslipViewerIds: [A, B], withdrawalApproverIds: [A] },
      },
      operations: { rev: 3, holidays: [] },
    },
  };
  m.raceWrites = 0;
  m.writes = [];
  m.logs = [];
  m.tags = [];
  m.readError = null;
  m.throwOnFrom = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

type Stored = { permissions: { rev: number; userOverrides: unknown[]; specialAccess: Record<string, string[]> }; operations: unknown };

describe("dropPersonFromSettings — 학원 설정 쓰기 규칙", () => {
  it("그 사람의 주는 값만 빼고 · 역할·권한 순번을 올리고 · updated_at을 앞으로 민다 — 좁히는 줄·다른 사람·다른 섹션은 그대로", async () => {
    const r = await dropPersonFromSettings("t-1", A, "admin", fakeDb() as never);
    expect(r).toEqual({ ok: true, removed: ["payslipViewerIds", "userOverrides"], kept: ["withdrawalApproverIds"] });
    expect(m.writes).toHaveLength(1);
    const d = m.row!.data as Stored;
    expect(d.permissions.specialAccess.payslipViewerIds).toEqual([B]);
    expect(d.permissions.specialAccess.withdrawalApproverIds).toEqual([A]);
    expect(d.permissions.userOverrides).toEqual([{ userId: A, menu: "staff", access: "none" }]);
    expect(d.permissions.rev).toBe(8);
    expect(d.operations).toEqual({ rev: 3, holidays: [] });
    expect(Date.parse(m.row!.updated_at)).toBeGreaterThan(Date.parse("2026-11-09T10:00:00.000Z"));
  });

  it("역할을 모르면 개인 메뉴 줄은 지우지 않는다(명단 칸만)", async () => {
    const r = await dropPersonFromSettings("t-1", A, null, fakeDb() as never);
    expect(r).toEqual({ ok: true, removed: ["payslipViewerIds"], kept: ["withdrawalApproverIds"] });
    expect((m.row!.data as Stored).permissions.userOverrides).toHaveLength(2);
  });

  it("🔴 그사이 다른 저장이 먼저 썼으면 다시 읽어 그 값 위에서 뺀다(덮어쓰지 않는다)", async () => {
    m.raceWrites = 1;
    const r = await dropPersonFromSettings("t-1", A, "admin", fakeDb() as never);
    expect(r.ok).toBe(true);
    expect(m.writes).toHaveLength(1);
  });

  it("세 번 내리 겹치면 쓰지 않고 실패로 돌려준다(퇴사는 그대로 · 읽는 쪽이 거른다)", async () => {
    m.raceWrites = 3;
    expect(await dropPersonFromSettings("t-1", A, "admin", fakeDb() as never)).toEqual({ ok: false, reason: "conflict" });
    expect(m.writes).toHaveLength(0);
  });

  it("그 사람이 없으면 쓰지 않는다 · 못 읽으면 쓰지 않는다", async () => {
    expect(await dropPersonFromSettings("t-1", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "admin", fakeDb() as never)).toEqual({ ok: true, removed: [], kept: [] });
    m.readError = { message: "synthetic" };
    expect(await dropPersonFromSettings("t-1", A, "admin", fakeDb() as never)).toEqual({ ok: false, reason: "read" });
    expect(m.writes).toHaveLength(0);
  });
});

describe("cleanupPersonSettings — 감사로그(뺀 칸 · 남긴 칸 · 실패) + 설정 캐시 비우기", () => {
  it("뺀 칸을 감사로그에 남기고 설정 캐시를 비운다", async () => {
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeDb() }));
    vi.resetModules();
    const mod = await import("./retired-people");
    await mod.cleanupPersonSettings({ tenantId: "t-1", userId: A, role: "admin", targetLabel: "합성 직원", reason: "retire" });
    expect(m.logs).toEqual([{ action: "staff_permission_cleanup", targetType: "staff", targetLabel: "합성 직원", metadata: { userId: A, reason: "retire", removed: ["payslipViewerIds", "userOverrides"], kept: ["withdrawalApproverIds"] } }]);
    expect(m.tags).toEqual(["tenant-settings:t-1"]);
    vi.doUnmock("@/lib/supabase/admin");
  });

  it("정리할 것이 없어도 캐시는 비운다(읽는 쪽의 퇴사자 조회가 같은 태그로 캐시돼 있다)", async () => {
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeDb() }));
    vi.resetModules();
    const mod = await import("./retired-people");
    await mod.cleanupPersonSettings({ tenantId: "t-1", userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", role: "admin", targetLabel: null, reason: "reactivate" });
    expect(m.logs).toEqual([]);
    expect(m.tags).toEqual(["tenant-settings:t-1"]);
    vi.doUnmock("@/lib/supabase/admin");
  });

  it("🔴 정리에 실패해도(못 읽음 · 던짐) 감사로그에 '실패'를 남기고 캐시를 비운다 — 던지지 않는다(리뷰 r1 F8)", async () => {
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeDb() }));
    vi.resetModules();
    const mod = await import("./retired-people");
    m.readError = { message: "synthetic" };
    expect(await mod.cleanupPersonSettings({ tenantId: "t-1", userId: A, role: "admin", targetLabel: "합성 직원", reason: "retire" })).toEqual({ ok: false, reason: "read" });
    m.readError = null;
    m.throwOnFrom = true;
    expect(await mod.cleanupPersonSettings({ tenantId: "t-1", userId: A, role: "admin", targetLabel: "합성 직원", reason: "delete" })).toEqual({ ok: false, reason: "write" });
    expect(m.logs).toEqual([
      { action: "staff_permission_cleanup", targetType: "staff", targetLabel: "합성 직원", metadata: { userId: A, reason: "retire", failed: "read" } },
      { action: "staff_permission_cleanup", targetType: "staff", targetLabel: "합성 직원", metadata: { userId: A, reason: "delete", failed: "write" } },
    ]);
    expect(m.tags).toEqual(["tenant-settings:t-1", "tenant-settings:t-1"]);
    vi.doUnmock("@/lib/supabase/admin");
  });
});

describe("🔴 퇴사 경로 배선 — 직원을 퇴사·재입사·삭제하는 곳이 전부 같은 정리를 부른다", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const body = (src: string, fn: string) => {
    const at = src.indexOf(`export async function ${fn}(`);
    expect(at, fn).toBeGreaterThan(-1);
    const next = src.indexOf("\nexport ", at + 10);
    return src.slice(at, next < 0 ? undefined : next);
  };

  it("직원관리 퇴사(재입사 포함) · 인계 후 퇴사 · 완전 삭제", () => {
    const staff = read("src/features/staff/server/actions.ts");
    expect(body(staff, "deactivateStaff")).toMatch(/if \(next === "inactive" \|\| target\.status === "inactive"\) \{\s*await cleanupPersonSettings\(\{[^}]*role: target\.role,/);
    expect(body(staff, "handoverAndDeactivate")).toMatch(/await cleanupPersonSettings\(\{[^}]*role: target\.role,[^}]*reason: "retire" \}\)/);
    expect(body(read("src/features/staff/server/account-actions.ts"), "deleteStaff")).toMatch(/await cleanupPersonSettings\(\{[^}]*role: target\.role,[^}]*reason: "delete" \}\)/);
  });

  it("운영 콘솔의 계정 비활성·재활성", () => {
    const sa = body(read("src/features/super-admin/server/actions.ts"), "setUserActive");
    // 🔴 재직 상태가 실제로 저장된 뒤에만 정리하고(0행·오류면 안 한다) · 정리가 던져도 운영 감사는 남는다(리뷰 r1 F5).
    expect(sa).toMatch(/\.update\(\{ status: active \? "active" : "inactive" \}\)\.eq\("id", userId\)\.eq\("tenant_id", tenantId\)\.select\("id"\)/);
    expect(sa).toMatch(/const statusSaved = !statusErr && \(statusRows\?\.length \?\? 0\) > 0;/);
    expect(sa).toMatch(/const cleans = statusSaved && \(!active \|\| account\.status === "inactive"\);/);
    expect(sa).toMatch(/try \{[^}]*dropPersonFromSettings\(tenantId, userId, role as SystemRole \| null, admin\);\s*\} catch/);
    expect(sa).toMatch(/updateTag\(tenantSettingsTag\(tenantId\)\)/);
    expect(sa.search(/await logSuperAdminAction\(\{\s*actorId: sa\.id,\s*actorEmail: sa\.email,\s*action: "set_user_active"/)).toBeGreaterThan(sa.indexOf("const cleans"));
  });

  it("🔴 직원의 재직 상태(users.status)를 바꾸는 앱 코드 = 아는 곳뿐이다 — 새 퇴사·재입사 경로는 정리를 함께 부르고 여기에 올린다", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
      });
    const root = join(process.cwd(), "src");
    const writers = walk(root)
      .filter((p) => /\.from\("users"\)\s*\.update\(\{[^}]*\bstatus:/.test(readFileSync(p, "utf8")))
      .map((p) => relative(root, p).split(sep).join("/"))
      .sort();
    expect(writers).toEqual([
      // 새 직원 계정을 만들며 '재직'으로 채운다(방금 만든 계정 — 퇴사자를 되살리지 않는다): 엑셀 가져오기 · 공개 입사 서류 · 이력서로 계정 만들기.
      "features/excel-import/importers/staff.ts",
      "features/staff/intake/server/public-intake-actions.ts",
      "features/staff/resume/server/resume-actions.ts",
      // 퇴사 · 다시 재직으로 · 인계 후 퇴사 → cleanupPersonSettings(위 시험).
      "features/staff/server/actions.ts",
      // 운영 콘솔 비활성·재활성 → dropPersonFromSettings(위 시험).
      "features/super-admin/server/actions.ts",
    ]);
  });

  it("읽는 쪽 — 설정 읽기 둘과 역할·권한 편집기가 퇴사자를 거른다(편집기의 기준 token은 저장값 그대로)", () => {
    const q = read("src/features/owner/server/queries.ts");
    expect(q).toMatch(/return withoutRetiredPeople\(settings, await retiredIn\(user\.tenantId, raw\.data, raw\.retired\)\);/);
    expect(q).toMatch(/return withoutRetiredPeople\(resolveSettings\(stored, \{ name: tenantRes\.data\?\.name \?\? "" \}\), await retiredIn\(tenantId, stored\)\);/);
    // 🔴 퇴사자 집합은 설정 캐시 항목 **안에서** 함께 계산한다(창마다 왕복이 늘지 않게 — 리뷰 r1 F7 · B6). 키를 올려 옛 항목과 섞지 않는다.
    expect(q).toMatch(/retired = await retiredPeopleEntries\(ids, admin\);/);
    expect(q).toMatch(/\["tenant-settings-v4", tenantId\]/);
    const page = read("src/app/(shell)/owner/page.tsx");
    expect(page).toMatch(/initial=\{permissionsInitial \?\? permissionsSource\}/);
    expect(page).toMatch(/baselineToken=\{permissionsToken\(permissionsSource\)\}/);
  });
});
