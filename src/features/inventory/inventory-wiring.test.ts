/**
 * 재고 관리 배선 가드 — **성질**을 검사한다(소스의 들여쓰기·따옴표 모양을 문자열로 잡지 않는다).
 *
 * 1. 메뉴키 `inventory`가 MENU_KEYS·MENU_LABEL·MENU_ICON·MENU_ACCESS·경로 해석에 **전부** 있다.
 * 2. 상태·분류·대여상태·실사결과의 모든 키에 한글 라벨(status.test.ts가 잠근다 — 여기선 요약만).
 * 3. needsAction 판정(status.test.ts).
 * 4. 시안 데이터를 규약에 넣으면 스탯이 전체 94 · 사용중 75 · 대여중 4 · 조치필요 15 · 폐기 2.
 * 5. 쓰기 서버 액션이 canWriteTenant("inventory")를 지난다(canAccess를 쓰면 실패).
 * 6. faces.ts가 SUBTABS_BY_MENU.inventory에서 파생된다(faces.test.ts).
 * 7. CANON_SURFACES에 /inventory 화면이 등록돼 있다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MENU_ICON } from "@/components/icons/eywa-icons";
import { MENU_ACCESS, MENU_KEYS, MENU_LABEL, canAccess, canWrite, menuKeyForPath } from "@/lib/permissions";
import { NAV_GROUPS, SUBTABS_BY_MENU } from "@/lib/navigation";
import { routeWindowSize } from "@/components/workspace/window-geometry";
import { toAssetRow } from "../../../scripts/_oneoff/inventory-import-rules.mjs";
import design from "../../../scripts/_oneoff/inventory-2026-07.json";
import { ASSET_CATEGORY_LABEL } from "./category";
import { ASSET_STATUS_LABEL } from "./status";
import { actionNeededAssets, computeAssetStats } from "./stats";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

describe("① 메뉴키 inventory — 다섯 자리 전부", () => {
  it("MENU_KEYS · MENU_LABEL(한글) · MENU_ICON · MENU_ACCESS · 경로 해석", () => {
    expect(MENU_KEYS).toContain("inventory");
    expect(MENU_LABEL.inventory).toBe("재고 관리");
    expect(MENU_ICON.inventory).toBe("archive");
    expect(MENU_ACCESS.inventory).toBeDefined();
    expect(menuKeyForPath("/inventory")).toBe("inventory");
  });
  it("사이드바 항목 라벨 = 페이지 metadata.title 접두(창 타이틀바 동기)", () => {
    const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.menuKey === "inventory");
    expect(item?.href).toBe("/inventory");
    expect(item?.label).toBe("재고 관리");
    expect(read("src", "app", "(shell)", "inventory", "page.tsx")).toContain('"재고 관리');
  });
  it("권한 기본값 — 사무실 full · 회계 readonly · 강사·상담·뷰어·학생 none", () => {
    for (const r of ["master", "admin", "manager"] as const) expect(canWrite(r, "inventory")).toBe(true);
    expect(canAccess("accountant", "inventory")).toBe(true);
    expect(canWrite("accountant", "inventory")).toBe(false);
    for (const r of ["teacher", "counselor", "viewer", "student"] as const) expect(canAccess(r, "inventory")).toBe(false);
  });
  it("창 크기가 등록돼 있다(기본 480이면 11열 표가 통째로 접힌다)", () => {
    expect(routeWindowSize("inventory")?.w).toBeGreaterThanOrEqual(1100);
  });
  it("하부탭 4면 = 자산·대여·실사·소모품", () => {
    expect((SUBTABS_BY_MENU.inventory ?? []).map((s) => s.label)).toEqual(["자산", "대여", "실사", "소모품"]);
  });
});

describe("④ 시안 숫자 회귀 고정 — 가져오기 규칙 + 스탯 함수", () => {
  const rows = design.assets.map((a, i) => toAssetRow(a, i));
  it("표 96행 → 전체 94 · 사용중 75 · 대여중 4 · 조치필요 15 · 폐기 2", () => {
    expect(rows).toHaveLength(96);
    expect(computeAssetStats(rows)).toEqual({ total: 94, inUse: 75, onLoan: 4, needsAction: 15, disposed: 2 });
  });
  it("조치 목록 15건에 수리중 NB-010이 들어 있다(캡션 '분실·확인·미등록'은 줄인 말)", () => {
    const list = actionNeededAssets(rows).map((r) => r.asset_code);
    expect(list).toHaveLength(15);
    expect(list).toContain("NB-010");
    expect(list).toEqual(expect.arrayContaining(["NB-002", "NB-006", "NB-007", "NB-011", "NB-017", "TB-002", "TB-004", "PR-001", "PR-002", "TV-007", "TV-011"]));
  });
  it("미기재·모델확인필요·— 는 null, 상시는 due_note", () => {
    const nb011 = rows.find((r) => r.asset_code === "NB-011")!;
    expect(nb011.maker).toBeNull();
    expect(nb011.model).toBeNull();
    expect(nb011.acquired_on).toBeNull();
    expect(nb011.holder_name).toBeNull();
    // 폐기 2건은 폐기일과 짝(CHECK 제약) · 대여중 4건은 사용자 이름 스냅샷
    expect(rows.filter((r) => r.status === "disposed").every((r) => r.disposed_on)).toBe(true);
    expect(rows.filter((r) => r.status === "on_loan").map((r) => r.holder_name)).toEqual(["김태건", "육소희", "확인필요", "셔틀담당"]);
    expect(rows.every((r) => r._check === null)).toBe(true);
  });
  it("가져오기 규칙의 한글→키 맵은 앱 라벨 맵의 역방향이다(두 벌이 갈리지 않게)", async () => {
    const rules = await import("../../../scripts/_oneoff/inventory-import-rules.mjs");
    const statusKey = rules.STATUS_KEY as Record<string, string>;
    const categoryKey = rules.CATEGORY_KEY as Record<string, string>;
    for (const [key, label] of Object.entries(ASSET_STATUS_LABEL)) expect(statusKey[label]).toBe(key);
    for (const [key, label] of Object.entries(ASSET_CATEGORY_LABEL)) expect(categoryKey[label]).toBe(key);
  });
});

describe("⑤ 쓰기 서버 액션은 canWriteTenant(\"inventory\")를 지난다", () => {
  const dir = join(process.cwd(), "src", "features", "inventory", "server");
  const actionFiles = readdirSync(dir).filter((f) => f.endsWith("-actions.ts"));
  it("게이트 단일 소스가 canWriteTenant를 부르고 canAccess는 안 쓴다", () => {
    const access = read("src", "features", "inventory", "server", "access.ts");
    expect(access).toMatch(/canWriteTenant\(\s*user\.systemRole,\s*"inventory"\s*\)/);
    expect(access).not.toMatch(/\bcanAccess(Tenant)?\(/);
  });
  it.each(actionFiles)("%s — export된 액션마다 requireInventoryWrite를 먼저 부른다", (f) => {
    const src = readFileSync(join(dir, f), "utf8");
    expect(src.startsWith('"use server"')).toBe(true);
    expect(src).not.toMatch(/\bcanAccess(Tenant)?\(/);
    const exported = src.match(/export async function \w+\(/g) ?? [];
    const gated = src.match(/await requireInventoryWrite\(\)/g) ?? [];
    expect(exported.length).toBeGreaterThan(0);
    expect(gated.length).toBe(exported.length);
    // 🔴 "use server" 파일은 async만 export([[#119]]) — 동기 export가 있으면 빌드만 깨진다.
    expect(src).not.toMatch(/^export (const|let|var|function)\b(?!.*async)/m);
  });
  it("admin 클라이언트 쿼리는 tenant_id를 명시한다(RLS 우회)", () => {
    for (const f of actionFiles) {
      const src = readFileSync(join(dir, f), "utf8");
      const fromCalls = (src.match(/\.from\("inventory_\w+"\)/g) ?? []).length;
      const tenantFilters = (src.match(/\.eq\("tenant_id", ctx\.tenantId\)|tenant_id: ctx\.tenantId/g) ?? []).length;
      expect(tenantFilters, `${f}: from ${fromCalls} vs tenant filter ${tenantFilters}`).toBeGreaterThanOrEqual(fromCalls);
    }
  });
});

describe("⑦ 툴바 캐논 · 감사로그 등록", () => {
  it("CANON_SURFACES에 /inventory 화면이 있다", () => {
    const canon = read("src", "components", "toolbar-canon.test.ts");
    expect(canon).toContain("src/app/(shell)/inventory/_components/assets-face.tsx");
  });
  it("감사로그 액션 7종이 레지스트리·상세 한글화에 있다", () => {
    const log = read("src", "features", "audit", "server", "log.ts");
    const describeSrc = read("src", "features", "audit", "describe.ts");
    for (const k of ["inventory_asset_create", "inventory_asset_update", "inventory_asset_status", "inventory_loan_out", "inventory_loan_return", "inventory_audit", "inventory_supply_update"]) {
      expect(log).toMatch(new RegExp(`^\\s{2}${k}:`, "m"));
      expect(describeSrc).toContain(`case "${k}"`);
    }
    for (const t of ["inventory_asset", "inventory_loan", "inventory_audit", "inventory_supply"]) {
      expect(describeSrc).toMatch(new RegExp(`\\b${t}: "[가-힣 ]+"`));
    }
  });
});
