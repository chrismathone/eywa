/**
 * 강사보다 낮은 직급(열람·아르바이트)에는 '담당'을 줄 수 없다 — 그리고 **말없이 막지 않는다**.
 *
 * 원장 2026-11-05 *"관리자도 수업을 할 수 있기 때문에 '담당'일 수도 있음. 강사보다 낮은 직급은 담당 금지."* ·
 * *"무조건적으로 안되게하지말고 알림메시지도 배선"*. 조사(2026-11-05): 강사가 아닌 역할의 '담당'은 목록 범위가
 * 강사 판정(`effectiveTeacherId`)만 보므로 대부분의 화면에서 '전체'처럼 열렸다 — 아르바이트에게 출석부 '담당'을 주자
 * 다른 선생님 출석부가 전부 보였다. 열람·아르바이트는 맡을 반이 없으니(담임·위임 = 강사 이상) '담당'의 뜻이 없다.
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROLE_HIERARCHY } from "@/lib/auth/role-hierarchy";
import {
  applyUserOverrides,
  isPermissionLocked,
  isScopedForbiddenRole,
  MENU_ACCESS,
  MENU_KEYS,
  resolveMatrix,
  SCOPED_FORBIDDEN_MESSAGE,
  SCOPED_FORBIDDEN_ROLES,
  storedScopedAccess,
  SYSTEM_ROLES,
  type SystemRole,
} from "@/lib/permissions";
import { PermissionsSection } from "@/app/(shell)/owner/_components/permissions-section";
import { ROLE_LABEL } from "@/app/(shell)/owner/_components/permission-ui";
import { UserOverrideEditor } from "@/app/(shell)/owner/_components/user-override-editor";
import { cycleSkipsScoped, nextPermissionAccess } from "./permission-edit";
import { editablePermissionRowGroups } from "./permission-rows";
import { permissionsSchema } from "./settings-types";

vi.mock("@/app/(shell)/owner/_components/section-form", () => ({
  SectionForm: ({ children }: { children?: ReactNode }) => <form>{children}</form>,
}));
vi.mock("@/components/ui/drag-scroll-area", () => ({
  DragScrollArea: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
afterEach(cleanup);

const SPECIAL = { payslipViewerIds: [], leaveAdjusterIds: [], classSplitterIds: [], staffSubjectScopes: [] };
const EMPTY = { overrides: [], userOverrides: [], specialAccess: SPECIAL };

describe("규칙 — 강사보다 낮은 직급은 '담당' 금지", () => {
  it("🔴 금지 역할 = 직급 순서(ROLE_HIERARCHY)에서 강사보다 아래인 직원 역할(학생은 컬럼 전체가 따로 잠김) — 순서를 바꾸면 여기서 깨진다", () => {
    const below = SYSTEM_ROLES.filter((r) => r !== "student" && ROLE_HIERARCHY[r] > ROLE_HIERARCHY.teacher);
    expect([...SCOPED_FORBIDDEN_ROLES].sort()).toEqual([...below].sort());
    expect(below).toEqual(expect.arrayContaining(["viewer", "parttime"]));
  });

  it("관리자·실장·회계·상담·강사는 '담당'을 줄 수 있다(관리자도 수업을 한다 — 원장)", () => {
    for (const role of ["admin", "manager", "accountant", "counselor", "teacher"] as SystemRole[]) {
      expect(isScopedForbiddenRole(role), role).toBe(false);
      expect(isPermissionLocked("attendance", role, "scoped"), role).toBe(false);
    }
  });

  it("열람·아르바이트의 '담당'은 모든 메뉴에서 잠긴다 — 다른 수준은 그대로 고를 수 있다", () => {
    for (const role of SCOPED_FORBIDDEN_ROLES) {
      for (const menu of MENU_KEYS) expect(isPermissionLocked(menu, role, "scoped"), `${menu}:${role}`).toBe(true);
      for (const access of ["full", "readonly", "none"] as const) expect(isPermissionLocked("attendance", role, access)).toBe(false);
    }
  });

  it("🔴 코드 기본값에 열람·아르바이트 '담당'이 없다(있으면 잠금과 기본값이 서로 어긋난다)", () => {
    for (const menu of MENU_KEYS) for (const role of SCOPED_FORBIDDEN_ROLES) expect(MENU_ACCESS[menu][role], `${menu}:${role}`).not.toBe("scoped");
  });

  it("🔴 저장된 '담당'(손으로 넣은 값·역할이 바뀐 사람)은 '읽기'와 '그 줄이 없을 때의 값' 중 좁은 쪽으로 내린다 — 어느 쪽으로도 넓어지지 않는다", () => {
    // 역할 칸: 코드 기본값이 '없음'(아르바이트 출석부)이면 '없음', '읽기'(열람 출석부)면 '읽기'.
    expect(MENU_ACCESS.attendance.parttime).toBe("none");
    expect(resolveMatrix([{ menu: "attendance", role: "parttime", access: "scoped" }]).attendance.parttime).toBe("none");
    expect(MENU_ACCESS.attendance.viewer).toBe("readonly");
    expect(resolveMatrix([{ menu: "attendance", role: "viewer", access: "scoped" }]).attendance.viewer).toBe("readonly");
    // 개인 줄: 역할 칸 '전체' + 개인 '담당'으로 좁혀 둔 열람 — 개인 줄을 버리면 '전체'가 된다(리뷰 2026-11-05 탐침). '읽기'여야 한다.
    const roleFull = resolveMatrix([{ menu: "students", role: "viewer", access: "full" }]);
    expect(roleFull.students.viewer).toBe("full");
    expect(applyUserOverrides(roleFull, "u1", "viewer", [{ userId: "u1", menu: "students", access: "scoped" }]).students.viewer).toBe("readonly");
    // 개인 줄: 역할 칸 '없음'(아르바이트 원생·출석부 기본값) + 옛 '담당' — '읽기'로 올리면 학원 전체 원생 상세가 열린다(재리뷰 2026-11-05 탐침).
    const base = resolveMatrix([]);
    expect(base.students.parttime).toBe("none");
    for (const menu of ["students", "attendance"] as const) {
      expect(applyUserOverrides(base, "u1", "parttime", [{ userId: "u1", menu, access: "scoped" }])[menu].parttime, menu).toBe("none");
    }
    // 모든 메뉴 × 두 역할 × 그 줄이 없을 때의 값: '없음'이면 '없음', 아니면 '읽기'(강사뷰 접근 제외 — 아래).
    for (const menu of MENU_KEYS) for (const role of SCOPED_FORBIDDEN_ROLES) for (const fallback of ["none", "readonly", "full"] as const) {
      if (menu === "teacher_view") continue;
      expect(storedScopedAccess(menu, role, "scoped", fallback), `${menu}:${role}:${fallback}`).toBe(fallback === "none" ? "none" : "readonly");
    }
    // 다른 역할·다른 수준은 그대로.
    expect(storedScopedAccess("students", "teacher", "scoped", "none")).toBe("scoped");
    expect(storedScopedAccess("students", "parttime", "full", "none")).toBe("full");
    // 그 사람 줄이 없으면(또는 잠긴 줄뿐이면) 받은 표를 그대로 돌려준다(요청 캐시 표를 바꾸지 않는다).
    expect(applyUserOverrides(base, "u2", "parttime", [{ userId: "u1", menu: "students", access: "scoped" }])).toBe(base);
    expect(applyUserOverrides(base, "u1", "parttime", [{ userId: "u1", menu: "teacher_view", access: "scoped" }])).toBe(base);
    // 강사뷰 접근의 '담당'은 뜻이 없는 값 — 내리지 않고 종전대로 버린다.
    expect(storedScopedAccess("teacher_view", "parttime", "scoped", "readonly")).toBe("scoped");
    expect(resolveMatrix([{ menu: "teacher_view", role: "parttime", access: "scoped" }]).teacher_view.parttime).toBe(MENU_ACCESS.teacher_view.parttime);
  });

  it("안내 문구에 권한 화면의 역할 이름이 그대로 들어 있다(이름을 바꾸면 문구도 함께)", () => {
    for (const role of SCOPED_FORBIDDEN_ROLES) expect(SCOPED_FORBIDDEN_MESSAGE).toContain(ROLE_LABEL[role]);
  });
});

describe("권한 표 — 칸을 누르면 '담당'을 건너뛰고 까닭을 알린다", () => {
  it("순환: 열람·아르바이트는 전체 → 읽기(담당 건너뜀), 강사는 전체 → 담당", () => {
    expect(nextPermissionAccess("attendance", "parttime", "full")).toBe("readonly");
    expect(cycleSkipsScoped("attendance", "parttime", "full")).toBe(true);
    expect(cycleSkipsScoped("attendance", "parttime", "readonly")).toBe(false);
    expect(nextPermissionAccess("attendance", "teacher", "full")).toBe("scoped");
    expect(cycleSkipsScoped("attendance", "teacher", "full")).toBe(false);
    // 강사뷰 접근은 원래 '담당'이 없는 줄이라 건너뜀 안내 대상이 아니다.
    expect(cycleSkipsScoped("teacher_view", "viewer", "full")).toBe(false);
  });

  it("🔴 아르바이트 출석부 칸: 없음 → 전체 → (담당 건너뜀) 읽기 + 안내 · 다른 칸을 누르면 안내가 사라진다", () => {
    const { container } = render(<PermissionsSection initial={EMPTY} />);
    // 알림 자리는 처음부터 붙어 있고 비어 있다 — 글만 바뀐다(내용과 함께 끼우면 화면낭독기가 놓친다).
    const regions = [...container.querySelectorAll("[data-scoped-skip-notice] [aria-live='polite']")];
    expect(regions).toHaveLength(2); // 메뉴 표 · 설정 표
    expect(regions.every((r) => r.textContent === "")).toBe(true);
    const cell = (access: string) => screen.getByRole("button", { name: `출석부 · ${ROLE_LABEL.parttime}: ${access}` });
    fireEvent.click(cell("없음"));
    expect(screen.queryByText(/‘담당’을 건너뛰고/)).toBeNull();
    fireEvent.click(cell("전체"));
    expect(cell("읽기")).toBeInTheDocument();
    const notice = screen.getByText(/‘담당’을 건너뛰고 ‘읽기’로 바꿨습니다/).closest("p")!;
    expect(notice).toHaveAttribute("aria-live", "polite");
    expect(regions).toContain(notice); // 같은 알림 자리(새로 끼운 요소가 아니다)
    expect(notice.textContent).toContain(`출석부 · ${ROLE_LABEL.parttime}`);
    expect(notice.textContent).toContain(SCOPED_FORBIDDEN_MESSAGE);
    fireEvent.click(screen.getByRole("button", { name: `출석부 · ${ROLE_LABEL.teacher}: 담당` }));
    expect(screen.queryByText(/‘담당’을 건너뛰고/)).toBeNull();
    expect(notice.isConnected).toBe(true);
  });

  it("🔴 안내는 표 **아래**에서 창 아래(저장 줄 위)에 붙는다 — 표가 길어 표 위에 두면 아래쪽 줄을 누를 때 안 보였다 · 닫기로 치운다", () => {
    render(<PermissionsSection initial={EMPTY} />);
    const card = screen.getByRole("heading", { name: "역할별 메뉴 권한" }).closest("section")!;
    const sticky = card.querySelector("[data-scoped-skip-notice]")!;
    expect(sticky.className).toMatch(/\bsticky\b/);
    expect(sticky.className).toMatch(/\bbottom-16\b/);
    const lastCell = within(card).getAllByRole("button", { name: new RegExp(`· ${ROLE_LABEL.parttime}: `) }).at(-1)!;
    expect(lastCell.compareDocumentPosition(sticky) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `출석부 · ${ROLE_LABEL.parttime}: 없음` }));
    fireEvent.click(screen.getByRole("button", { name: `출석부 · ${ROLE_LABEL.parttime}: 전체` }));
    expect(sticky.textContent).toContain("‘담당’을 건너뛰고");
    const close = within(sticky as HTMLElement).getByRole("button", { name: "안내 닫기" });
    close.focus();
    fireEvent.click(close);
    expect(sticky.textContent).toBe("");
    // 닫기 단추가 사라져도 초점이 문서 맨 처음(body)으로 빠지지 않고 안내를 띄운 칸으로 돌아간다(재리뷰 2026-11-05).
    expect(document.activeElement).toBe(screen.getByRole("button", { name: `출석부 · ${ROLE_LABEL.parttime}: 읽기` }));
  });

  it("표 설명에도 규칙을 적는다(띄어쓰기까지 — JSX 줄바꿈이 공백을 지우던 자리)", () => {
    render(<PermissionsSection initial={EMPTY} />);
    const card = screen.getByRole("heading", { name: "역할별 메뉴 권한" }).closest("section")!;
    expect(card.textContent).toContain("강사보다 낮은 직급(열람·아르바이트)도 전체 → 읽기 → 없음만 씁니다");
  });
});

describe("개인별 메뉴 권한 — 열람·아르바이트에게 '담당'을 고르면 단추를 끄고 까닭을 알린다", () => {
  const staff = [
    { id: "p1", name: "알바생", role: "parttime" },
    { id: "t1", name: "강사님", role: "teacher" },
  ];
  const groups = editablePermissionRowGroups();
  function pick(userId: string) {
    render(<UserOverrideEditor overrides={[]} roleMatrix={resolveMatrix([])} hiddenUserIds={[]} staffOptions={staff} nameOf={(id) => id} groups={groups} onChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("직원 선택"), { target: { value: userId } });
    fireEvent.change(screen.getByLabelText("메뉴 선택"), { target: { value: "attendance" } });
    fireEvent.change(screen.getByLabelText("접근 수준"), { target: { value: "scoped" } });
  }

  it("🔴 아르바이트 + 담당 → '추가·변경' 꺼짐 + 안내(role=alert)", () => {
    pick("p1");
    expect(screen.getByRole("button", { name: "추가·변경" })).toBeDisabled();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(ROLE_LABEL.parttime);
    expect(alert.textContent).toContain(SCOPED_FORBIDDEN_MESSAGE);
  });

  it("강사 + 담당 → 안내 없음 · 추가할 수 있다", () => {
    pick("t1");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "추가·변경" })).toBeEnabled();
  });

  it("역할이 바뀌어 남은 옛 '담당' 줄은 '읽기로 적용'과 까닭이 **보이는 글**로 뜨고 고르기 칸과 묶인다(말없이 두지 않는다)", () => {
    // 위 역할 표에서 아르바이트 출석부를 '전체'로 연 경우 — 옛 '담당' 줄은 '읽기'로 적용된다.
    const roleMatrix = resolveMatrix([{ menu: "attendance", role: "parttime", access: "full" }]);
    render(<UserOverrideEditor overrides={[{ userId: "p1", menu: "attendance", access: "scoped" }, { userId: "t1", menu: "attendance", access: "scoped" }]} roleMatrix={roleMatrix} hiddenUserIds={[]} staffOptions={staff} nameOf={(id) => id} groups={groups} onChange={() => {}} />);
    const table = screen.getByRole("table", { name: "개인별 메뉴 권한" });
    const note = within(table).getByText(/‘읽기’로 적용됩니다/);
    expect(note.textContent).toContain(ROLE_LABEL.parttime);
    const select = within(table).getByLabelText("p1 출석부 권한");
    expect(select).toHaveAttribute("aria-describedby", note.id);
    expect(note.id).not.toBe("");
    // 강사의 '담당' 줄은 정상 — 안내 없음.
    expect(within(table).getByLabelText("t1 출석부 권한")).not.toHaveAttribute("aria-describedby");
    expect(within(table).getAllByText(/‘읽기’로 적용됩니다/)).toHaveLength(1);
    // 적용하는 쪽과 같은 값이다.
    expect(applyUserOverrides(roleMatrix, "p1", "parttime", [{ userId: "p1", menu: "attendance", access: "scoped" }]).attendance.parttime).toBe("readonly");
  });

  it("🔴 그 사람 역할 칸이 '없음'이면 옛 '담당' 줄은 '없음'으로 적용된다고 적는다('읽기'로 열지 않는다 — 재리뷰 2026-11-05)", () => {
    const roleMatrix = resolveMatrix([]);
    render(<UserOverrideEditor overrides={[{ userId: "p1", menu: "attendance", access: "scoped" }]} roleMatrix={roleMatrix} hiddenUserIds={[]} staffOptions={staff} nameOf={(id) => id} groups={groups} onChange={() => {}} />);
    const table = screen.getByRole("table", { name: "개인별 메뉴 권한" });
    const note = within(table).getByText(/‘없음’으로 적용됩니다/);
    expect(within(table).getByLabelText("p1 출석부 권한")).toHaveAttribute("aria-describedby", note.id);
    expect(within(table).queryByText(/‘읽기’로 적용됩니다/)).toBeNull();
    expect(applyUserOverrides(roleMatrix, "p1", "parttime", [{ userId: "p1", menu: "attendance", access: "scoped" }]).attendance.parttime).toBe("none");
  });
});

describe("스키마 — 저장된 값을 읽는 데도 쓰이므로 이 규칙을 넣지 않는다", () => {
  it("🔴 저장돼 있던 아르바이트·열람 '담당' 칸이 있어도 스키마는 읽는다(운영 설정 보호 검사가 이 스키마로 저장값을 파싱한다 — 막으면 그 학원은 이 면을 영영 저장 못 한다)", () => {
    for (const role of SCOPED_FORBIDDEN_ROLES) {
      expect(permissionsSchema.safeParse({ ...EMPTY, overrides: [{ menu: "attendance", role, access: "scoped" }] }).success, role).toBe(true);
    }
    // 거절은 저장 액션이 요청 값만 보고 한다 — permissions-save.test.ts의 "강사보다 낮은 직급의 '담당'" 묶음.
  });
});
