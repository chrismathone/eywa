import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fmtDuration, fmtRatio, routeLabel, usageMenuLabel, usageRoleLabel } from "./labels";
import { parseUsageQuery, usageHref } from "./query";
import { isTrackedRoute } from "./route-key";

describe("표시 말 — raw 키를 화면에 내지 않는다", () => {
  it("권한·메뉴", () => {
    expect(usageRoleLabel("master")).toBe("원장");
    expect(usageRoleLabel("super_admin")).toBe("슈퍼관리자");
    expect(usageRoleLabel("nope")).toBe("알 수 없는 권한");
    expect(usageMenuLabel("lesson_reports")).toBe("수업보고서");
    expect(usageMenuLabel("other")).toBe("기타 화면");
  });

  it("화면 이름 — 사이드바 하부 면은 그 이름, 아니면 모양", () => {
    expect(routeLabel("/billing?tab=sessions")).toBe("수납관리 › 회차 확정");
    expect(routeLabel("/attendance/live")).toBe("출석부 › 오늘 출결");
    expect(routeLabel("/students")).toBe("원생목록");
    expect(routeLabel("/students/[id]")).toBe("원생목록 › 상세");
    expect(routeLabel("/students/[id]?tab=grades")).toBe("원생목록 › 상세 · 탭");
    expect(routeLabel("/attendance/[date]")).toBe("출석부 › 날짜별");
    expect(routeLabel("/me")).toBe("기타 화면");
  });

  it("시간·비율", () => {
    expect(fmtDuration(0)).toBe("0초");
    expect(fmtDuration(45)).toBe("45초");
    expect(fmtDuration(59.6)).toBe("60초");
    expect(fmtDuration(90)).toBe("2분");
    expect(fmtDuration(3599)).toBe("1시간");
    expect(fmtDuration(3600 * 3 + 300)).toBe("3시간 5분");
    expect(fmtDuration(3600 * 1204)).toBe("1,204시간");
    expect(fmtRatio(1, 4)).toBe("25%");
    expect(fmtRatio(1, 0)).toBe("—");
  });
});

describe("조회 조건 주소", () => {
  it("모르는 값은 기본값으로 — 잘못된 지점 id가 DB 오류로 번지지 않게", () => {
    expect(parseUsageQuery({ days: "999", tenant: "'; drop", role: "god", sort: "x" })).toEqual({
      days: 30,
      tenantId: null,
      role: null,
      sort: "active",
    });
    expect(parseUsageQuery({ days: "7", tenant: "3F2A9C1E-1B2C-4D5E-8F90-A1B2C3D4E5F6", role: "super_admin", sort: "visits" })).toEqual({
      days: 7,
      tenantId: "3f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6",
      role: "super_admin",
      sort: "visits",
    });
  });

  it("기본값은 주소에 안 적는다", () => {
    const q = parseUsageQuery({});
    expect(usageHref(q)).toBe("/super-admin/usage");
    expect(usageHref(q, { days: 7, role: "teacher" })).toBe("/super-admin/usage?days=7&role=teacher");
  });
});

describe("배선 가드", () => {
  it("셸의 모든 첫 칸 화면을 받는다 — 새 라우트가 메뉴 표에도 NON_MENU_SHELL_SEGMENTS에도 없으면 그 이용이 조용히 버려진다", () => {
    const dirs = readdirSync("src/app/(shell)").filter(
      (d) => statSync(`src/app/(shell)/${d}`).isDirectory() && !d.startsWith("(") && !d.startsWith("[") && !d.startsWith("_"),
    );
    expect(dirs.length).toBeGreaterThan(20);
    expect(dirs.filter((d) => !isTrackedRoute(`/${d}`))).toEqual([]);
  });

  it("셸 세 갈래(창·강사 미니셸·풀셸) 모두 계측기를 단다 — 한 갈래라도 빠지면 그 화면 이용이 통째로 0이 된다", () => {
    const layout = readFileSync("src/app/(shell)/layout.tsx", "utf8");
    expect(layout.match(/<UsageTracker \/>/g)?.length).toBe(3);
  });

  it("DB: RLS를 켜고 정책 없이 닫으며, 함수는 service_role만 실행한다", () => {
    const sql = readFileSync("supabase/migrations/0292a_page_usage_daily.sql", "utf8");
    expect(sql).toContain("alter table public.page_usage_daily enable row level security");
    expect(sql).toContain("revoke all on table public.page_usage_daily from anon, authenticated");
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/revoke all on function public\.record_page_usage\([^)]*\) from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on function public\.page_usage_summary\([^)]*\) from public, anon, authenticated/);
  });
});
