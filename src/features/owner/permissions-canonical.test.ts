import { describe, expect, it } from "vitest";
import { MENU_ACCESS, resolveMatrix } from "@/lib/permissions";
import { ambiguousRoleCells, hasDuplicateRoleCells, permissionsCanonical } from "./permissions-canonical";
import type { PermissionsSettings } from "./settings-types";

/**
 * 역할·권한의 표준 문자열(2026-10-06) — 저장할 때 "화면을 연 뒤 다른 곳이 바꿨나"를 가리는 기준의 재료.
 * **저장된 줄을 그대로** 견준다(차례만 무시). "적용하면 같은 표"는 같다고 치지 않는다 — 같은 저장값을 앱과 DB가 다르게
 * 읽는 자리가 있어서다(적대 리뷰 2 C1). 합성 값만 쓴다.
 */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const base = (patch: Partial<PermissionsSettings> = {}): PermissionsSettings => ({
  overrides: [
    { menu: "staff", role: "teacher", access: "readonly" },
    { menu: "billing", role: "manager", access: "full" },
  ],
  userOverrides: [
    { userId: A, menu: "staff", access: "full" },
    { userId: B, menu: "billing", access: "readonly" },
  ],
  specialAccess: { payslipViewerIds: [A, B], leaveAdjusterIds: [B], classSplitterIds: [], staffSubjectScopes: [] },
  ...patch,
});
/** 스키마를 거치지 않은 저장값(손으로 넣은 값·스크립트)을 그대로 넘긴다. */
const raw = (value: unknown) => value as PermissionsSettings;

describe("같은 저장값이면 같다 — 차례만 무시한다", () => {
  it("서로 다른 칸의 줄 차례 · 사람 차례 · 담당자 차례 · 객체 키 차례(jsonb가 바꿔 돌려준다)", () => {
    const shuffled: PermissionsSettings = {
      specialAccess: { leaveAdjusterIds: [B], payslipViewerIds: [B, A], classSplitterIds: [], staffSubjectScopes: [] },
      userOverrides: [
        { access: "readonly", menu: "billing", userId: B },
        { userId: A, menu: "staff", access: "full" },
      ],
      overrides: [
        { access: "full", role: "manager", menu: "billing" },
        { access: "readonly", role: "teacher", menu: "staff" },
      ],
    };
    expect(permissionsCanonical(shuffled)).toBe(permissionsCanonical(base()));
  });

  it("입력을 바꾸지 않는다(정렬은 사본에서 한다)", () => {
    const value = base({ specialAccess: { payslipViewerIds: [B, A], leaveAdjusterIds: [B], classSplitterIds: [], staffSubjectScopes: [] } });
    const copy = structuredClone(value);
    permissionsCanonical(value);
    expect(value).toEqual(copy);
  });
});

describe("🔴 적용하면 같은 표여도 저장된 줄이 다르면 다르다 — 앱과 DB가 그 줄을 다르게 읽는다", () => {
  const before = permissionsCanonical(base());

  it("같은 칸이 두 줄 — 앱은 마지막 줄을 쓰지만(표는 그대로) DB는 먼저 걸리는 줄을 쓴다", () => {
    const duplicated = base({
      overrides: [...base().overrides, { menu: "billing", role: "admin", access: "none" }, { menu: "billing", role: "admin", access: MENU_ACCESS.billing.admin }],
    });
    // 앱이 보는 표는 같다…
    expect(resolveMatrix(duplicated.overrides)).toEqual(resolveMatrix(base().overrides));
    // …그래도 다른 저장값이다(표로 접어 견주면 이 저장을 놓친다).
    expect(permissionsCanonical(duplicated)).not.toBe(before);
  });

  it("같은 칸 두 줄의 **차례**도 뜻이 있다 — 뒤바뀌면 다른 저장값이다", () => {
    const rows = (first: "none" | "full", second: "none" | "full") =>
      base({ overrides: [{ menu: "billing", role: "admin", access: first }, { menu: "staff", role: "teacher", access: "readonly" }, { menu: "billing", role: "admin", access: second }] });
    expect(permissionsCanonical(rows("none", "full"))).not.toBe(permissionsCanonical(rows("full", "none")));
    // 사이에 낀 다른 칸의 줄은 차례에 영향이 없다.
    const reordered = base({ overrides: [{ menu: "staff", role: "teacher", access: "readonly" }, { menu: "billing", role: "admin", access: "none" }, { menu: "billing", role: "admin", access: "full" }] });
    expect(permissionsCanonical(reordered)).toBe(permissionsCanonical(rows("none", "full")));
  });

  it("기본값과 같은 줄 — 있고 없음이 다르다(DB의 기본값 표에 없는 메뉴는 줄이 없으면 '없음'이다)", () => {
    const explicit = base({ overrides: [...base().overrides, { menu: "staff", role: "master", access: MENU_ACCESS.staff.master }] });
    expect(resolveMatrix(explicit.overrides)).toEqual(resolveMatrix(base().overrides));
    expect(permissionsCanonical(explicit)).not.toBe(before);
  });

  it("앱이 적용하지 않는 줄(잠긴 칸)도 저장값의 일부다", () => {
    const locked = base({ overrides: [...base().overrides, { menu: "staff", role: "student", access: "full" }] });
    expect(resolveMatrix(locked.overrides)).toEqual(resolveMatrix(base().overrides));
    expect(permissionsCanonical(locked)).not.toBe(before);
  });

  it("개인별 예외의 같은 칸(사람·메뉴) 두 줄도 차례를 지킨다", () => {
    const rows = (first: "none" | "full", second: "none" | "full") =>
      base({ userOverrides: [{ userId: A, menu: "staff", access: first }, { userId: A, menu: "staff", access: second }] });
    expect(permissionsCanonical(rows("none", "full"))).not.toBe(permissionsCanonical(rows("full", "none")));
  });
});

describe("🔴 저장되는 세 칸 중 무엇이든 달라지면 다르다", () => {
  const before = permissionsCanonical(base());

  it("역할별 권한 한 칸", () => {
    expect(permissionsCanonical(base({ overrides: [{ menu: "staff", role: "teacher", access: "full" }, base().overrides[1]!] }))).not.toBe(before);
    expect(permissionsCanonical(base({ overrides: [] }))).not.toBe(before);
  });

  it("개인별 예외 — 추가 · 삭제 · 수준 변경", () => {
    expect(permissionsCanonical(base({ userOverrides: [...base().userOverrides, { userId: A, menu: "billing", access: "full" }] }))).not.toBe(before);
    expect(permissionsCanonical(base({ userOverrides: base().userOverrides.slice(0, 1) }))).not.toBe(before);
    expect(permissionsCanonical(base({ userOverrides: [{ userId: A, menu: "staff", access: "readonly" }, base().userOverrides[1]!] }))).not.toBe(before);
  });

  it("담당자 명단 — 두 명단은 서로 다른 칸이다(같은 사람이 옮겨 가도 다르다)", () => {
    expect(permissionsCanonical(base({ specialAccess: { payslipViewerIds: [A], leaveAdjusterIds: [B], classSplitterIds: [], staffSubjectScopes: [] } }))).not.toBe(before);
    expect(permissionsCanonical(base({ specialAccess: { payslipViewerIds: [A, B], leaveAdjusterIds: [], classSplitterIds: [], staffSubjectScopes: [] } }))).not.toBe(before);
    expect(permissionsCanonical(base({ specialAccess: { payslipViewerIds: [B], leaveAdjusterIds: [A, B], classSplitterIds: [], staffSubjectScopes: [] } }))).not.toBe(
      permissionsCanonical(base({ specialAccess: { payslipViewerIds: [A, B], leaveAdjusterIds: [B], classSplitterIds: [], staffSubjectScopes: [] } })),
    );
  });

  it("수업 나누기 · 직원관리 과목 범위도 기준에 든다 — 빠지면 그 칸의 다른 저장이 조용히 되돌아간다", () => {
    const special = base().specialAccess;
    expect(permissionsCanonical(base({ specialAccess: { ...special, classSplitterIds: [A] } }))).not.toBe(before);
    const scoped = permissionsCanonical(base({ specialAccess: { ...special, staffSubjectScopes: [{ userId: A, subjects: ["math"] }] } }));
    expect(scoped).not.toBe(before);
    // 같은 사람의 과목만 바뀌어도 다른 저장이다.
    expect(permissionsCanonical(base({ specialAccess: { ...special, staffSubjectScopes: [{ userId: A, subjects: ["english"] }] } }))).not.toBe(scoped);
    // 줄의 차례는 뜻이 없다.
    const two = [{ userId: A, subjects: ["math"] }, { userId: B, subjects: ["english"] }];
    expect(permissionsCanonical(base({ specialAccess: { ...special, staffSubjectScopes: two } }))).toBe(
      permissionsCanonical(base({ specialAccess: { ...special, staffSubjectScopes: [...two].reverse() } })),
    );
  });
});

describe("깨진 저장값(스키마를 거치지 않고 읽힌다)에도 던지지 않는다", () => {
  it("줄이 null · 숫자 · 배열이어도 문자열을 만든다 — 그 줄을 없는 셈 치지 않는다(없는 것과 같은 값이 되면 조용히 덮는다)", () => {
    const clean = permissionsCanonical(base());
    for (const junk of [null, 7, ["staff"], "x", {}]) {
      const broken = raw({ ...base(), overrides: [...base().overrides, junk] });
      expect(() => permissionsCanonical(broken)).not.toThrow();
      expect(permissionsCanonical(broken)).not.toBe(clean);
      const brokenPeople = raw({ ...base(), userOverrides: [...base().userOverrides, junk] });
      expect(() => permissionsCanonical(brokenPeople)).not.toThrow();
      expect(permissionsCanonical(brokenPeople)).not.toBe(clean);
    }
  });

  it("칸 자체가 배열이 아니거나 없어도 던지지 않는다", () => {
    for (const value of [{}, { overrides: "x", userOverrides: null, specialAccess: null }, { overrides: [], specialAccess: { payslipViewerIds: "x" } }]) {
      expect(() => permissionsCanonical(raw(value))).not.toThrow();
    }
    expect(() => permissionsCanonical(raw(null))).not.toThrow();
  });
});

describe("같은 칸이 서로 다른 값으로 저장된 칸(화면에 알린다)", () => {
  it("값이 갈린 칸만 고른다 — 같은 값이 두 번인 칸 · 한 줄뿐인 칸은 아니다", () => {
    expect(
      ambiguousRoleCells([
        { menu: "billing", role: "admin", access: "none" },
        { menu: "staff", role: "teacher", access: "readonly" },
        { menu: "billing", role: "admin", access: "full" },
        { menu: "staff", role: "manager", access: "full" },
        { menu: "staff", role: "manager", access: "full" },
      ]),
    ).toEqual([{ menu: "billing", role: "admin" }]);
    expect(ambiguousRoleCells(base().overrides)).toEqual([]);
  });

  it("모르는 메뉴·깨진 줄 · 배열이 아닌 값에는 던지지 않고 고르지도 않는다(이름을 붙일 수 없다)", () => {
    expect(ambiguousRoleCells([null, 3, { menu: "없는메뉴", role: "admin", access: "none" }, { menu: "없는메뉴", role: "admin", access: "full" }])).toEqual([]);
    expect(ambiguousRoleCells(undefined)).toEqual([]);
    expect(ambiguousRoleCells("x")).toEqual([]);
  });
});

describe("요청이 같은 칸을 두 번 지정했는가(저장 액션이 거절한다)", () => {
  it("값이 같든 다르든 같은 칸이 두 번이면 그렇다", () => {
    expect(hasDuplicateRoleCells([{ menu: "billing", role: "admin" }, { menu: "billing", role: "admin" }])).toBe(true);
    expect(hasDuplicateRoleCells([{ menu: "billing", role: "admin" }, { menu: "billing", role: "manager" }, { menu: "staff", role: "admin" }])).toBe(false);
    expect(hasDuplicateRoleCells([])).toBe(false);
  });
});
