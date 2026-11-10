import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORT_GROUPS, hubGroupsFor } from "@/lib/menu-hub";
import { SUBTABS_BY_MENU } from "@/lib/navigation";
import { MENU_ACCESS, MENU_LABEL, resolveMatrix, type SystemRole } from "@/lib/permissions";
import { OWNER_FACES, OWNER_TABS, ownerTabLabel, resolveOwnerTab } from "./tabs";

/**
 * 학원 설정 면 목록 = **한 곳**(2026-10-06). 화면 탭 · 사이드바 하부탭 · 설정 메뉴 판이 같은 배열에서 파생한다.
 *
 * 전에는 설정 메뉴 판(`menu-hub.ts`)이 같은 면을 제 목록으로 따로 들고 있었다 — 라벨이 갈렸고('대시보드 관리' ↔ '대시보드 구성'),
 * 묶음이 달랐고(팝업 공지: 화면 탭은 '관리', 메뉴 판은 '청구·안내'), 원장 위에게만 서는 면의 판정도 달랐다
 * (대시보드 관리: 화면 탭은 위임 계정에게 감추는데 메뉴 판은 버튼을 세웠다 — 눌러도 안내 문구뿐인 입구).
 */
const CATEGORIES = ["학원 정보", "수업·운영", "청구·안내", "권한·화면", "관리"];

describe("면 목록", () => {
  it("키와 주소가 겹치지 않고, 첫 면(기본 면)만 `?tab=` 없는 주소다", () => {
    expect(new Set(OWNER_FACES.map((f) => f.key)).size).toBe(OWNER_FACES.length);
    expect(new Set(OWNER_FACES.map((f) => f.href)).size).toBe(OWNER_FACES.length);
    expect(OWNER_FACES[0]).toMatchObject({ key: "profile", href: "/owner" });
    for (const face of OWNER_FACES.slice(1)) expect(face.href).toBe(`/owner?tab=${face.key}`);
  });

  it("범주는 다섯이고, 목록 순서대로 읽으면 범주가 한 덩어리씩 이어진다(메뉴 판의 묶음 순서 = 화면 탭의 순서)", () => {
    const seen: string[] = [];
    for (const face of OWNER_FACES) if (seen.at(-1) !== face.category) seen.push(face.category);
    expect(seen).toEqual(CATEGORIES);
  });

  it("화면 탭의 구분선(설정 ┃ 관리)과 범주가 어긋나지 않는다 — '관리' 범주가 곧 관리 묶음이다", () => {
    for (const face of OWNER_FACES) expect(face.group === "관리", face.key).toBe(face.category === "관리");
  });

  it("범주별 면(원장 합의 2026-10-06)", () => {
    const byCategory = (category: string) => OWNER_FACES.filter((f) => f.category === category).map((f) => f.label);
    expect(byCategory("학원 정보")).toEqual(["프로필·브랜드"]);
    expect(byCategory("수업·운영")).toEqual(["운영 체계", "과목 운영", "보강 운영", "강사평가", "원생 로열티"]);
    expect(byCategory("청구·안내")).toEqual(["수납·청구", "알림·약관", "상담 양식"]);
    expect(byCategory("권한·화면")).toEqual(["역할·권한", "탭 및 메뉴 구성", "기능", "대시보드 관리"]);
    expect(byCategory("관리")).toEqual(["팝업 공지", "데이터 정리", "데이터 가져오기", "감사로그", "연동"]);
  });

  it("어느 학원에나 서는 면(OWNER_TABS)에는 일반판 전용 면('기능')이 없다 — 침산 화면에 버튼이 생기지 않는다", () => {
    expect(OWNER_TABS.map((t) => t.key)).toEqual(OWNER_FACES.filter((f) => f.key !== "modules").map((f) => f.key));
    expect(OWNER_FACES.filter((f) => f.genericOnly).map((f) => f.key)).toEqual(["modules"]);
    // 주소 해석은 종전 그대로 — '기능'은 화면이 따로 판정한다(일반판일 때만).
    expect(resolveOwnerTab("modules")).toBe("profile");
    expect(resolveOwnerTab("audit")).toBe("audit");
    expect(resolveOwnerTab("없는면")).toBe("profile");
  });

  it("🔴 원장 위에게만 입구를 세우는 면 = 보강 운영 · 강사평가 · 기능 · 대시보드 관리 · 감사로그(본문이 위임 계정에게 안내만 보이는 면들)", () => {
    expect(OWNER_FACES.filter((f) => f.masterOnly).map((f) => f.key)).toEqual(["makeups", "evaluation", "contribution", "modules", "dashboard", "audit"]);
  });

  it("라벨 조회는 '기능'까지 답한다", () => {
    expect(ownerTabLabel("modules")).toBe("기능");
    expect(ownerTabLabel("dashboard")).toBe("대시보드 관리");
  });
});

describe("파생 — 세 표면이 같은 목록을 쓴다", () => {
  const ownerHub = SUPPORT_GROUPS.find((g) => g.id === "owner")!;

  /** 설정의 면이 아니라 따로 선 화면인데 입구를 설정 메뉴 판에 둔 것 — 면 목록 뒤에 선다. */
  const EXTRA = [{ href: "/kiosk-settings", label: MENU_LABEL.kiosk_settings, section: "관리" }];
  const faceButtons = ownerHub.items.filter((d) => d.href.startsWith("/owner"));

  it("🔴 설정 메뉴 판의 버튼 = 면 목록(주소 · 라벨 · 범주 · 순서) + 따로 선 설정 화면", () => {
    expect(ownerHub.items.map((d) => ({ href: d.href, label: d.label, section: d.section }))).toEqual([
      ...OWNER_FACES.map((f) => ({ href: f.href, label: f.label, section: f.category })),
      ...EXTRA,
    ]);
  });

  it("키오스크 설정의 입구 — 권한 키는 제 것(kiosk_settings)이고, 창은 링크·딥링크와 같은 화면으로 열린다", () => {
    const kiosk = ownerHub.items.find((d) => d.href === "/kiosk-settings")!;
    expect(kiosk.menuKey).toBe("kiosk_settings");
    expect(kiosk.icon).not.toBe(ownerHub.icon);
  });

  it("🔴 원장 위 전용 · 일반판 전용 표식도 면 목록에서 온다", () => {
    expect(faceButtons).toHaveLength(OWNER_FACES.length);
    for (const face of OWNER_FACES) {
      const dest = ownerHub.items.find((d) => d.href === face.href)!;
      expect(!!dest.masterOnly, `${face.key}: masterOnly`).toBe(!!face.masterOnly);
      expect(!!dest.genericOnly, `${face.key}: genericOnly`).toBe(!!face.genericOnly);
    }
  });

  it("사이드바 하부탭 = 어느 학원에나 서는 면", () => {
    expect(SUBTABS_BY_MENU.owner).toEqual(OWNER_TABS.map((t) => ({ label: t.label, href: t.href })));
  });

  it("면마다 그림이 있다(부모의 톱니를 물려받지 않는다)", () => {
    const parentIcon = ownerHub.icon;
    for (const dest of ownerHub.items) expect(dest.icon && dest.icon !== parentIcon, dest.label).toBeTruthy();
  });

  it("🔴 설정 버튼끼리 그림이 겹치지 않는다 — 같은 '옮겨 오기' 그림을 쓰는 가져오기·연동만 예외", () => {
    const byIcon = new Map<string, string[]>();
    for (const dest of ownerHub.items) byIcon.set(dest.icon, [...(byIcon.get(dest.icon) ?? []), dest.label]);
    const shared = [...byIcon.entries()].filter(([, labels]) => labels.length > 1);
    expect(shared).toEqual([["sync", ["데이터 가져오기", "연동"]]]);
  });

  it("🔴 그림 표는 그림 가드가 읽는 모양(`icon: \"이름\"`)으로 적는다 — 맨 문자열로 적으면 가드가 이 표를 못 본다", () => {
    const src = readFileSync(join(process.cwd(), "src", "lib", "menu-hub.ts"), "utf8");
    const table = src.slice(src.indexOf("const OWNER_FACE_ICON"), src.indexOf("};", src.indexOf("const OWNER_FACE_ICON")));
    const rows = table.split(/\r?\n/).filter((line) => /^\s+\w+: /.test(line));
    expect(rows.length).toBe(OWNER_FACES.length);
    for (const row of rows) expect(row, row.trim()).toMatch(/^\s+\w+: \{ icon: (?:"\w+"|MENU_ICON\.\w+) \},$/);
    // 문자열로 직접 적은 그림은 그림 가드의 추출식에 걸린다.
    const literal = [...table.matchAll(/icon:\s*"(\w+)"/g)].map((m) => m[1]);
    expect(literal).toEqual(["tag", "gauge", "key", "sparkle", "eraser", "sync", "history", "sync"]);
  });

  it("🔴 메뉴 판에 면을 다시 적지 않는다 — 설정 묶음 안에 `/owner` 주소를 손으로 적은 줄이 없다", () => {
    const src = readFileSync(join(process.cwd(), "src", "lib", "menu-hub.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/face\("owner",\s*"\/owner/);
    expect(code).toContain("OWNER_FACES.map(");
  });

  it("🔴 옛 라벨('대시보드 구성')이 입구 코드에 남아 있지 않다", () => {
    // 면의 이름을 적는 곳은 면 목록 하나다 — 입구를 만드는 파일들에 옛 이름이 문자열로 남아 있지 않은지 본다(주석은 뺀다).
    const strip = (code: string) => code.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const rel of ["src/lib/menu-hub.ts", "src/lib/navigation.ts", "src/features/owner/tabs.ts", "src/app/(shell)/owner/page.tsx"]) {
      expect(strip(readFileSync(join(process.cwd(), rel), "utf8")), rel).not.toContain("대시보드 구성");
    }
  });
});

describe("메뉴 판에서 누구에게 어떤 버튼이 서나", () => {
  // 이 학원처럼 설정을 관리자에게 위임해 둔 권한 표.
  const delegated = resolveMatrix(
    (["owner", "profile_settings", "operations_settings", "billing_settings", "notification_settings", "consultation_settings", "navigation_settings", "integration_settings", "popup_settings"] as const).map(
      (menu) => ({ menu, role: "admin" as const, access: "full" as const }),
    ),
  );
  const hrefs = (gate: { systemRole: SystemRole; isMaster?: boolean; isGenericTenant?: boolean }) =>
    hubGroupsFor(SUPPORT_GROUPS, { permMatrix: delegated, ...gate })
      .find((g) => g.id === "owner")
      ?.items.map((d) => d.href) ?? [];

  it("원장(침산) — 일반판 전용 면만 빼고 전부 + 키오스크 설정", () => {
    expect(hrefs({ systemRole: "master", isMaster: true })).toEqual([...OWNER_TABS.map((t) => t.href), "/kiosk-settings"]);
  });

  it("원장(일반판) — '기능'까지 전부, 면 목록 순서 그대로", () => {
    expect(hrefs({ systemRole: "master", isMaster: true, isGenericTenant: true })).toEqual([...OWNER_FACES.map((f) => f.href), "/kiosk-settings"]);
  });

  it("키오스크 설정 버튼은 그 권한이 있는 사람에게만 선다 — 설정을 위임받았다고 서지 않는다", () => {
    expect(hrefs({ systemRole: "admin" })).not.toContain("/kiosk-settings");
    const granted = resolveMatrix([{ menu: "kiosk_settings", role: "admin", access: "full" }]);
    const seen = hubGroupsFor(SUPPORT_GROUPS, { systemRole: "admin", permMatrix: granted }).find((g) => g.id === "owner")?.items.map((d) => d.href);
    // 그 권한만 있어도 설정 묶음이 서고, 그 버튼 하나가 선다.
    expect(seen).toEqual(["/kiosk-settings"]);
  });

  it("🔴 위임받은 계정 — 원장 위 전용 면(감사로그 · 대시보드 관리 · 기능)의 버튼은 서지 않는다(눌러도 안내뿐인 입구)", () => {
    const seen = hrefs({ systemRole: "admin", isGenericTenant: true });
    for (const face of OWNER_FACES.filter((f) => f.masterOnly)) expect(seen, face.key).not.toContain(face.href);
    // 나머지 위임받은 면은 그대로 선다.
    expect(seen).toContain("/owner");
    expect(seen).toContain("/owner?tab=operations");
    expect(seen).toContain("/owner?tab=popups");
  });

  it("권한이 없는 역할에겐 설정 묶음 자체가 서지 않는다", () => {
    expect(MENU_ACCESS.owner.teacher).toBe("none");
    expect(hrefs({ systemRole: "teacher" })).toEqual([]);
  });
});

describe("배선 — 설정 화면의 탭도 같은 판정이다", () => {
  it("화면 탭은 면 목록에서, 메뉴 판과 같은 두 표식으로 거른다", () => {
    const page = readFileSync(join(process.cwd(), "src", "app", "(shell)", "owner", "page.tsx"), "utf8");
    expect(page).toContain(
      "return OWNER_FACES.filter((f) => (!f.masterOnly || canReadAudit) && (!f.genericOnly || showModules)",
    );
    // 면 목록·라벨을 화면 파일에 다시 적지 않는다.
    expect(page).not.toContain('label: "기능"');
    expect(page).not.toMatch(/MODULES_TAB_LABEL/);
  });
});
