import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import {
  clampTableScale,
  DEFAULT_STAFF_LIST_PREFS,
  mergeStaffView,
  parseStaffListPrefs,
  parseStaffRole,
  parseStaffSort,
  parseStaffStatus,
  pickStaffFilterPrefs,
  pickStaffViewPrefs,
  STAFF_ROLE_OPTIONS,
  type StaffViewPrefs,
} from "./list-prefs";

const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const PAGE = "app/(shell)/staff/page.tsx";
const PROVIDER = "app/(shell)/staff/_components/staff-view-prefs.tsx";
const QUEUE = "app/(shell)/staff/_components/staff-prefs-queue.ts";

const view = (p: Partial<StaffViewPrefs>): StaffViewPrefs => ({ columnOrder: [], columnHidden: [], tableScale: 100, rev: 0, ...p });

describe("직원목록 보기 설정(users.ui_prefs.staff)", () => {
  it("깨진 값·모르는 키는 기본값으로 접는다", () => {
    expect(parseStaffListPrefs(undefined)).toEqual(DEFAULT_STAFF_LIST_PREFS);
    expect(parseStaffListPrefs(null)).toEqual(DEFAULT_STAFF_LIST_PREFS);
    expect(
      parseStaffListPrefs({ role: "owner", emp: "x", sort: "zzz", per: 7, columnOrder: "name", columnHidden: 3, tableScale: "big", rev: "x", status: "all" }),
    ).toEqual(DEFAULT_STAFF_LIST_PREFS);
  });

  it("저장된 값은 그대로 살린다(상태·검색어는 애초에 키가 없다)", () => {
    const p = parseStaffListPrefs({
      role: "teacher",
      subject: "math",
      emp: "정규직",
      sort: "hire",
      columnHidden: ["email", "nope"],
      tableScale: 120,
      rev: 7,
    });
    expect(p).toMatchObject({ role: "teacher", subject: "math", emp: "정규직", sort: "hire", columnHidden: ["email"], tableScale: 120, rev: 7 });
    expect("status" in p).toBe(false);
  });

  it("두 조각(필터 4축 · 표 보기 3키+rev)은 키가 겹치지 않고 합치면 전체다", () => {
    const p = parseStaffListPrefs({ role: "admin", tableScale: 130, columnHidden: ["phone"], rev: 3 });
    const f = pickStaffFilterPrefs(p);
    const v = pickStaffViewPrefs(p);
    expect(Object.keys(f)).toEqual(["role", "subject", "emp", "sort"]);
    expect(Object.keys(v)).toEqual(["columnOrder", "columnHidden", "tableScale", "rev"]);
    expect({ ...f, ...v }).toEqual(p);
    // RememberPrefs는 JSON 문자열로 같음을 판정한다 — 같은 값이면 키 순서까지 같아야 한다.
    expect(JSON.stringify(pickStaffFilterPrefs(parseStaffListPrefs(f)))).toBe(JSON.stringify(f));
  });

  it("역할 라벨은 ROLE_LABEL 단일 소스(표의 역할 알약과 같은 글자)", () => {
    for (const o of STAFF_ROLE_OPTIONS) expect(o.label).toBe(ROLE_LABEL[o.value as keyof typeof ROLE_LABEL]);
    expect(STAFF_ROLE_OPTIONS.some((o) => o.value === "counselor")).toBe(true);
  });

  it("역할·상태·정렬은 허용 목록 밖이면 기본값(상태 기본 = 재직)", () => {
    expect(parseStaffRole("admin")).toBe("admin");
    expect(parseStaffRole("owner")).toBe("all");
    expect(parseStaffStatus(undefined)).toBe("active");
    expect(parseStaffStatus("all")).toBe("all");
    expect(parseStaffStatus("fired")).toBe("active");
    expect(parseStaffSort("dept")).toBe("dept");
    expect(parseStaffSort("x")).toBe("role");
  });

  it("표 글자 크기는 90~150, 10 단위 — 90%는 14.4px로 v5 바닥(14) 위", () => {
    expect(clampTableScale(85)).toBe(90);
    expect(clampTableScale(123)).toBe(120);
    expect(clampTableScale(999)).toBe(150);
    expect(clampTableScale("x")).toBe(100);
    expect((16 * 90) / 100).toBeGreaterThanOrEqual(14);
  });
});

describe("표 보기 저장 = 이 창이 바꾼 차이만 저장값 위에(다른 창·PC 값 보존)", () => {
  it("다른 창이 숨긴 열은 남고, 이 창이 새로 숨긴 열이 더해진다", () => {
    const stored = view({ columnHidden: ["email"] }); // 다른 창(PC)이 그 사이 숨김
    const base = view({ columnHidden: [] }); // 이 창이 알던 값
    expect(mergeStaffView(stored, base, { columnHidden: ["phone"] })).toEqual({ columnHidden: ["email", "phone"] });
  });
  it("이 창이 다시 켠 열은 저장값에서도 빠진다 · 같은 열을 두 창이 숨겨도 한 번만", () => {
    expect(mergeStaffView(view({ columnHidden: ["email", "phone"] }), view({ columnHidden: ["email"] }), { columnHidden: [] })).toEqual({
      columnHidden: ["phone"],
    });
    expect(mergeStaffView(view({ columnHidden: ["email"] }), view({ columnHidden: [] }), { columnHidden: ["email"] })).toEqual({ columnHidden: ["email"] });
  });
  it("순서는 이 창이 안 건드렸으면 저장값 유지, 건드렸으면 이 창 순서 · 글자 크기는 마지막 저장", () => {
    const stored = view({ columnOrder: ["name", "department"] });
    expect(mergeStaffView(stored, view({ columnOrder: [] }), { columnOrder: [], columnHidden: [] })).toEqual({ columnHidden: [] });
    expect(mergeStaffView(stored, view({ columnOrder: [] }), { columnOrder: ["email", "name"] })).toEqual({ columnOrder: ["email", "name"] });
    expect(mergeStaffView(view({ tableScale: 120 }), view({ tableScale: 100 }), { tableScale: 110 })).toEqual({ tableScale: 110 });
  });
});

describe("직원목록 배선", () => {
  const page = read(PAGE);

  it("필터는 라벨 드롭다운(FilterSelect) 한 줄 — 옛 세그먼트 칩 묶음이 없다 · 1회성 초대 배너는 필터·검색에 안 따라온다", () => {
    expect(page).toContain("<FilterSelect");
    expect(page).not.toContain("TOOLBAR_SEG_ITEM");
    expect(page).not.toContain("buildStaffHref");
    expect(page.match(/clearParams=\{INVITE_PARAMS\}/g)?.length).toBe(5); // 역할·상태·과목·계약구분·정렬(표시 수는 창이 정한다)
    expect(page).toContain("resetParams={INVITE_PARAMS}");
  });

  it("필터 4축은 RememberPrefs(단일 큐)로, 표 보기 3키는 Provider 서버 시드 — 전체 객체를 RememberPrefs에 싣지 않는다", () => {
    expect(page).toContain("loadStaffListPrefs()");
    expect(page).toContain("<StaffRememberPrefs current={current} saved={savedFilters}");
    expect(page).toContain("pickStaffFilterPrefs(");
    expect(page).toContain("<StaffViewPrefsProvider initial={pickStaffViewPrefs(prefs)}");
    expect(page).not.toContain("saveStaffListPrefs");
    expect(page).not.toContain("StaffViewPrefSync");
    // 저장은 이 문서의 단일 큐 하나로 — 컨트롤이 서버 액션을 직접 부르지 않는다(연속 클릭 읽고-쓰기 경합).
    const provider = read(PROVIDER);
    expect(provider).toContain("save={queueStaffPrefsSave}");
    expect(provider).toContain("commit({ columnOrder, columnHidden })");
    expect(provider).toContain("commit({ tableScale: clampTableScale(next) })");
    // 열·글자는 base와 함께 보내 서버가 차이만 얹고, 돌아온 병합값으로 화면을 맞춘다.
    expect(provider).toContain("queueStaffPrefsSave(patch, base)");
    expect(provider).toContain("setViewState(r.view)");
    expect(read("features/staff/list/server/list-prefs.ts")).toContain("mergeStaffView(");
    expect(read(QUEUE)).toContain("saveStaffListPrefs(next, base)");
    for (const f of ["staff-column-picker.tsx", "table-scale.tsx", "staff-table.tsx"]) {
      const src = read(`app/(shell)/staff/_components/${f}`);
      expect(src, f).toContain("useStaffViewPrefs()");
      expect(src, f).not.toContain("saveStaffListPrefs");
      expect(src, f).not.toContain("usePrefs");
    }
  });

  it("URL 축은 원값을 잇고(쪽 넘김) 선택지 밖 값은 저장하지 않는다 · 독립 조회는 Promise.all 하나(B4)", () => {
    expect(page).toContain('params.set("sort", sp.sort)');
    expect(page).toContain('params.set("size", String(size))');
    expect(page).toContain("<AutoPageSize");
    expect(page).toContain("subject === sp.subject ? subjectRaw : prefs.subject");
    expect(page.match(/await Promise\.all\(/g)?.length).toBe(1);
    // 계정 조회는 강사뷰 대상 확인 한 번뿐(a380f9347 — 연차·급여 버튼의 신원) · requireAccess가 이미 부른 캐시라 왕복이 늘지 않는다.
    expect(page.match(/getCurrentUser\(/g)?.length ?? 0).toBeLessThanOrEqual(1);
    if (page.includes("getCurrentUser(")) expect(page).toContain("getCurrentUser({ teacherView: true })");
  });

  it("표 보기 3키는 zustand persist(localStorage)에 없다 — SSR과 첫 클라 렌더가 갈리지 않게(#75 계열)", () => {
    const store = read("components/workspace/use-prefs.ts");
    expect(store).not.toMatch(/staffTableScale\s*:/);
    expect(store).not.toMatch(/staffColumnOrder\s*:/);
    expect(store).not.toContain('from "@/features/staff/list/list-prefs"');
    expect(existsSync(join(ROOT, "app/(shell)/staff/_components/staff-view-pref-sync.tsx"))).toBe(false);
    expect(read("features/staff/list/list-prefs.ts")).not.toContain("StaffViewPrefSync");
    // Provider는 서버 시드를 useState 초기값으로 — effect 주입(플래시·되돌림)이 아니다. 뒤로 가기 보정은 rev 세대 비교.
    expect(read(PROVIDER)).toContain("useState<StaffViewPrefs>(() => seedStaffView(initial))");
    expect(read(QUEUE)).toContain("lastPicked.rev >= initial.rev");
  });

  it("공용 헬퍼는 지시어 없는 모듈, 저장은 use server 모듈(#81)", () => {
    const src = read("features/staff/list/list-prefs.ts");
    expect(src.trimStart().startsWith('"use client"')).toBe(false);
    expect(src).not.toMatch(/^import "server-only"/m);
    expect(read("features/staff/list/server/list-prefs.ts").trimStart().startsWith('"use server"')).toBe(true);
    expect(read(QUEUE).trimStart().startsWith('"use')).toBe(false);
    expect(read(PROVIDER).trimStart().startsWith('"use client"')).toBe(true);
  });

  it("상시 버튼은 Primary('직원 등록') + 텍스트('등록 QR') — 설명 문장 없음 · 열 제목은 전부 가운데", () => {
    expect(page).toContain("<NewStaffTrigger");
    expect(page).toContain("<StaffQrSection");
    expect(page).not.toContain("직원 계정·역할과 담당 현황을 관리합니다");
    expect(read("app/(shell)/staff/_components/staff-qr-panel.tsx")).toMatch(/variant="ghost"[^>]*onClick=\{toggle\}/);
    const table = read("app/(shell)/staff/_components/staff-table.tsx");
    expect(table).toContain("<th key={k} className={`${CELL} font-bold`}>");
  });

  it("표 글자 기본은 16px(v5 본문) — 옛 13px 기준이 아니다", () => {
    expect(read("app/(shell)/staff/_components/table-scale.tsx")).toContain("const BASE_PX = 16;");
  });
});
