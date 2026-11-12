import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveMatrix } from "@/lib/permissions";
import { resolveSettings } from "./resolve";
import { SPECIAL_ACCESS_ID_LISTS } from "./settings-types";
import { KEEP_WHEN_LAST, PERSON_FIELDS, removePersonFromStored, SPECIAL_ACCESS_LABEL, storedPersonIds, userOverrideGrants, withoutRetiredPeople } from "./retired-people";

/**
 * 퇴사자 권한 정리(원장 2026-11-09 *"엄소윤 직원을 오늘자로 퇴사시켰는데도 여전히 권한에 배정된게 남아있네. 퇴사시 같이 사라지게"*).
 * 지키는 것: ① 그 사람이 있는 칸에서만 빼고 다른 사람·다른 칸·다른 섹션·모르는 키는 그대로(섹션 병합 #142) ② 없음이 뜻인 칸을 만들지 않는다
 * ③ 퇴원보고서 승인자는 비우지 않는다(비면 '지정 없음 = 과목 관리자 전원'으로 넓어진다) ④ 읽을 때도 같은 규칙으로 거른다
 * ⑤ 🔴 **주는 값만** 지운다 — 좁히는 값(역할보다 낮은 개인 메뉴 줄 · 직원관리 과목 범위 · 대시보드 배정)은 남긴다(리뷰 r1 F1: 지우면 재입사로 제한이 풀린다).
 */
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // 퇴사하는 사람(관리자)
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const stored = () => ({
  version: 1,
  preset: "chinsan",
  profile: { name: "합성 학원" },
  unknownTop: { keep: true },
  permissions: {
    rev: 4,
    // 지점 역할 칸: 관리자의 직원관리 = 없음 · 관리자의 전자결재 = 전체.
    overrides: [{ menu: "staff", role: "admin", access: "none" }, { menu: "approvals", role: "admin", access: "full" }],
    userOverrides: [
      { userId: A, menu: "staff", access: "full" }, // 역할 칸 '없음'보다 더 준다 → 지운다
      { userId: A, menu: "approvals", access: "none" }, // 역할 칸 '전체'를 좁힌다 → 남긴다
      { userId: B, menu: "staff", access: "full" },
    ],
    specialAccess: {
      payslipViewerIds: [A, B],
      leaveAdjusterIds: [A],
      classSplitterIds: [B],
      staffTaskMonitorIds: [C, A],
      withdrawalDeskIds: [A, B],
      withdrawalApproverIds: [A],
      staffSubjectScopes: [{ userId: A, subjects: ["math"] }, { userId: B, subjects: ["english"] }],
      futureKey: [A],
    },
  },
  dashboard: { version: 2, layouts: [], assignments: [{ userId: A, scope: "all", subjects: [], adminLayout: "desk" }, { userId: B, scope: "all", subjects: [], adminLayout: "desk" }] },
});

describe("userOverrideGrants — 개인 메뉴 줄이 그 사람 역할보다 더 주는가(정리·읽기·편집기가 같은 판정)", () => {
  // 관리자 칸: 직원관리 없음 · 시간표 읽기 · 원생목록 담당 · 전자결재 전체. 열람 칸: 직원관리 없음.
  const matrix = resolveMatrix([
    { menu: "staff", role: "admin", access: "none" },
    { menu: "timetable", role: "admin", access: "readonly" },
    { menu: "students", role: "admin", access: "scoped" },
    { menu: "approvals", role: "admin", access: "full" },
    { menu: "staff", role: "viewer", access: "none" },
  ]);
  type Menu = "staff" | "timetable" | "students" | "approvals" | "assistant";
  type Acc = "full" | "scoped" | "readonly" | "none";
  const g = (menu: Menu, access: Acc, role: "admin" | "viewer" | "teacher" | null = "admin") => userOverrideGrants({ menu, access }, role, matrix);

  it("더 주는 줄 = 전체(역할 칸이 전체가 아닐 때) · 역할 칸 '없음'인데 무언가를 연 줄", () => {
    expect(g("staff", "full")).toBe(true);
    expect(g("staff", "readonly")).toBe(true);
    expect(g("staff", "scoped")).toBe(true);
    expect(g("timetable", "full")).toBe(true);
    expect(g("students", "full")).toBe(true);
  });

  it("남기는 줄 = 같은 값 · 낮은 값 · 견줄 수 없는 값(읽기 ↔ 담당) · 없음", () => {
    expect(g("approvals", "full")).toBe(false); // 같음
    expect(g("timetable", "readonly")).toBe(false); // 같음
    expect(g("approvals", "readonly")).toBe(false); // 좁힘
    expect(g("approvals", "none")).toBe(false);
    expect(g("timetable", "scoped")).toBe(false); // 읽기 ↔ 담당
    expect(g("students", "readonly")).toBe(false); // 담당 ↔ 읽기
  });

  it("역할을 모름 · 적용되지 않는 줄(잠긴 칸) · 금지 '담당'을 내린 값이 '없음'이면 남긴다(닫힌 쪽)", () => {
    expect(g("staff", "full", null)).toBe(false);
    expect(g("assistant", "full", "teacher")).toBe(false); // 강사 칸 고정 — 적용되지 않는 줄
    expect(g("staff", "scoped", "viewer")).toBe(false); // 열람의 '담당'은 역할 칸 '없음'으로 내린다 → 없음
  });
});

describe("removePersonFromStored — 저장값에서 한 사람의 주는 값만 뺀다", () => {
  it("그 사람이 있는 주는 칸만 바꾸고, 좁히는 값 · 다른 사람 · 다른 칸 · 다른 섹션 · 모르는 키는 그대로", () => {
    const before = stored();
    const { data, removed, kept } = removePersonFromStored(before, A, "admin");
    const d = data as ReturnType<typeof stored>;
    expect(removed.sort()).toEqual(["leaveAdjusterIds", "payslipViewerIds", "staffTaskMonitorIds", "userOverrides", "withdrawalDeskIds"].sort());
    expect(d.permissions.specialAccess.payslipViewerIds).toEqual([B]);
    expect(d.permissions.specialAccess.leaveAdjusterIds).toEqual([]);
    expect(d.permissions.specialAccess.classSplitterIds).toEqual([B]); // 그 사람이 없던 칸 — 손대지 않는다
    expect(d.permissions.specialAccess.staffTaskMonitorIds).toEqual([C]);
    expect(d.permissions.specialAccess.withdrawalDeskIds).toEqual([B]);
    // 🔴 주는 개인 줄만 빠지고 좁히는 개인 줄은 남는다.
    expect(d.permissions.userOverrides).toEqual([{ userId: A, menu: "approvals", access: "none" }, { userId: B, menu: "staff", access: "full" }]);
    // 🔴 좁히는 값(직원관리 과목 범위 · 대시보드 배정)은 그대로 — 지우면 재입사 뒤 전 과목·전체로 넓어진다.
    expect(d.permissions.specialAccess.staffSubjectScopes).toEqual(before.permissions.specialAccess.staffSubjectScopes);
    expect(d.dashboard).toBe(before.dashboard);
    // 역할 칸 · 섹션의 다른 키 · 다른 섹션 · 이 코드가 모르는 키는 그대로.
    expect(d.permissions.overrides).toEqual(before.permissions.overrides);
    expect(d.permissions.rev).toBe(4); // 순번은 쓰는 쪽(서버)이 올린다
    expect(d.profile).toEqual(before.profile);
    expect(d.unknownTop).toEqual(before.unknownTop);
    expect(d.permissions.specialAccess.futureKey).toEqual([A]); // 모르는 칸은 건드리지 않는다(가드: 아래 '칸 전수')
    // 🔴 퇴원보고서 승인자가 그 사람뿐이면 남긴다(비우면 '지정 없음'으로 넓어진다).
    expect(d.permissions.specialAccess.withdrawalApproverIds).toEqual([A]);
    expect(kept).toEqual(["withdrawalApproverIds"]);
    // 입력은 바꾸지 않는다.
    expect(before).toEqual(stored());
  });

  it("역할을 모르면 개인 메뉴 줄은 하나도 지우지 않는다(견줄 기준이 없다 — 닫힌 쪽)", () => {
    const { data, removed } = removePersonFromStored(stored(), A, null);
    expect(removed).not.toContain("userOverrides");
    expect((data as ReturnType<typeof stored>).permissions.userOverrides).toEqual(stored().permissions.userOverrides);
  });

  it("퇴원보고서 승인자에 다른 지정자가 있으면 그 사람만 뺀다", () => {
    const s = stored();
    s.permissions.specialAccess.withdrawalApproverIds = [A, B];
    const d = removePersonFromStored(s, A, "admin").data as ReturnType<typeof stored>;
    expect(d.permissions.specialAccess.withdrawalApproverIds).toEqual([B]);
  });

  it("🔴 없음이 뜻인 칸은 만들지 않는다 — 급여명세서 관리(없으면 열람자와 같다) · 원생 상태 변경(없으면 옛 방식)", () => {
    const d = removePersonFromStored(stored(), A, "admin").data as { permissions: { specialAccess: Record<string, unknown> } };
    expect(Object.hasOwn(d.permissions.specialAccess, "payslipManagerIds")).toBe(false);
    expect(Object.hasOwn(d.permissions.specialAccess, "studentStatusManagerIds")).toBe(false);
    // 있는 칸은 그 사람만 뺀 채로 남는다(키가 그대로 있어야 DB 가드 s2_0026이 '지정 방식'으로 본다).
    const s = stored() as ReturnType<typeof stored> & { permissions: { specialAccess: Record<string, unknown> } };
    s.permissions.specialAccess.studentStatusManagerIds = [A];
    const after = removePersonFromStored(s, A, "admin").data as { permissions: { specialAccess: Record<string, unknown> } };
    expect(after.permissions.specialAccess.studentStatusManagerIds).toEqual([]);
  });

  it("그 사람의 주는 값이 없으면 아무것도 바꾸지 않는다(같은 객체 — 쓰지 않는다)", () => {
    const s = stored();
    const r = removePersonFromStored(s, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "admin");
    expect(r.removed).toEqual([]);
    expect(r.data).toBe(s);
    expect(removePersonFromStored(null, A, "admin").removed).toEqual([]);
    // 좁히는 값만 있는 사람 — 과목 범위 · 대시보드 배정 · 낮은 개인 줄뿐이면 쓰지 않는다.
    const only = {
      permissions: { overrides: [], userOverrides: [{ userId: C, menu: "approvals", access: "none" }], specialAccess: { staffSubjectScopes: [{ userId: C, subjects: ["math"] }] } },
      dashboard: { assignments: [{ userId: C }] },
    };
    const r2 = removePersonFromStored(only, C, "admin");
    expect(r2.removed).toEqual([]);
    expect(r2.data).toBe(only);
  });

  it("storedPersonIds = 사람 칸 전부의 사람(중복 없이)", () => {
    expect(storedPersonIds(stored()).sort()).toEqual([A, B, C].sort());
    expect(storedPersonIds(null)).toEqual([]);
  });
});

describe("withoutRetiredPeople — 읽을 때 퇴사자의 주는 값을 거른다(판정 · 후보 · 화면 초기값)", () => {
  const settings = () => resolveSettings(stored(), { name: "합성 학원" });

  it("개인별 기능 권한 · 더 주는 개인 메뉴 줄의 퇴사자를 뺀다 — 재직자 · 좁히는 값은 그대로", () => {
    const out = withoutRetiredPeople(settings(), new Map([[A, "admin" as const]]));
    const sa = out.permissions.specialAccess;
    expect(sa.payslipViewerIds).toEqual([B]);
    // 급여명세서 관리는 저장값에 없어 열람자를 따르는 칸 — 해석된 값에서도 퇴사자가 빠진다.
    expect(sa.payslipManagerIds).toEqual([B]);
    expect(sa.leaveAdjusterIds).toEqual([]);
    expect(sa.staffTaskMonitorIds).toEqual([C]);
    expect(sa.withdrawalDeskIds).toEqual([B]);
    // 🔴 좁히는 값(직원관리 과목 범위)은 거르지 않는다 — 숨기면 면을 저장할 때 제한이 사라진다.
    expect(sa.staffSubjectScopes.map((r) => r.userId)).toEqual([A, B]);
    // 퇴원보고서 승인자가 모두 퇴사자면 그대로(지정 명단이 있는데 유효한 사람이 없음 → 작성 요청을 막는다).
    expect(sa.withdrawalApproverIds).toEqual([A]);
    // 🔴 개인별 메뉴 권한: 역할보다 더 주는 줄만 빠지고, 좁히는 줄은 남는다(화면엔 '(퇴사)').
    expect(out.permissions.userOverrides).toEqual(settings().permissions.userOverrides.filter((r) => !(r.userId === A && r.menu === "staff")));
    expect(out.permissions.userOverrides.some((r) => r.userId === A && r.menu === "approvals")).toBe(true);
    // 옛 방식(원생 상태 변경 담당자 미지정)은 그대로 미지정.
    expect(sa.studentStatusManagerIds).toBeUndefined();
  });

  it("역할을 모르는 퇴사자 — 명단 칸은 거르고 개인 메뉴 줄은 남긴다", () => {
    const out = withoutRetiredPeople(settings(), new Map([[A, null]]));
    expect(out.permissions.specialAccess.payslipViewerIds).toEqual([B]);
    expect(out.permissions.userOverrides).toEqual(settings().permissions.userOverrides);
  });

  it("퇴사자가 없거나 저장값에 없는 사람뿐이면 같은 객체(비용 0)", () => {
    const s = settings();
    expect(withoutRetiredPeople(s, new Map())).toBe(s);
    expect(withoutRetiredPeople(s, new Map([["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "admin" as const]]))).toBe(s);
  });
});

describe("🔴 사람 칸 전수 — 스키마의 사람 칸이 늘면 이 규칙에도 들어와야 한다", () => {
  it("개인별 기능 권한의 사람 칸 전부에 이름이 있고, 정리 대상 목록에 든다", () => {
    for (const key of SPECIAL_ACCESS_ID_LISTS) {
      expect(SPECIAL_ACCESS_LABEL[key], key).toBeTruthy();
      expect(PERSON_FIELDS.some((f) => f.key === key), key).toBe(true);
    }
    expect([...KEEP_WHEN_LAST]).toEqual(["withdrawalApproverIds"]);
  });

  it("학원 설정 스키마에서 사람 id(uuid)를 담는 칸 = 이 규칙이 아는 칸뿐이다", () => {
    const src = readFileSync(join(process.cwd(), "src/features/owner/settings-types.ts"), "utf8");
    // 사람 칸 = `<이름>Ids: z.array(z.string().uuid())` · `userId: z.string().uuid()`(줄 모양 — 과목 범위 · 개인별 메뉴 권한 · 대시보드 배정).
    const idLists = [...src.matchAll(/(\w+Ids):\s*z\.array\(z\.string\(\)\.uuid\(\)\)/g)].map((m) => m[1]!).filter((k) => k !== "disabledClassIds");
    expect(idLists.sort()).toEqual([...SPECIAL_ACCESS_ID_LISTS].sort());
    expect([...src.matchAll(/userId:\s*z\.string\(\)\.uuid\(\)/g)].length).toBe(3);
  });
});
