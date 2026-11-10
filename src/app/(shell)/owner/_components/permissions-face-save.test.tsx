import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 역할·권한 면이 **기준 token과 함께 저장하고, 서버 값과 작성 중 값을 한 묶음으로 다루는지**(2026-10-06) — 실제 섹션 폼으로 그린다.
 *  · 전에는 표가 화면을 연 때의 값에 머물렀다. 머리글의 '역할 설정' 대화상자로 직급을 바꾸면 화면은 새로 읽혔지만 표는 옛 값이라,
 *    다음 저장이 대화상자의 변경을 되돌렸다(다른 창의 저장도 같다).
 *  · 이제 깨끗한 표는 서버 값과 함께 갱신되고, 수정 중인 표는 값·기준이 그대로 남아 저장이 거절된다(덮지 않는다).
 */
const m = vi.hoisted(() => ({ save: vi.fn(), markSaved: vi.fn(), rebaseline: vi.fn(), notifySaved: vi.fn() }));
vi.mock("@/features/owner/server/actions", () => ({ saveOwnerSection: m.save }));
vi.mock("@/components/workspace/use-concurrent-edit-guard", () => ({
  useConcurrentEditGuard: () => ({ notifySaved: m.notifySaved, rebaseline: m.rebaseline }),
}));
vi.mock("@/components/workspace/use-unsaved-guard", () => ({ useUnsavedGuard: () => ({ markSaved: m.markSaved }) }));
vi.mock("@/features/owner/navigation-context", () => ({ useNavigationSettings: () => ({ tenantId: "tenant" }) }));
vi.mock("@/lib/realtime/record-channel", () => ({ publishRecordSaved: vi.fn() }));
vi.mock("@/components/forms/form-action-bar", () => ({
  FormActionBar: ({ children }: { children: ReactNode }) => <div data-testid="action-bar">{children}</div>,
}));
vi.mock("@/components/ui/drag-scroll-area", () => ({
  DragScrollArea: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

import { nextPermissionAccess } from "@/features/owner/permission-edit";
import type { PermissionsSettings } from "@/features/owner/settings-types";
import { isTeacherMenuEntranceOpen } from "@/lib/navigation";
import { MENU_ACCESS, MENU_LABEL, SYSTEM_ROLES, TEACHER_MENU_KEYS, isPermissionLocked, type Access, type MenuKey, type SystemRole } from "@/lib/permissions";
import { PermissionsSection } from "./permissions-section";

const settings = (overrides: PermissionsSettings["overrides"] = []): PermissionsSettings => ({
  overrides,
  userOverrides: [],
  specialAccess: { payslipViewerIds: [], leaveAdjusterIds: [], classSplitterIds: [], staffSubjectScopes: [] },
});
const payload = (container: HTMLElement) =>
  JSON.parse((container.querySelector('input[type="hidden"][name="data"]') as HTMLInputElement).value) as PermissionsSettings;
const lastRequest = () => m.save.mock.calls.at(-1)![1] as FormData;
const saveButton = () => within(screen.getByTestId("action-bar")).getByRole("button", { name: /저장/ });
/** '역할별 메뉴 권한' 표의 한 칸(버튼). */
const cell = (menu: MenuKey, role: SystemRole) => {
  const row = screen.getAllByRole("table").map((table) => within(table).queryByText(MENU_LABEL[menu])).find(Boolean)!.closest("tr") as HTMLElement;
  return within(row).getAllByRole("button")[SYSTEM_ROLES.indexOf(role)] as HTMLButtonElement;
};
const overrideOf = (container: HTMLElement, menu: MenuKey, role: SystemRole): Access | undefined =>
  payload(container).overrides.find((o) => o.menu === menu && o.role === role)?.access;
const save = () => act(async () => fireEvent.click(saveButton()));
const ok = (token: string, version?: number) => ({ ok: true, nonce: Math.random(), permissions: { token }, version });

/** 저장 액션을 테스트가 원하는 때 끝낸다. */
function deferredSave() {
  let resolve!: (value: unknown) => void;
  m.save.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  return (value: unknown) => act(async () => resolve(value));
}

// 표에서 한 번 눌렀을 때의 값(순환 규칙은 permission-edit.ts가 정한다 — 여기 다시 적지 않는다).
const STAFF_ADMIN_NEXT = nextPermissionAccess("staff", "admin", MENU_ACCESS.staff.admin);
// 다른 곳이 바꾼 칸 — 코드 기본값과 **다른** 값이어야 저장 목록(sparse)에 줄이 생긴다.
const ELSEWHERE = { menu: "billing", role: "manager", access: nextPermissionAccess("billing", "manager", MENU_ACCESS.billing.manager) } as const;

beforeEach(() => {
  vi.clearAllMocks();
  // 한 번짜리 응답 대기열까지 비운다 — 앞 테스트가 남긴 응답이 다음 테스트의 저장에 끼어들지 않게.
  m.save.mockReset();
});
afterEach(cleanup);

describe("저장 요청", () => {
  it("화면이 받은 기준 token과 세 칸(역할별 · 개인별 · 담당자)이 함께 실린다", async () => {
    m.save.mockResolvedValueOnce(ok("P1", 1));
    render(<PermissionsSection initial={settings()} baselineToken="P0" baselineVersion={0} />);
    fireEvent.click(cell("staff", "admin"));
    await save();
    expect(lastRequest().get("section")).toBe("permissions");
    expect(lastRequest().get("permissionsBaseline")).toBe("P0");
    expect(JSON.parse(String(lastRequest().get("data")))).toEqual({
      overrides: [{ menu: "staff", role: "admin", access: STAFF_ADMIN_NEXT }],
      userOverrides: [],
      specialAccess: { payslipViewerIds: [], payslipManagerIds: [], leaveAdjusterIds: [], classSplitterIds: [], staffSubjectScopes: [] },
    });
  });

  it("저장에 성공하면 다음 저장은 응답의 token으로 나간다 · 실패하면 옮기지 않는다", async () => {
    m.save
      .mockResolvedValueOnce({ error: "다른 창에서 이 설정이 변경되었습니다." })
      .mockResolvedValueOnce(ok("P1", 1))
      .mockResolvedValueOnce(ok("P2", 2));
    render(<PermissionsSection initial={settings()} baselineToken="P0" baselineVersion={0} />);
    fireEvent.click(cell("staff", "admin"));
    await save();
    expect(screen.getByText("다른 창에서 이 설정이 변경되었습니다.")).toBeTruthy();
    await save();
    expect(lastRequest().get("permissionsBaseline")).toBe("P0");
    await save();
    expect(lastRequest().get("permissionsBaseline")).toBe("P1");
  });

  it("기준 token 없이 그려진 화면은 기준 칸을 보내지 않는다(서버가 받지 않는다 — 지어내지 않는다)", async () => {
    m.save.mockResolvedValueOnce({ error: "화면이 오래되었습니다." });
    render(<PermissionsSection initial={settings()} />);
    await save();
    expect(lastRequest().has("permissionsBaseline")).toBe(false);
  });
});

describe("🔴 서버가 새 값을 내려보냈을 때 — 표 · 개인별 · 담당자 · 기준은 한 묶음", () => {
  // 다른 곳(대화상자 · 다른 창)이 저장한 뒤 화면이 새로 읽힌 상황 = 같은 컴포넌트에 새 prop이 온다.
  const changedElsewhere = settings([ELSEWHERE]);

  it("깨끗한 표는 새 값과 새 기준을 함께 받는다 — 다음 저장이 그 변경을 되돌리지 않는다", async () => {
    m.save.mockResolvedValueOnce(ok("P2", 2));
    const { container, rerender } = render(<PermissionsSection initial={settings()} baselineToken="P0" baselineVersion={0} />);
    const shownBefore = cell("billing", "manager").textContent;
    rerender(<PermissionsSection initial={changedElsewhere} baselineToken="P1" baselineVersion={1} />);
    expect(overrideOf(container, "billing", "manager")).toBe(ELSEWHERE.access);
    expect(cell("billing", "manager").textContent).not.toBe(shownBefore);
    // 받은 값은 '저장 전 변경'이 아니다.
    expect(screen.queryByText(/저장 전 변경/)).toBeNull();

    fireEvent.click(cell("staff", "admin"));
    await save();
    expect(lastRequest().get("permissionsBaseline")).toBe("P1");
    expect(JSON.parse(String(lastRequest().get("data"))).overrides).toContainEqual(ELSEWHERE);
  });

  it("수정 중이면 값도 기준도 그대로 둔다 — 저장은 옛 기준으로 나가 서버가 거절한다(옛 표로 덮지 않는다)", async () => {
    m.save.mockResolvedValueOnce({ error: "다른 창에서 이 설정이 변경되었습니다." });
    const { container, rerender } = render(<PermissionsSection initial={settings()} baselineToken="P0" baselineVersion={0} />);
    fireEvent.click(cell("staff", "admin"));
    rerender(<PermissionsSection initial={changedElsewhere} baselineToken="P1" baselineVersion={1} />);
    // 내 편집은 남고, 다른 곳의 변경은 들어오지 않았다(섞지 않는다).
    expect(overrideOf(container, "staff", "admin")).toBe(STAFF_ADMIN_NEXT);
    expect(overrideOf(container, "billing", "manager")).toBeUndefined();
    await save();
    expect(lastRequest().get("permissionsBaseline")).toBe("P0");
  });

  it("개인별 예외·담당자만 바뀐 값도 깨끗하면 함께 받는다", () => {
    const person = "11111111-1111-4111-8111-111111111111";
    const { container, rerender } = render(<PermissionsSection initial={settings()} baselineToken="P0" baselineVersion={0} generic />);
    rerender(
      <PermissionsSection
        initial={{ ...settings(), userOverrides: [{ userId: person, menu: "staff", access: "full" }], specialAccess: { payslipViewerIds: [person], leaveAdjusterIds: [], classSplitterIds: [], staffSubjectScopes: [] } }}
        baselineToken="P1"
        baselineVersion={1}
        generic
      />,
    );
    expect(payload(container).userOverrides).toEqual([{ userId: person, menu: "staff", access: "full" }]);
    expect(payload(container).specialAccess.payslipViewerIds).toEqual([person]);
  });

  it("내 저장보다 먼저 읽힌 값이 뒤늦게 내려와도 받지 않는다 — 방금 저장한 표가 옛 값으로 돌아가지 않는다", async () => {
    m.save.mockResolvedValueOnce(ok("P3", 3)).mockResolvedValueOnce(ok("P4", 4));
    const { container, rerender } = render(<PermissionsSection initial={settings()} baselineToken="P1" baselineVersion={1} />);
    // 다른 곳의 저장(순번 2)이 내려와 깨끗한 표가 받았다 → 그 위에서 고쳐 저장했다(순번 3).
    rerender(<PermissionsSection initial={changedElsewhere} baselineToken="P2" baselineVersion={2} />);
    fireEvent.click(cell("staff", "admin"));
    await save();
    // 그보다 **먼저 읽힌** 값(순번 1)이 뒤늦게 도착했다 — 도착한 순서가 읽힌 순서가 아니다.
    rerender(<PermissionsSection initial={settings()} baselineToken="P1" baselineVersion={1} />);
    expect(overrideOf(container, "staff", "admin")).toBe(STAFF_ADMIN_NEXT);
    expect(overrideOf(container, "billing", "manager")).toBe(ELSEWHERE.access);
    await save();
    expect(lastRequest().get("permissionsBaseline")).toBe("P3");
  });

  it("저장이 도는 동안 내려온 값은 미뤄 두고 응답을 먼저 반영한다", async () => {
    const finish = deferredSave();
    m.save.mockResolvedValueOnce(ok("P3", 3));
    const { container, rerender } = render(<PermissionsSection initial={settings()} baselineToken="P0" baselineVersion={0} />);
    fireEvent.click(cell("staff", "admin"));
    await act(async () => fireEvent.submit(container.querySelector("form")!));
    const afterMySave = settings([{ menu: "staff", role: "admin", access: STAFF_ADMIN_NEXT }]);
    // 내 저장이 반영된 값이 응답보다 먼저 도착했다.
    rerender(<PermissionsSection initial={afterMySave} baselineToken="P1" baselineVersion={1} />);
    await finish(ok("P1", 1));
    expect(overrideOf(container, "staff", "admin")).toBe(STAFF_ADMIN_NEXT);
    await save();
    expect(lastRequest().get("permissionsBaseline")).toBe("P1");
  });
});

describe("'저장 전 변경' 표시는 확정 상태와 견준다", () => {
  it("저장에 성공하면 바로 사라진다 — 서버 값(prop)이 아직 옛것이어도", async () => {
    m.save.mockResolvedValueOnce(ok("P1", 1));
    render(<PermissionsSection initial={settings()} baselineToken="P0" baselineVersion={0} />);
    fireEvent.click(cell("staff", "admin"));
    expect(screen.getByText("저장 전 변경 1개")).toBeTruthy();
    await save();
    expect(screen.queryByText(/저장 전 변경/)).toBeNull();
    // 저장 뒤에 더 고친 것은 다시 변경으로 잡힌다(기준 = 방금 저장한 값).
    fireEvent.click(cell("staff", "admin"));
    expect(screen.getByText("저장 전 변경 1개")).toBeTruthy();
  });

  it("저장이 실패하면 그대로 남는다", async () => {
    m.save.mockResolvedValueOnce({ error: "저장하지 못했습니다" });
    render(<PermissionsSection initial={settings()} baselineToken="P0" baselineVersion={0} />);
    fireEvent.click(cell("staff", "admin"));
    await save();
    expect(screen.getByText("저장 전 변경 1개")).toBeTruthy();
  });
});

describe("같은 칸이 서로 다른 값으로 저장돼 있을 때", () => {
  // 손으로 넣은 값·스크립트에서만 생긴다 — 화면의 저장은 이런 줄을 만들지 않는다(저장 액션이 거절한다).
  const ambiguous = settings([
    { menu: "billing", role: "admin", access: "none" },
    { menu: "billing", role: "admin", access: "readonly" },
  ]);

  it("🔴 말없이 정리하지 않는다 — 어느 칸인지 알리고, 표에는 마지막 줄을 보여 준다", () => {
    const { container } = render(<PermissionsSection initial={ambiguous} baselineToken="P0" baselineVersion={0} />);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("같은 칸이 서로 다른 값으로 여러 번 저장되어 있습니다");
    expect(notice.textContent).toContain(`${MENU_LABEL.billing} · `);
    // 원시 코드(메뉴 키·직급 키)를 그대로 내보내지 않는다.
    expect(notice.textContent).not.toMatch(/billing|admin/);
    // 저장하면 표의 값 하나(한 줄)로 나간다.
    expect(payload(container).overrides.filter((o) => o.menu === "billing" && o.role === "admin")).toEqual([
      { menu: "billing", role: "admin", access: "readonly" },
    ]);
  });

  it("그런 칸이 없으면 안내가 없다", () => {
    render(<PermissionsSection initial={settings([ELSEWHERE])} baselineToken="P0" baselineVersion={0} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  // 저장으로 정리된 뒤의 값(같은 칸 한 줄).
  const cleaned = settings([{ menu: "billing", role: "admin", access: "readonly" }]);

  it("저장에 성공하면 안내가 바로 사라진다 — 서버 값(prop)이 아직 옛것이어도", async () => {
    m.save.mockResolvedValueOnce(ok("P1", 1));
    render(<PermissionsSection initial={ambiguous} baselineToken="P0" baselineVersion={0} />);
    expect(screen.getByRole("status")).toBeTruthy();
    await save();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("🔴 정리한 뒤, 내 저장보다 먼저 읽힌 값이 뒤늦게 내려와도 안내가 되살아나지 않는다", async () => {
    m.save.mockResolvedValueOnce(ok("P1", 1));
    const { rerender } = render(<PermissionsSection initial={ambiguous} baselineToken="P0" baselineVersion={0} />);
    await save();
    rerender(<PermissionsSection initial={cleaned} baselineToken="P1" baselineVersion={1} />);
    expect(screen.queryByRole("status")).toBeNull();
    // 저장 전에 읽힌 값(순번 0)이 늦게 도착했다 — 이 화면은 그 값을 받지 않는다.
    rerender(<PermissionsSection initial={ambiguous} baselineToken="P0" baselineVersion={0} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("저장이 실패하면 안내가 남는다", async () => {
    m.save.mockResolvedValueOnce({ error: "저장하지 못했습니다" });
    render(<PermissionsSection initial={ambiguous} baselineToken="P0" baselineVersion={0} />);
    await save();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("연 뒤 다른 곳이 그런 줄을 넣었다(표의 값은 그대로다) → 깨끗한 화면이 새 값을 받을 때 안내가 선다", () => {
    // 마지막 줄이 화면의 표와 같은 값이라 표는 바뀌지 않는다 — 그래도 저장값은 달라졌고 기준 token도 새것이다.
    const { rerender } = render(<PermissionsSection initial={cleaned} baselineToken="P0" baselineVersion={0} />);
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<PermissionsSection initial={ambiguous} baselineToken="P1" baselineVersion={1} />);
    expect(screen.getByRole("status").textContent).toContain(`${MENU_LABEL.billing} · `);
  });

  it("수정 중이면 새 값을 받지 않으므로 안내도 그대로다(화면이 딛고 선 값과 안내가 어긋나지 않는다)", () => {
    const { rerender } = render(<PermissionsSection initial={cleaned} baselineToken="P0" baselineVersion={0} />);
    fireEvent.click(cell("staff", "admin"));
    rerender(<PermissionsSection initial={ambiguous} baselineToken="P1" baselineVersion={1} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("강사 '내 메뉴' 표시 — 켜면 끄기 직전 값으로 돌아온다", () => {
  // 강사에게 기본으로 열려 있고 '읽기'로 낮출 수 있는 탭 하나를 고른다(표의 값은 코드 기본값에서 가져온다).
  const menu = TEACHER_MENU_KEYS.filter(isTeacherMenuEntranceOpen).find(
    (k) => k !== "teacher_onescreen" && MENU_ACCESS[k].teacher !== "none" && MENU_ACCESS[k].teacher !== "readonly" && !isPermissionLocked(k, "teacher", "readonly"),
  )!;
  const toggle = () => {
    const section = screen.getByRole("heading", { name: /내 메뉴.*표시/ }).closest("section") as HTMLElement;
    return within(section).getByRole("checkbox", { name: new RegExp(`^${MENU_LABEL[menu]}`) }) as HTMLInputElement;
  };
  const readonlyForTeacher = settings([{ menu, role: "teacher", access: "readonly" }]);

  it("고를 탭이 있다(테스트 전제)", () => expect(menu).toBeTruthy());

  it("끄고 다시 켜면 '읽기'가 돌아온다(코드 기본값으로 바뀌지 않는다) — 저장한 뒤에도 같다", async () => {
    m.save.mockResolvedValueOnce(ok("P1", 1));
    const { container } = render(<PermissionsSection initial={readonlyForTeacher} baselineToken="P0" baselineVersion={0} />);
    fireEvent.click(toggle());
    expect(overrideOf(container, menu, "teacher")).toBe("none");
    fireEvent.click(toggle());
    expect(overrideOf(container, menu, "teacher")).toBe("readonly");

    fireEvent.click(toggle());
    await save();
    fireEvent.click(toggle());
    expect(overrideOf(container, menu, "teacher")).toBe("readonly");
  });

  it("서버 값으로 표를 갈아끼운 뒤에는 옛 표의 기억을 되살리지 않는다", async () => {
    m.save.mockResolvedValueOnce(ok("P1", 1));
    const { container, rerender } = render(<PermissionsSection initial={readonlyForTeacher} baselineToken="P0" baselineVersion={0} />);
    fireEvent.click(toggle());
    await save();
    // 다른 곳이 다른 칸을 바꿨다 — 이 탭은 꺼진 채다. 깨끗한 표라 새 값을 받는다.
    rerender(
      <PermissionsSection
        initial={settings([{ menu, role: "teacher", access: "none" }, ELSEWHERE])}
        baselineToken="P2"
        baselineVersion={2}
      />,
    );
    expect(overrideOf(container, "billing", "manager")).toBe(ELSEWHERE.access);
    fireEvent.click(toggle());
    // 새 표에서 이 탭은 처음부터 꺼져 있었다 → 코드 기본값으로 켠다(기본값과 같으니 저장 목록에 줄이 없다).
    expect(overrideOf(container, menu, "teacher")).toBeUndefined();
    expect(toggle().checked).toBe(true);
  });
});

describe("배선", () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
  const strip = (code: string) => code.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const page = strip(read("src", "app", "(shell)", "owner", "page.tsx"));

  it("🔴 역할·권한 면에는 머리글 '역할 설정' 버튼을 세우지 않는다 — 같은 칸을 고치는 곳이 한 화면에 둘이 되지 않게", () => {
    expect(page).not.toContain("SettingRolesControl");
  });

  it("🔴 폼의 값과 기준 token은 **방금 읽은** 역할·권한에서 만든다 — 설정 캐시의 값으로 폼을 열지 않는다", () => {
    expect(page).toContain('const showsPermissions = tab === "permissions" && isMaster;');
    expect(page).toContain("const permissionsSource = showsPermissions ? editable?.settings.permissions : undefined;");
    // 폼의 값 = 방금 읽은 값에서 퇴사자만 거른 것(2026-11-09) · 기준 token = 방금 읽은 저장값 그대로(거른 값을 저장하면 저장값에서도 빠진다).
    expect(page).toContain("const permissionsInitial = permissionsSource ? withoutRetiredPeople({ permissions: permissionsSource }, retiredPermissionPeople).permissions : undefined;");
    expect(page).toContain("initial={permissionsInitial ?? permissionsSource}");
    expect(page).toContain("baselineToken={permissionsToken(permissionsSource)}");
    expect(page).toContain("baselineVersion={editable?.versions.permissions}");
    expect(page).not.toMatch(/initial=\{settings\.permissions\}/);
    // 못 읽었으면 폼을 세우지 않는다(안내만).
    expect(page).toMatch(/permissionsSource \? \(\s*<PermissionsSection/);
  });

  it("읽은 섹션마다 제 저장 순번을 낸다", () => {
    expect(strip(read("src", "features", "owner", "server", "queries.ts"))).toContain(
      "versions: { operations: settingsRevOf(stored?.operations), permissions: settingsRevOf(stored?.permissions) },",
    );
  });

  it("화면과 저장이 같은 함수로 기준 token을 만든다", () => {
    const actions = strip(read("src", "features", "owner", "server", "actions.ts"));
    expect(actions).toContain('permissionsBaseline !== permissionsToken(resolveSettings(existing?.data ?? null, { name: "" }).permissions)');
    expect(actions).toContain("{ token: permissionsToken(saved.permissions) }");
  });
});
