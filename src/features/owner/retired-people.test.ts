import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveSettings } from "./resolve";
import { SPECIAL_ACCESS_ID_LISTS } from "./settings-types";
import { KEEP_WHEN_LAST, PERSON_FIELDS, removePersonFromStored, SPECIAL_ACCESS_LABEL, storedPersonIds, withoutRetiredPeople } from "./retired-people";

/**
 * 퇴사자 권한 정리(원장 2026-11-09 *"엄소윤 직원을 오늘자로 퇴사시켰는데도 여전히 권한에 배정된게 남아있네. 퇴사시 같이 사라지게"*).
 * 지키는 것: ① 그 사람이 있는 칸에서만 빼고 다른 사람·다른 칸·다른 섹션·모르는 키는 그대로(섹션 병합 #142) ② 없음이 뜻인 칸을 만들지 않는다
 * ③ 퇴원보고서 승인자는 비우지 않는다(비면 '지정 없음 = 과목 관리자 전원'으로 넓어진다) ④ 읽을 때도 같은 규칙으로 거른다.
 */
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // 퇴사하는 사람
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const stored = () => ({
  version: 1,
  preset: "chinsan",
  profile: { name: "합성 학원" },
  unknownTop: { keep: true },
  permissions: {
    rev: 4,
    overrides: [{ menu: "staff", role: "admin", access: "none" }],
    userOverrides: [{ userId: A, menu: "approvals", access: "full" }, { userId: B, menu: "approvals", access: "full" }],
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

describe("removePersonFromStored — 저장값에서 한 사람만 뺀다", () => {
  it("그 사람이 있는 칸만 바꾸고, 다른 사람·다른 칸·다른 섹션·모르는 키는 그대로", () => {
    const before = stored();
    const { data, removed, kept } = removePersonFromStored(before, A);
    const d = data as ReturnType<typeof stored>;
    expect(removed.sort()).toEqual(["dashboardAssignments", "leaveAdjusterIds", "payslipViewerIds", "staffSubjectScopes", "staffTaskMonitorIds", "userOverrides", "withdrawalDeskIds"].sort());
    expect(d.permissions.specialAccess.payslipViewerIds).toEqual([B]);
    expect(d.permissions.specialAccess.leaveAdjusterIds).toEqual([]);
    expect(d.permissions.specialAccess.classSplitterIds).toEqual([B]); // 그 사람이 없던 칸 — 손대지 않는다
    expect(d.permissions.specialAccess.staffTaskMonitorIds).toEqual([C]);
    expect(d.permissions.specialAccess.withdrawalDeskIds).toEqual([B]);
    expect(d.permissions.specialAccess.staffSubjectScopes).toEqual([{ userId: B, subjects: ["english"] }]);
    expect(d.permissions.userOverrides).toEqual([{ userId: B, menu: "approvals", access: "full" }]);
    expect(d.dashboard.assignments.map((r) => r.userId)).toEqual([B]);
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

  it("퇴원보고서 승인자에 다른 지정자가 있으면 그 사람만 뺀다", () => {
    const s = stored();
    s.permissions.specialAccess.withdrawalApproverIds = [A, B];
    const d = removePersonFromStored(s, A).data as ReturnType<typeof stored>;
    expect(d.permissions.specialAccess.withdrawalApproverIds).toEqual([B]);
  });

  it("🔴 없음이 뜻인 칸은 만들지 않는다 — 급여명세서 관리(없으면 열람자와 같다) · 원생 상태 변경(없으면 옛 방식)", () => {
    const d = removePersonFromStored(stored(), A).data as { permissions: { specialAccess: Record<string, unknown> } };
    expect(Object.hasOwn(d.permissions.specialAccess, "payslipManagerIds")).toBe(false);
    expect(Object.hasOwn(d.permissions.specialAccess, "studentStatusManagerIds")).toBe(false);
    // 있는 칸은 그 사람만 뺀 채로 남는다(키가 그대로 있어야 DB 가드 s2_0026이 '지정 방식'으로 본다).
    const s = stored() as ReturnType<typeof stored> & { permissions: { specialAccess: Record<string, unknown> } };
    s.permissions.specialAccess.studentStatusManagerIds = [A];
    const after = removePersonFromStored(s, A).data as { permissions: { specialAccess: Record<string, unknown> } };
    expect(after.permissions.specialAccess.studentStatusManagerIds).toEqual([]);
  });

  it("그 사람이 어디에도 없으면 아무것도 바꾸지 않는다(같은 객체 — 쓰지 않는다)", () => {
    const s = stored();
    const r = removePersonFromStored(s, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    expect(r.removed).toEqual([]);
    expect(r.data).toBe(s);
    expect(removePersonFromStored(null, A).removed).toEqual([]);
  });

  it("storedPersonIds = 사람 칸 전부의 사람(중복 없이)", () => {
    expect(storedPersonIds(stored()).sort()).toEqual([A, B, C].sort());
    expect(storedPersonIds(null)).toEqual([]);
  });
});

describe("withoutRetiredPeople — 읽을 때 거른다(판정 · 후보 · 화면 칩)", () => {
  const settings = () => resolveSettings(stored(), { name: "합성 학원" });

  it("개인별 기능 권한의 퇴사자를 뺀다 — 재직자·대기자는 그대로", () => {
    const out = withoutRetiredPeople(settings(), new Set([A]));
    const sa = out.permissions.specialAccess;
    expect(sa.payslipViewerIds).toEqual([B]);
    // 급여명세서 관리는 저장값에 없어 열람자를 따르는 칸 — 해석된 값에서도 퇴사자가 빠진다.
    expect(sa.payslipManagerIds).toEqual([B]);
    expect(sa.leaveAdjusterIds).toEqual([]);
    expect(sa.staffTaskMonitorIds).toEqual([C]);
    expect(sa.withdrawalDeskIds).toEqual([B]);
    expect(sa.staffSubjectScopes.map((r) => r.userId)).toEqual([B]);
    // 퇴원보고서 승인자가 모두 퇴사자면 그대로(지정 명단이 있는데 유효한 사람이 없음 → 작성 요청을 막는다).
    expect(sa.withdrawalApproverIds).toEqual([A]);
    // 개인별 메뉴 권한은 그대로(그 사람 자신의 메뉴 — 화면은 '(퇴사)'로 보여 거둔다).
    expect(out.permissions.userOverrides).toEqual(settings().permissions.userOverrides);
    // 옛 방식(원생 상태 변경 담당자 미지정)은 그대로 미지정.
    expect(sa.studentStatusManagerIds).toBeUndefined();
  });

  it("퇴사자가 없으면 같은 객체(비용 0)", () => {
    const s = settings();
    expect(withoutRetiredPeople(s, new Set())).toBe(s);
    expect(withoutRetiredPeople(s, new Set(["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"]))).toBe(s);
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
