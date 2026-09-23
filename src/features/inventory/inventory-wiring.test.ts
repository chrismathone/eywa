/**
 * 재고관리 배선 가드 — **성질**을 검사한다(소스의 들여쓰기·따옴표 모양을 문자열로 잡지 않는다).
 *
 * 1. 메뉴키 `inventory`가 MENU_KEYS·MENU_LABEL·MENU_ICON·MENU_ACCESS·경로 해석에 **전부** 있다.
 * 2. 상태·분류·대여상태·실사결과의 모든 키에 한글 라벨(status.test.ts가 잠근다 — 여기선 요약만).
 * 3. needsAction 판정(status.test.ts).
 * 4. 시안 데이터를 규약에 넣으면 스탯이 전체 94 · 사용중 75 · 대여중 4 · 조치필요 15 · 폐기 2.
 * 5. 쓰기 서버 액션이 canWriteTenant("inventory")를 지난다(canAccess를 쓰면 실패).
 * 6. faces.ts가 SUBTABS_BY_MENU.inventory에서 파생된다(faces.test.ts).
 * 7. CANON_SURFACES에 /inventory 화면이 등록돼 있다.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MENU_ICON } from "@/components/icons/aywa-icons";
import { MENU_ACCESS, MENU_KEYS, MENU_LABEL, canAccess, canWrite, menuKeyForPath } from "@/lib/permissions";
import { NAV_GROUPS, SUBTABS_BY_MENU } from "@/lib/navigation";
import { routeWindowSize } from "@/components/workspace/window-geometry";
import { toAssetRow } from "../../../scripts/_oneoff/inventory-import-rules.mjs";
import design from "../../../scripts/_oneoff/inventory-2026-07.json";
import { BUILTIN_CATEGORIES } from "./category";
import { ASSET_STATUS_LABEL } from "./status";
import { actionNeededAssets, computeAssetStats } from "./stats";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

describe("① 메뉴키 inventory — 다섯 자리 전부", () => {
  it("MENU_KEYS · MENU_LABEL(한글) · MENU_ICON · MENU_ACCESS · 경로 해석", () => {
    expect(MENU_KEYS).toContain("inventory");
    expect(MENU_LABEL.inventory).toBe("재고관리");
    expect(MENU_ICON.inventory).toBe("archive");
    expect(MENU_ACCESS.inventory).toBeDefined();
    expect(menuKeyForPath("/inventory")).toBe("inventory");
  });
  it("사이드바 항목 라벨 = 페이지 metadata.title 접두(창 타이틀바 동기)", () => {
    const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.menuKey === "inventory");
    expect(item?.href).toBe("/inventory");
    expect(item?.label).toBe("재고관리");
    expect(read("src", "app", "(shell)", "inventory", "page.tsx")).toContain('"재고관리');
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
  it("🔴 사이드바 하부탭은 없다 — 원장 2026-09-02 \"그냥 '재고관리' 1개\" (면은 화면 안 탭바 faces.ts)", () => {
    expect(SUBTABS_BY_MENU.inventory).toBeUndefined();
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
    // 분류는 0247a 이후 학원별 데이터지만, 가져오기 스크립트는 **내장 7종**(시드와 같은 값)만 다룬다.
    for (const c of BUILTIN_CATEGORIES) expect(categoryKey[c.label]).toBe(c.key);
  });
});

describe("⑧ 자산 분류(0247a) — 코드 고정 enum을 학원별 데이터로", () => {
  it("마이그레이션이 내장 7종을 그대로 시드하고 CHECK를 FK로 바꾼다", () => {
    const sql = read("supabase", "migrations", "0247a_inventory_categories.sql");
    for (const c of BUILTIN_CATEGORIES) {
      expect(sql, `시드에 ${c.label} 없음`).toContain(`'${c.key}'`);
      expect(sql, `시드에 접두 ${c.codePrefix} 없음`).toContain(`'${c.codePrefix}'`);
    }
    expect(sql).toMatch(/drop constraint if exists inventory_assets_category\b/);
    expect(sql).toMatch(/foreign key \(tenant_id, category\)[\s\S]*references public\.inventory_categories \(tenant_id, key\)/);
    expect(sql).toContain("on delete restrict");
    // RLS는 0242a 4개 표와 같은 모양(읽기 = 테넌트 전원, 쓰기 정책 없음).
    expect(sql).toContain("alter table public.inventory_categories enable row level security");
    expect(sql).toMatch(/for select using \(tenant_id = public\.auth_tenant_id\(\)\)/);
    // 🔴 auth_menu_access를 RLS에 쓰면 fail-closed 락아웃([[#92]]) — 주석의 "쓰지 말 것"은 뺀다.
    const statements = sql.replace(/^\s*--.*$/gm, "");
    expect(statements).not.toContain("auth_menu_access");
  });
  it("🔴 코드에 분류 하드코딩 맵을 다시 만들지 않는다(라벨·접두 소비처는 CategoryMaps)", () => {
    const dir = join(process.cwd(), "src", "features", "inventory");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts") && n !== "category.ts" && !n.endsWith(".test.ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, `${f}: 분류 라벨/접두 상수 신설 금지`).not.toMatch(/ASSET_CATEGORY_LABEL|ASSET_CODE_PREFIX|ASSET_CATEGORIES\b/);
    }
  });
  it("엑셀 반영은 새 분류 확인을 **서버가 다시 계산해** 대조한다([[#77]])", () => {
    const src = read("src", "features", "inventory", "server", "excel-actions.ts");
    expect(src).toContain("planNewCategories(");
    expect(src).toContain("confirmMatchesPlan(");
    // FK 순서 — 분류 insert가 자산 insert보다 앞이어야 한다.
    expect(src.indexOf('from("inventory_categories")')).toBeLessThan(src.indexOf('from("inventory_assets").insert'));
  });
  it("감사로그 — 분류 추가 액션·대상이 한글로 등록돼 있다", () => {
    expect(read("src", "features", "audit", "server", "log.ts")).toMatch(/^\s{2}inventory_category_create:/m);
    const describeSrc = read("src", "features", "audit", "describe.ts");
    expect(describeSrc).toContain('case "inventory_category_create"');
    expect(describeSrc).toMatch(/\binventory_category: "[가-힣 ]+"/);
  });
});

describe("⑨ QR 자산 화면 = 비로그인 공개 · 셸 없음 · 읽기 전용(원장 2026-09-03)", () => {
  const PAGE = ["src", "app", "(asset)", "inventory", "asset", "[code]", "page.tsx"];

  it("🔴 주소는 그대로다 — 이미 인쇄한 라벨이 `/inventory/asset/<자산ID>`를 가리킨다", () => {
    // 라우트 그룹 `(asset)`은 URL에 안 나타난다 → 파일 경로에서 그룹만 뺀 것이 곧 주소다.
    expect(existsSync(join(process.cwd(), ...PAGE))).toBe(true);
    // QR이 담는 주소 규약도 불변(여기가 바뀌면 붙여 둔 라벨이 전부 죽는다).
    expect(read("src", "features", "inventory", "qr.ts")).toContain("`/inventory/asset/${encodeURIComponent(normalizeAssetCode(assetCode))}`");
    // 옛 자리((shell))엔 남아 있으면 안 된다 — 같은 주소가 두 번 잡히면 빌드가 깨진다.
    expect(existsSync(join(process.cwd(), "src", "app", "(shell)", "inventory", "asset"))).toBe(false);
  });

  it("크롬리스 그룹 = (seat)·(share)와 같은 모양의 layout + 하단 여백은 페이지가 직접", () => {
    const layout = read("src", "app", "(asset)", "layout.tsx");
    expect(layout).toContain("min-h-screen");
    // 셸 레이아웃(사이드바·헤더·알림벨)을 끌어오지 않는다.
    expect(layout).not.toMatch(/AppShell|Sidebar|NotificationBell/);
    // 크롬리스는 셸 main의 pb를 못 받는다 → 페이지가 **둘 다** 직접 준다(디자인 규약 `pb-8 lg:pb-10`).
    const page = read(...PAGE);
    expect(page).toContain("pb-8");
    expect(page).toContain("lg:pb-10");
  });

  it("🔴 인증 우회는 `/inventory/asset/` 한 갈래뿐 — 목록·인쇄는 안 열린다", () => {
    const proxy = read("src", "lib", "supabase", "proxy.ts");
    expect(proxy).toContain('pathname.startsWith("/inventory/asset/")');
    // "/inventory"로 여는 순간 자산 대장 전체가 공개된다.
    expect(proxy).not.toMatch(/startsWith\("\/inventory"\)/);
    expect(proxy).not.toMatch(/pathname === "\/inventory"[^/]/);
  });

  it("🔴 공개 화면은 읽기 전용 — 로그인 게이트도 쓰기 버튼도 없다", () => {
    const page = read(...PAGE);
    // requireAccess가 남아 있으면 비로그인이 못 연다(이 변경의 요지가 사라진다).
    expect(page).not.toContain("requireAccess");
    // 상태 변경·대여·실사·엑셀 같은 쓰기 진입로가 딸려 들어오지 않게.
    expect(page).not.toMatch(/StatusDialog|LoanDialog|AuditDialog|ExcelDialog|-actions"/);
    // 목록 링크·QR 블록 제거(원장 *"목록으로 갈 필요도 없음"* · QR을 찍고 온 사람에게 QR 재노출 금지).
    expect(page).not.toContain("재고관리 목록");
    expect(page).not.toContain("qrImageSrc");
    // 최근 실사 아래 한 줄(문구 그대로, 다른 안내 추가 금지).
    expect(page).toContain("문의는 2층 데스크로 부탁드립니다.");
  });

  it("🔴 머리글은 제목 한 줄뿐 — 자산ID·분류·모델·상태는 카드 안에서만(중복 금지)", () => {
    const page = read(...PAGE);
    // 원장 2026-09-03 *"그냥 자산 관리 정보 라고 적당히 거대한 폰트로 적어놓던지"* + *"그 아래에 카드 시작"*.
    expect(page).toContain("자산 관리 정보");
    // PageHeader는 eyebrow·description·actions로 걷어낸 그 중복을 도로 만든다.
    // (주석에서 "PageHeader를 쓰지 않는다"고 설명하므로 **import·태그**로만 판정한다.)
    expect(page).not.toMatch(/^import .*PageHeader.*$/m);
    expect(page).not.toMatch(/<PageHeader/);
    // 카드 첫 행이 자산번호 — 이게 빠지면 화면 어디에도 자산ID가 안 남는다(머리글에서 뺐으므로).
    expect(page).toMatch(/\["자산번호",/);
  });

  it("세션 없이도 읽는다 — admin + 자산ID가 유일할 때만(테넌트 모호하면 못 찾은 것으로)", () => {
    const q = read("src", "features", "inventory", "server", "asset-queries.ts");
    expect(q).toContain("createAdminClient");
    // 세션에서 테넌트를 얻으면 비로그인에서 항상 null이라 화면이 통째로 404가 된다.
    // (주석의 설명 문장은 걸리면 안 되므로 **import 문**으로만 판정한다.)
    expect(q).not.toMatch(/^import .*(getCurrentUser|supabase\/server).*$/m);
    // 유일성 확인 — limit(2) 후 정확히 1건일 때만.
    expect(q).toContain(".limit(2)");
    expect(q).toMatch(/rows\.length !== 1/);
    // admin은 RLS 우회 → 대여·실사는 그 자산의 tenant로 좁힌다.
    expect((q.match(/\.eq\("tenant_id", tenantId\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
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
  it("감사로그 액션 16종이 레지스트리·상세 한글화에 있다", () => {
    const log = read("src", "features", "audit", "server", "log.ts");
    const describeSrc = read("src", "features", "audit", "describe.ts");
    for (const k of ["inventory_asset_create", "inventory_asset_update", "inventory_asset_status", "inventory_loan_out", "inventory_loan_return", "inventory_audit", "inventory_supply_update", "inventory_excel_import",
    "inventory_asset_holder", "inventory_asset_delete", "inventory_loan_update", "inventory_loan_delete",
    "inventory_audit_update", "inventory_audit_delete", "inventory_supply_delete", "inventory_supply_create"]) {
      expect(log).toMatch(new RegExp(`^\\s{2}${k}:`, "m"));
      expect(describeSrc).toContain(`case "${k}"`);
    }
    for (const t of ["inventory_asset", "inventory_loan", "inventory_audit", "inventory_supply"]) {
      expect(describeSrc).toMatch(new RegExp(`\\b${t}: "[가-힣 ]+"`));
    }
  });
});
