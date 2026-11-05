/**
 * 학원설정 '강사 내 메뉴 표시' 토글이 **실제로 메뉴를 바꾸는 탭만** 보여 준다 (2026-09-11 리뷰).
 *
 * 캘린더를 메뉴에서 뺀 뒤(원장 2026-09-10) 강사 '내 메뉴'는 입구 정책으로 캘린더를 거르는데, 이 토글 목록은
 * `TEACHER_MENU_KEYS`를 그대로 돌아서 캘린더 체크박스가 남아 있었다 — 켜도 꺼도 메뉴엔 아무 일도 없는
 * 거짓 약속(write-only-orphan과 같은 모양). 입구 정책은 NAV 표의 순수 함수 하나이고 두 소비처가 같이 쓴다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLASS_SPLIT_ENABLED } from "@/features/class-splits/access";
import { OperationsProvider } from "@/features/owner/operations-context";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { SETTINGS_ROLE_KEYS } from "@/lib/settings-role-catalog";
import { editablePermissionRowGroups } from "@/features/owner/permission-rows";
import { teacherToggleRows } from "@/features/owner/teacher-toggle-rows";
import { teacherMenuKeysFor } from "@/lib/navigation";
import { CONNECTED_APP_MENU_KEYS, MENU_LABEL, resolveMatrix, SYSTEM_ROLES, TEACHER_MENU_KEYS, type MenuKey } from "@/lib/permissions";
import { ROLE_LABEL } from "./permission-ui";
import { PermissionsSection } from "./permissions-section";

vi.mock("./section-form", () => ({
  SectionForm: ({ children, payload }: { children?: ReactNode; payload?: unknown }) => <form>{children}<output data-testid="payload">{JSON.stringify(payload)}</output></form>,
}));
vi.mock("@/components/ui/drag-scroll-area", () => ({
  DragScrollArea: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const EMPTY = { overrides: [], userOverrides: [], specialAccess: { payslipViewerIds: [], leaveAdjusterIds: [], classSplitterIds: [], staffSubjectScopes: [] } };
afterEach(cleanup);
const menuTable = () => within(screen.getByRole("heading", { name: "역할별 메뉴 권한" }).closest("section")!).getByRole("table");

const toggleCard = () => screen.getByRole("heading", { name: /내 메뉴.*표시/, hidden: true }).closest("section") as HTMLElement;
/** 칸의 권한 이름 줄(아래 '내 메뉴' 이름 줄은 뗀다). */
const nameLine = (checkbox: HTMLElement) => checkbox.closest("label")?.querySelector("span > span")?.textContent ?? "";
/** '강사 내 메뉴 표시' 구획의 칸 이름(" · 고정" 꼬리는 뗀다). */
function toggleLabels(): string[] {
  render(<PermissionsSection initial={EMPTY} />);
  return within(toggleCard())
    .getAllByRole("checkbox", { hidden: true })
    .map((c) => nameLine(c).replace(" · 고정", "").trim());
}

describe("학원설정 '강사 내 메뉴 표시' — 메뉴에서 뺀 탭은 토글 목록에 없다", () => {
  it("🔴 캘린더(원장 2026-09-10 메뉴에서 제외)는 빠진다 — 켜도 꺼도 메뉴엔 아무 일도 없는 칸이다", () => {
    expect(toggleLabels()).not.toContain(MENU_LABEL.calendar);
  });

  it("사이드바엔 숨겼지만 강사 드롭다운이 유일한 입구인 교재 요청·지출결의서는 남는다", () => {
    const labels = toggleLabels();
    expect(labels).toContain(MENU_LABEL.textbook_requests);
    expect(labels).toContain(MENU_LABEL.expense_requests);
  });

  it("🔑 토글 목록 = 강사 '내 메뉴'가 세울 수 있는 탭 — 두 소비처가 같은 입구 정책을 쓴다", () => {
    // 강사에게 전부 연 매트릭스면 '내 메뉴'가 세우는 탭 = 입구가 열린 탭 전부다.
    const open = resolveMatrix(
      TEACHER_MENU_KEYS.map((menu) => ({ menu, role: "teacher" as const, access: "full" as const })),
    );
    const inMenu = teacherMenuKeysFor("teacher", open).filter((k) => (TEACHER_MENU_KEYS as readonly MenuKey[]).includes(k));
    expect([...toggleLabels()].sort()).toEqual(inMenu.map((k) => MENU_LABEL[k]).sort());
  });

  it("칸의 차례 = '내 메뉴'가 서는 차례(강사뷰 구성) — 구성을 바꾸면 따라 바뀐다", () => {
    const labels0 = toggleLabels();
    expect(labels0).toEqual(teacherToggleRows().map((r) => r.label));
    // 기본 구성에서 '내 메뉴'의 차례: 홈 → 출결 모드(출석부) → 영어·수학 강사 시트 → 내 학생(원생목록) …
    expect(labels0.slice(0, 5)).toEqual([MENU_LABEL.teacher_onescreen, MENU_LABEL.attendance, MENU_LABEL.ecs, MENU_LABEL.mcs, MENU_LABEL.students]);
    cleanup();
    const navigation = { menus: [], teacherMenus: [{ href: "/documents", order: 0 }] };
    render(<PermissionsSection initial={EMPTY} navigation={navigation} />);
    const labels = within(toggleCard()).getAllByRole("checkbox", { hidden: true }).map(nameLine);
    expect(labels.slice(0, 2)).toEqual([`${MENU_LABEL.teacher_onescreen} · 고정`, MENU_LABEL.documents]);
  });

  it("접어 둘 수 있다 — 처음엔 접혀 있고 제목 줄에 몇 개를 보이는지 적는다. 접혀 있어도 값은 저장에 실린다", () => {
    const overrides = [{ menu: "exams" as const, role: "teacher" as const, access: "none" as const }];
    render(<PermissionsSection initial={{ ...EMPTY, overrides }} />);
    const details = toggleCard().querySelector("details")!;
    expect(details.open).toBe(false);
    // 제목 줄의 수 = 지금 강사에게 열려 있는 칸 수(기본으로 닫힌 전자결재·직원 평가와 방금 끈 성적관리는 빠진다).
    const open = resolveMatrix(overrides);
    const shown = teacherToggleRows().filter((r) => open[r.menu].teacher !== "none").length;
    expect(shown).toBeLessThan(teacherToggleRows().length);
    expect(details.querySelector("summary")!.textContent).toContain(`${shown}개 표시`);
    expect(JSON.parse(screen.getByTestId("payload").textContent ?? "{}").overrides).toContainEqual({ menu: "exams", role: "teacher", access: "none" });
  });

  it("🔴 기본으로 닫힌 칸(전자결재 · 직원 평가)도 체크하면 켜진다 — 강사 칸이 담당이 되어 저장에 실린다", () => {
    render(<PermissionsSection initial={EMPTY} />);
    for (const menu of ["approvals", "class_review"] as const) {
      const box = within(toggleCard()).getByRole("checkbox", { name: new RegExp(`^${MENU_LABEL[menu]}`), hidden: true }) as HTMLInputElement;
      expect(box.checked).toBe(false);
      fireEvent.click(box);
      expect(box.checked).toBe(true);
      expect(JSON.parse(screen.getByTestId("payload").textContent ?? "{}").overrides).toContainEqual({ menu, role: "teacher", access: "scoped" });
    }
  });

  it("'내 메뉴'에 서는 이름이 권한 이름과 다르면 그 이름을 함께 적는다(출석부 = 출결 모드 · 출석부)", () => {
    render(<PermissionsSection initial={EMPTY} />);
    const label = within(toggleCard()).getByRole("checkbox", { name: new RegExp(`^${MENU_LABEL.attendance}`), hidden: true }).closest("label")!;
    expect(label.textContent).toContain("출결 모드 · 출석부");
  });

  it("캘린더는 메뉴 구성에 없는 화면이라 '역할별 메뉴 권한' 표에도 없다(원장 2026-10-06 — 구성에 있는 화면의 권한만 세운다)", () => {
    render(<PermissionsSection initial={EMPTY} />);
    expect(within(menuTable()).queryByText(MENU_LABEL.calendar)).not.toBeInTheDocument();
  });
});

describe("배선 — 입구 정책은 navigation.ts의 순수 함수 하나", () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

  it("강사 '내 메뉴'(teacherMenuKeysFor)와 이 토글이 같은 함수(isTeacherMenuEntranceOpen)를 쓴다", () => {
    const nav = read("src", "lib", "navigation.ts");
    expect(nav).toMatch(/export function isTeacherMenuEntranceOpen\(/);
    const from = nav.indexOf("export function teacherMenuKeysFor(");
    expect(from).toBeGreaterThan(-1);
    expect(nav.slice(from, nav.indexOf("\n}", from))).toContain("isTeacherMenuEntranceOpen(");
    // 칸 목록은 칸 구성 모듈 한 곳에서 정하고(teacher-toggle-rows.ts), 화면은 그 목록만 그린다.
    expect(read("src", "features", "owner", "teacher-toggle-rows.ts")).toContain("TEACHER_MENU_KEYS.filter(isTeacherMenuEntranceOpen)");
    expect(read("src", "app", "(shell)", "owner", "_components", "teacher-menu-toggles.tsx")).toContain("teacherToggleRows(navigation)");
  });
});

describe("일반판 권한 설정", () => {
  const staff = [{ id: "11111111-1111-4111-8111-111111111111", name: "데모 강사", role: "teacher" }];
  const payload = () => JSON.parse(screen.getByTestId("payload").textContent ?? "{}");

  it("직원 한 명에게 메뉴 예외를 추가하고 해제할 수 있다", () => {
    render(<PermissionsSection initial={EMPTY} generic staffOptions={staff} />);
    fireEvent.change(screen.getByLabelText("직원 선택"), { target: { value: staff[0].id } });
    fireEvent.change(screen.getByLabelText("메뉴 선택"), { target: { value: "staff" } });
    fireEvent.click(screen.getByRole("button", { name: "추가·변경" }));
    expect(payload().userOverrides).toEqual([{ userId: staff[0].id, menu: "staff", access: "full" }]);
    fireEvent.click(screen.getByRole("button", { name: `데모 강사 ${MENU_LABEL.staff} 권한 제거` }));
    expect(payload().userOverrides).toEqual([]);
  });

  it("급여명세서 열람과 연차 조정을 별도 명단으로 저장한다", () => {
    render(<PermissionsSection initial={EMPTY} generic staffOptions={staff} />);
    fireEvent.change(screen.getByLabelText("급여명세서 열람 담당자 선택"), { target: { value: staff[0].id } });
    fireEvent.click(screen.getByRole("button", { name: "급여명세서 열람 담당자 추가" }));
    expect(payload().specialAccess.payslipViewerIds).toEqual([staff[0].id]);
    expect(payload().specialAccess.leaveAdjusterIds).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "데모 강사 급여명세서 열람 해제" }));
    expect(payload().specialAccess.payslipViewerIds).toEqual([]);
  });

  it("개인별 메뉴 권한 · 개인별 기능 권한은 어느 학원에서나 선다(원장 2026-10-06)", () => {
    render(<PermissionsSection initial={EMPTY} staffOptions={staff} />);
    expect(screen.getByRole("heading", { name: "개인별 기능 권한" })).toBeInTheDocument();
    // 수업 나누기 칸은 그 기능을 꺼 둔 동안 서지 않는다(아래 '꺼 둔 동안' 테스트).
    for (const label of ["급여명세서 열람", "연차 조정", ...(CLASS_SPLIT_ENABLED ? ["수업 나누기"] : [])]) {
      expect(screen.getByLabelText(`${label} 담당자 선택`)).toBeInTheDocument();
    }
    expect(screen.getByLabelText("과목 범위를 지정할 직원")).toBeInTheDocument();
    expect(screen.getByLabelText("직원 선택")).toBeInTheDocument();
  });

  it("운영자 계정은 선택·기존 예외·담당자에서 숨기고 지점 저장은 숨겨진 값을 보존한다", () => {
    const operator = { id: "22222222-2222-4222-8222-222222222222", name: "운영 계정", role: "master" };
    const hiddenOverride = { userId: operator.id, menu: "staff" as const, access: "full" as const };
    render(<PermissionsSection initial={{ ...EMPTY, userOverrides: [hiddenOverride], specialAccess: { payslipViewerIds: [operator.id], leaveAdjusterIds: [operator.id], classSplitterIds: [], staffSubjectScopes: [] } }}
      generic staffOptions={[...staff, operator]} hiddenUserIds={[operator.id]} />);
    expect(screen.queryByText(operator.name)).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: operator.name })).not.toBeInTheDocument();
    expect(screen.getByText("개인별 메뉴 권한 0건")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("직원 선택"), { target: { value: staff[0].id } });
    fireEvent.click(screen.getByRole("button", { name: "추가·변경" }));
    expect(payload().userOverrides).toContainEqual(hiddenOverride);
    expect(payload().userOverrides).toContainEqual({ userId: staff[0].id, menu: "staff", access: "full" });
    expect(payload().specialAccess).toEqual({ payslipViewerIds: [operator.id], payslipManagerIds: [operator.id], leaveAdjusterIds: [operator.id], classSplitterIds: [], staffSubjectScopes: [] });
  });
});

describe("개인별 기능 권한 — 사람을 지정해서 여는 기능을 한자리에서(원장 2026-10-06)", () => {
  const staff = [
    { id: "11111111-1111-4111-8111-111111111111", name: "가 선생", role: "admin" },
    { id: "22222222-2222-4222-8222-222222222222", name: "나 선생", role: "admin" },
  ];
  const subjects = [
    { key: "math", label: "수학", color: "blue" },
    { key: "english", label: "영어", color: "green" },
  ] as unknown as SubjectSetting[];
  const payload = () => JSON.parse(screen.getByTestId("payload").textContent ?? "{}");
  const view = (initial = EMPTY, extra: { disabledModules?: string[] } = {}) =>
    render(
      <OperationsProvider subjects={subjects} gradeLevels={[]} disabledModules={(extra.disabledModules ?? []) as never}>
        <PermissionsSection initial={initial} staffOptions={staff} />
      </OperationsProvider>,
    );

  it("담당자 칸은 서로 다른 명단이다 — 연차 조정에 넣어도 급여명세서는 그대로", () => {
    view();
    fireEvent.change(screen.getByLabelText("연차 조정 담당자 선택"), { target: { value: staff[0].id } });
    fireEvent.click(screen.getByRole("button", { name: "연차 조정 담당자 추가" }));
    expect(payload().specialAccess).toEqual({ payslipViewerIds: [], payslipManagerIds: [], leaveAdjusterIds: [staff[0].id], classSplitterIds: [], staffSubjectScopes: [] });
    fireEvent.click(screen.getByRole("button", { name: "가 선생 연차 조정 해제" }));
    expect(payload().specialAccess.leaveAdjusterIds).toEqual([]);
  });

  it("수강 날짜 수정은 기능 권한 맨 아래에서 따로 지정·해제한다", () => {
    view();
    const label = screen.getByText("수강 날짜 수정");
    const scope = screen.getByText("직원관리 과목 범위");
    expect(scope.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(screen.getByLabelText("수강 날짜 수정 담당자 선택"), { target: { value: staff[0].id } });
    fireEvent.click(screen.getByRole("button", { name: "수강 날짜 수정 담당자 추가" }));
    expect(payload().specialAccess.enrollmentDateEditorIds).toEqual([staff[0].id]);
    expect(payload().specialAccess.leaveAdjusterIds).toEqual([]);
    expect(payload().overrides).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "가 선생 수강 날짜 수정 해제" }));
    expect(payload().specialAccess.enrollmentDateEditorIds).toEqual([]);
  });

  it("🔴 수업 나누기를 꺼 둔 동안엔 그 칸이 없다 — 지정해 둔 사람은 그대로 실려 간다(다시 켜면 보인다)", () => {
    view({ ...EMPTY, specialAccess: { ...EMPTY.specialAccess, classSplitterIds: [staff[0].id] } } as typeof EMPTY);
    expect(Boolean(screen.queryByLabelText("수업 나누기 담당자 선택"))).toBe(CLASS_SPLIT_ENABLED);
    expect(payload().specialAccess.classSplitterIds).toEqual([staff[0].id]);
    // 다른 칸을 고쳐도 감춘 칸의 값은 빠지지 않는다.
    fireEvent.change(screen.getByLabelText("연차 조정 담당자 선택"), { target: { value: staff[1].id } });
    fireEvent.click(screen.getByRole("button", { name: "연차 조정 담당자 추가" }));
    expect(payload().specialAccess).toEqual({ payslipViewerIds: [], payslipManagerIds: [], leaveAdjusterIds: [staff[1].id], classSplitterIds: [staff[0].id], staffSubjectScopes: [] });
  });

  it("직원관리 과목 범위 — 과목은 학원 설정의 과목에서 고르고, 누른 차례가 아니라 설정 차례로 실린다", () => {
    view();
    const apply = screen.getByRole("button", { name: "범위 지정" });
    expect(apply).toBeDisabled();
    // 직원을 고르기 전에는 과목을 체크할 수 없다(고르는 순간 칸이 그 사람의 범위로 다시 잡힌다).
    expect(screen.getByRole("checkbox", { name: "영어" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("과목 범위를 지정할 직원"), { target: { value: staff[1].id } });
    expect(apply).toBeDisabled(); // 과목을 하나도 안 골랐다
    fireEvent.click(screen.getByRole("checkbox", { name: "영어" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "수학" }));
    fireEvent.click(apply);
    expect(payload().specialAccess.staffSubjectScopes).toEqual([{ userId: staff[1].id, subjects: ["math", "english"] }]);
    expect(screen.getByText("수학 · 영어")).toBeInTheDocument();
    // 같은 사람을 다시 고르면 **지금 범위에서 시작한다**(빈 칸에서 시작하면 과목 하나를 더하려다 기존 범위를 갈아끼운다).
    // 지정하면 줄이 늘지 않고 바뀐다.
    fireEvent.change(screen.getByLabelText("과목 범위를 지정할 직원"), { target: { value: staff[1].id } });
    expect(screen.getByRole("checkbox", { name: "수학" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "영어" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "수학" }));
    fireEvent.click(apply);
    expect(payload().specialAccess.staffSubjectScopes).toEqual([{ userId: staff[1].id, subjects: ["english"] }]);
    // 범위가 없는 사람을 고르면 빈 칸에서 시작한다.
    fireEvent.change(screen.getByLabelText("과목 범위를 지정할 직원"), { target: { value: staff[0].id } });
    expect(screen.getByRole("checkbox", { name: "영어" })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("과목 범위를 지정할 직원"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "나 선생 직원관리 과목 범위 해제" }));
    expect(payload().specialAccess.staffSubjectScopes).toEqual([]);
  });

  it("범위 목록은 과목별로 묶어 칩으로 나열한다 — 한 사람은 한 칩, 묶음은 학원 설정의 과목 차례(원장 2026-10-07)", () => {
    const { unmount } = view({ ...EMPTY, specialAccess: { ...EMPTY.specialAccess, staffSubjectScopes: [
      { userId: staff[0].id, subjects: ["english"] }, { userId: staff[1].id, subjects: ["math"] },
    ] } } as typeof EMPTY);
    const group = (label: string) => screen.getByText(label, { selector: "li > span" }).closest("li")!;
    // 저장 차례(영어 먼저)가 아니라 설정의 과목 차례(수학 → 영어)로 선다.
    expect([...group("수학").parentElement!.querySelectorAll("li > span:first-child")].map((el) => el.textContent)).toEqual(["수학", "영어"]);
    expect(within(group("수학")).getByRole("button", { name: "나 선생 직원관리 과목 범위 해제" })).toBeInTheDocument();
    expect(within(group("영어")).getByRole("button", { name: "가 선생 직원관리 과목 범위 해제" })).toBeInTheDocument();
    unmount();
    // 같은 과목은 한 묶음에 나란히, 여러 과목을 보는 사람은 그 조합의 묶음에.
    view({ ...EMPTY, specialAccess: { ...EMPTY.specialAccess, staffSubjectScopes: [
      { userId: staff[0].id, subjects: ["math", "english"] }, { userId: staff[1].id, subjects: ["math"] },
    ] } } as typeof EMPTY);
    expect(within(group("수학")).getAllByRole("button")).toHaveLength(1);
    expect(within(group("수학 · 영어")).getByRole("button", { name: "가 선생 직원관리 과목 범위 해제" })).toBeInTheDocument();
  });

  it("없어진 과목은 내부 키를 보이지 않는다 — 줄은 남아 있고 거둘 수 있다", () => {
    view({ ...EMPTY, specialAccess: { ...EMPTY.specialAccess, staffSubjectScopes: [{ userId: staff[0].id, subjects: ["math", "subject_9"] }] } } as typeof EMPTY);
    expect(screen.getByText("수학 · (없어진 과목)")).toBeInTheDocument();
    expect(screen.getByText("수학 · (없어진 과목)").closest("li")?.textContent).not.toContain("subject_9");
    expect(screen.getByRole("button", { name: "가 선생 직원관리 과목 범위 해제" })).toBeInTheDocument();
  });

  it("🔴 원장 역할은 지정 대상이 아니다 — 직원 고르기에 서지 않는다(지정 없이 전부 통과한다)", () => {
    const owner = { id: "44444444-4444-4444-8444-444444444444", name: "원장 선생", role: "master" };
    render(
      <OperationsProvider subjects={subjects} gradeLevels={[]}>
        <PermissionsSection initial={{ ...EMPTY, specialAccess: { ...EMPTY.specialAccess, payslipViewerIds: [owner.id] } } as typeof EMPTY} staffOptions={[...staff, owner]} />
      </OperationsProvider>,
    );
    for (const label of ["급여명세서 열람 담당자 선택", "연차 조정 담당자 선택", "과목 범위를 지정할 직원"]) {
      const select = screen.getByLabelText(label);
      expect(within(select).queryByRole("option", { name: owner.name })).not.toBeInTheDocument();
      expect(within(select).getByRole("option", { name: staff[1].name })).toBeInTheDocument();
    }
    // 이미 지정돼 있던 원장 줄은 보이고 거둘 수 있다(지정이 없어도 통과하므로 거둬도 잃는 것이 없다).
    fireEvent.click(screen.getByRole("button", { name: "원장 선생 급여명세서 열람 해제" }));
    expect(payload().specialAccess.payslipViewerIds).toEqual([]);
    expect(screen.getByText(/원장은 지정하지 않아도 전부 할 수 있습니다/)).toBeInTheDocument();
  });

  it("급여 기능이 꺼진 학원엔 급여명세서 칸이 없다 — 저장값은 그대로 실려 간다", () => {
    view({ ...EMPTY, specialAccess: { ...EMPTY.specialAccess, payslipViewerIds: [staff[0].id] } } as typeof EMPTY, { disabledModules: ["payroll"] });
    expect(screen.queryByLabelText("급여명세서 열람 담당자 선택")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("급여명세서 관리 담당자 선택")).not.toBeInTheDocument();
    expect(screen.getByLabelText("연차 조정 담당자 선택")).toBeInTheDocument();
    expect(payload().specialAccess.payslipViewerIds).toEqual([staff[0].id]);
    expect(payload().specialAccess.payslipManagerIds).toEqual([staff[0].id]);
    fireEvent.change(screen.getByLabelText("연차 조정 담당자 선택"), { target: { value: staff[1].id } });
    fireEvent.click(screen.getByRole("button", { name: "연차 조정 담당자 추가" }));
    expect(payload().specialAccess.payslipManagerIds).toEqual([staff[0].id]);
  });

  it("새 열람자는 조회·인쇄만, 관리자는 열람 명단에 중복 지정하지 않는다", () => {
    view();
    fireEvent.change(screen.getByLabelText("급여명세서 열람 담당자 선택"), { target: { value: staff[0].id } });
    fireEvent.click(screen.getByRole("button", { name: "급여명세서 열람 담당자 추가" }));
    expect(payload().specialAccess.payslipManagerIds).toEqual([]);
    fireEvent.change(screen.getByLabelText("급여명세서 관리 담당자 선택"), { target: { value: staff[1].id } });
    fireEvent.click(screen.getByRole("button", { name: "급여명세서 관리 담당자 추가" }));
    expect(payload().specialAccess.payslipViewerIds).toEqual([staff[0].id]);
    expect(payload().specialAccess.payslipManagerIds).toEqual([staff[1].id]);
    expect(screen.getByText(/조회·인쇄할 수 있는 사람/)).toBeInTheDocument();
    expect(screen.getByText(/열람을 포함해 조정 저장·발행·발행취소/)).toBeInTheDocument();
    expect(screen.queryByText(/슈퍼관리자|슈퍼어드민|super_admin|총괄/)).not.toBeInTheDocument();
  });

  it("운영자 계정의 지정은 화면에 세우지 않고 그대로 실어 보낸다", () => {
    const operator = { id: "33333333-3333-4333-8333-333333333333", name: "운영 계정", role: "master" };
    const special = { payslipViewerIds: [operator.id], leaveAdjusterIds: [], classSplitterIds: [operator.id], staffSubjectScopes: [{ userId: operator.id, subjects: ["math"] }] };
    render(
      <OperationsProvider subjects={subjects} gradeLevels={[]}>
        <PermissionsSection initial={{ ...EMPTY, specialAccess: special } as typeof EMPTY} staffOptions={[...staff, operator]} hiddenUserIds={[operator.id]} />
      </OperationsProvider>,
    );
    expect(screen.queryByText(operator.name)).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: operator.name })).not.toBeInTheDocument();
    expect(screen.getByText("범위가 지정된 직원 없음")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("연차 조정 담당자 선택"), { target: { value: staff[0].id } });
    fireEvent.click(screen.getByRole("button", { name: "연차 조정 담당자 추가" }));
    expect(payload().specialAccess).toEqual({ ...special, payslipManagerIds: [operator.id], leaveAdjusterIds: [staff[0].id] });
  });
});

describe("개인별 메뉴 권한 — 역할 표 아래에서 주고 거둔다(원장 2026-10-06)", () => {
  const staff = [
    { id: "11111111-1111-4111-8111-111111111111", name: "데모 강사", role: "teacher" },
    { id: "33333333-3333-4333-8333-333333333333", name: "데모 데스크", role: "admin" },
  ];
  const payload = () => JSON.parse(screen.getByTestId("payload").textContent ?? "{}");

  it("🔴 침산에서도 준다 — 직원 · 메뉴 · 수준을 골라 추가하면 저장 요청에 실린다", () => {
    render(<PermissionsSection initial={EMPTY} staffOptions={staff} />);
    fireEvent.change(screen.getByLabelText("직원 선택"), { target: { value: staff[1]!.id } });
    fireEvent.change(screen.getByLabelText("메뉴 선택"), { target: { value: "class_review" } });
    fireEvent.change(screen.getByLabelText("접근 수준"), { target: { value: "readonly" } });
    fireEvent.click(screen.getByRole("button", { name: "추가·변경" }));
    expect(payload().userOverrides).toEqual([{ userId: staff[1]!.id, menu: "class_review", access: "readonly" }]);
    expect(screen.getByText("개인별 메뉴 권한 1건")).toBeInTheDocument();
  });

  it("🔴 이미 준 권한은 × 버튼으로 거둔다 — 한 줄만 빠지고 나머지는 그대로다", () => {
    const rows = [
      { userId: staff[0]!.id, menu: "staff" as const, access: "full" as const },
      { userId: staff[1]!.id, menu: "class_review" as const, access: "full" as const },
    ];
    render(<PermissionsSection initial={{ ...EMPTY, userOverrides: rows }} staffOptions={staff} />);
    fireEvent.click(screen.getByRole("button", { name: `데모 강사 ${MENU_LABEL.staff} 권한 제거` }));
    expect(payload().userOverrides).toEqual([rows[1]]);
    expect(screen.getByText("개인별 메뉴 권한 1건")).toBeInTheDocument();
  });

  it("같은 사람의 같은 메뉴를 다시 주면 줄이 늘지 않고 값만 바뀐다", () => {
    render(<PermissionsSection initial={{ ...EMPTY, userOverrides: [{ userId: staff[1]!.id, menu: "staff", access: "full" }] }} staffOptions={staff} />);
    fireEvent.change(screen.getByLabelText("직원 선택"), { target: { value: staff[1]!.id } });
    fireEvent.change(screen.getByLabelText("접근 수준"), { target: { value: "readonly" } });
    fireEvent.click(screen.getByRole("button", { name: "추가·변경" }));
    expect(payload().userOverrides).toEqual([{ userId: staff[1]!.id, menu: "staff", access: "readonly" }]);
  });

  it("역할 전용 화면(선생님 원스크린 · 내 학습)은 고를 수 없고, 강사에게는 대시보드를 줄 수 없다", () => {
    render(<PermissionsSection initial={EMPTY} staffOptions={staff} />);
    const menus = () => within(screen.getByLabelText("메뉴 선택")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(menus()).not.toContain("teacher_onescreen");
    expect(menus()).not.toContain("my_learning");
    expect(menus()).toContain("dashboard");
    fireEvent.change(screen.getByLabelText("직원 선택"), { target: { value: staff[0]!.id } });
    expect(menus()).not.toContain("dashboard");
  });

  it("🔴 직원을 바꿔 골라 둔 메뉴를 줄 수 없게 되면 보이는 메뉴로 맞춘다 — 보이는 값과 추가되는 값이 같다", () => {
    render(<PermissionsSection initial={EMPTY} staffOptions={staff} />);
    const menu = () => screen.getByLabelText("메뉴 선택") as HTMLSelectElement;
    fireEvent.change(menu(), { target: { value: "dashboard" } });
    fireEvent.change(screen.getByLabelText("직원 선택"), { target: { value: staff[0]!.id } });
    // 강사에게는 대시보드를 줄 수 없다 → 목록의 첫 메뉴가 선택돼 보이고, 추가 버튼도 그 메뉴로 살아 있다.
    expect(menu().value).not.toBe("dashboard");
    const shown = menu().value;
    const add = screen.getByRole("button", { name: "추가·변경" }) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    expect(payload().userOverrides).toEqual([{ userId: staff[0]!.id, menu: shown, access: "full" }]);
  });

  it("직원 평가를 개인에게 줄 때는 함께 열리는 것을 알린다(강사 · '없음'일 때는 알리지 않는다)", () => {
    render(<PermissionsSection initial={EMPTY} staffOptions={staff} />);
    const note = () => screen.queryByText(/평가자 실명이 보이고/);
    expect(note()).toBeNull();
    fireEvent.change(screen.getByLabelText("직원 선택"), { target: { value: staff[1]!.id } });
    fireEvent.change(screen.getByLabelText("메뉴 선택"), { target: { value: "class_review" } });
    expect(note()).not.toBeNull();
    fireEvent.change(screen.getByLabelText("접근 수준"), { target: { value: "none" } });
    expect(note()).toBeNull();
    fireEvent.change(screen.getByLabelText("접근 수준"), { target: { value: "readonly" } });
    fireEvent.change(screen.getByLabelText("직원 선택"), { target: { value: staff[0]!.id } });
    expect(note()).toBeNull();
  });

  it("이미 준 줄의 수준을 바꿀 때 그 사람의 역할에서 잠긴 수준은 고를 수 없다", () => {
    const master = { id: "55555555-5555-4555-8555-555555555555", name: "데모 원장", role: "master" };
    render(<PermissionsSection initial={{ ...EMPTY, userOverrides: [{ userId: master.id, menu: "owner", access: "full" }] }} staffOptions={[...staff, master]} />);
    const options = within(screen.getByLabelText(`데모 원장 ${MENU_LABEL.owner} 권한`)).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(options).not.toContain("none");
    expect(options).toContain("full");
  });

  it("메뉴 고르기의 묶음 = 위 표의 묶음(왼쪽 탭)", () => {
    render(<PermissionsSection initial={EMPTY} staffOptions={staff} />);
    const groups = [...screen.getByLabelText("메뉴 선택").querySelectorAll("optgroup")].map((g) => g.label);
    expect(groups.slice(0, 4)).toEqual(["대시보드", "수업", "원생", "상담·재원"]);
  });
});

describe("역할별 메뉴 권한 표 — 줄은 왼쪽 탭과 그 내부 메뉴 차례", () => {
  /** 표의 줄 이름을 위에서부터 — 탭 줄은 탭 이름, 권한 줄은 권한 이름. */
  const rowLabels = () =>
    [...menuTable().querySelectorAll("tbody tr")].map((tr) => (tr.querySelector("th span, td span.truncate")?.textContent ?? "").trim());

  it("탭 줄 아래에 그 탭의 메뉴가 선다 — 수업 → 시간표 … / 원생 → 원생목록 …", () => {
    render(<PermissionsSection initial={EMPTY} />);
    const labels = rowLabels();
    expect(labels.indexOf("수업")).toBeGreaterThan(-1);
    expect(labels.indexOf("수업")).toBeLessThan(labels.indexOf(MENU_LABEL.timetable));
    expect(labels.indexOf(MENU_LABEL.timetable)).toBeLessThan(labels.indexOf("원생"));
    expect(labels.indexOf("원생")).toBeLessThan(labels.indexOf(MENU_LABEL.students));
    expect(labels.indexOf(MENU_LABEL.students)).toBeLessThan(labels.indexOf("상담·재원"));
  });

  it("탭 하나가 권한 하나면 줄도 하나다(같은 이름을 두 번 세우지 않는다) — 대시보드 · 수납관리 · 회의록", () => {
    render(<PermissionsSection initial={EMPTY} />);
    const table = within(menuTable());
    for (const menu of ["dashboard", "billing", "meetings"] as const) expect(table.getAllByText(MENU_LABEL[menu])).toHaveLength(1);
  });

  it("맨 첫 줄만 윗선을 그리지 않는다(머리 줄의 아랫선과 겹친다) — 그 아래 묶음 띠 · 줄의 윗선은 그대로다", () => {
    render(<PermissionsSection initial={EMPTY} />);
    const rows = [...menuTable().querySelectorAll("tbody tr")];
    expect(rows[0]!.className).not.toContain("border-t");
    for (const tr of rows.slice(1)) expect(tr.className).toContain("border-t");
  });

  it("탭 및 메뉴 구성에 있는 화면의 권한이 한 줄씩 있고, 줄마다 역할 수만큼 칸이 있다", () => {
    render(<PermissionsSection initial={EMPTY} />);
    const rows = [...menuTable().querySelectorAll("tbody tr")].filter((tr) => tr.querySelector("button"));
    // 전체 권한에서 메뉴에 없는 화면(캘린더 · 관리자 도구)과 역할 전용 화면 둘, 연결 앱(아래 '연결 앱 권한' 표)을 뺀 수.
    expect(rows).toHaveLength(editablePermissionRowGroups().flatMap((g) => g.rows).filter((row) => !(SETTINGS_ROLE_KEYS as readonly string[]).includes(row.menu)).length);
    expect(rows).toHaveLength(Object.keys(MENU_LABEL).length - 4 - CONNECTED_APP_MENU_KEYS.length - SETTINGS_ROLE_KEYS.length);
    for (const tr of rows) expect(tr.querySelectorAll("button")).toHaveLength(SYSTEM_ROLES.length);
  });

  it("🔴 숨긴 줄의 저장값은 저장해도 지워지지 않는다 — 표는 줄을 안 세울 뿐 값 전체를 들고 저장한다", () => {
    render(<PermissionsSection initial={{ ...EMPTY, overrides: [{ menu: "calendar", role: "teacher", access: "none" }, { menu: "staff", role: "admin", access: "none" }] } as typeof EMPTY} />);
    const sent = JSON.parse(screen.getByTestId("payload").textContent ?? "{}").overrides as { menu: string; role: string; access: string }[];
    expect(sent).toContainEqual({ menu: "calendar", role: "teacher", access: "none" });
    expect(sent).toContainEqual({ menu: "staff", role: "admin", access: "none" });
  });

  it("🔴 표에 없는 줄의 칸이 바뀌어도 '저장 전 변경'에 적힌다 — 감춘 메뉴의 강사 칸은 '내 메뉴' 표시로 바뀐다", () => {
    // 강사뷰에서 교재 요청을 감췄다 → 표에는 그 줄이 없지만 위 '강사 내 메뉴 표시' 칸은 남아 있다.
    render(<PermissionsSection initial={EMPTY} navigation={{ teacherMenus: [{ href: "/textbook-requests", hidden: true }] }} />);
    expect(within(menuTable()).queryByText(MENU_LABEL.textbook_requests)).not.toBeInTheDocument();
    expect(screen.queryByText(/저장 전 변경/)).not.toBeInTheDocument();
    fireEvent.click(within(toggleCard()).getByRole("checkbox", { name: new RegExp(`^${MENU_LABEL.textbook_requests}`), hidden: true }));
    const list = screen.getByText(/저장 전 변경 1개/).closest("details") as HTMLElement;
    expect(list.textContent).toContain(MENU_LABEL.textbook_requests);
    expect(JSON.parse(screen.getByTestId("payload").textContent ?? "{}").overrides).toContainEqual({ menu: "textbook_requests", role: "teacher", access: "none" });
  });

  it("🔴 선생님 원스크린 · 내 학습 줄은 표에 없다 — 어느 역할의 칸도 바꿀 수 없는 줄이다(원장 2026-10-06)", () => {
    render(<PermissionsSection initial={EMPTY} />);
    const table = within(menuTable());
    expect(table.queryByText(MENU_LABEL.teacher_onescreen)).not.toBeInTheDocument();
    expect(table.queryByText(MENU_LABEL.my_learning)).not.toBeInTheDocument();
    // 다른 줄은 그대로다.
    expect(table.getByText(MENU_LABEL.staff)).toBeInTheDocument();
  });

  it("머리 줄(역할 이름)은 표 밖에 따로 서서 화면 위에 붙는다 — 본문 표와 같은 칸 폭 규칙을 쓴다", () => {
    const { container } = render(<PermissionsSection initial={EMPTY} />);
    const head = container.querySelector("thead")!.closest<HTMLElement>('[aria-hidden="true"]')!;
    expect(head.className).toContain("sticky");
    expect(head.className).toContain("top-0");
    // 본문 표와 같은 표 상자 안에 있다(붙는 범위 = 표가 화면에 걸쳐 있는 동안).
    expect(head.parentElement!.contains(menuTable())).toBe(true);
    expect([...head.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["메뉴", "원장", "관리자", "실장", "강사", "상담", "회계", "열람", "아르바이트", "학생"]);
    const cols = [...container.querySelectorAll("colgroup")].map((g) => g.querySelectorAll("col").length);
    expect(cols).toEqual(Array(4).fill(SYSTEM_ROLES.length + 1));
  });
});

describe("설정별 역할 권한 통합", () => {
  it("역할별 메뉴·설정 권한 다음에 개인별 메뉴·기능 권한을 표시하고 함께 저장한다", () => {
    render(<PermissionsSection initial={{ ...EMPTY, overrides: [{ menu: "report_settings", role: "teacher", access: "readonly" }] }} />);
    const card = screen.getByRole("heading", { name: "설정별 역할 권한" }).closest("section")!;
    expect(within(menuTable()).queryByText(MENU_LABEL.report_settings)).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: MENU_LABEL.report_settings + " · 강사: 읽기" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: /^(역할별 메뉴 권한|설정별 역할 권한|개인별 메뉴 권한|개인별 기능 권한)/ })
      .map((heading) => heading.textContent?.replace(/\s+\d+건$/, "")))
      .toEqual(["역할별 메뉴 권한", "설정별 역할 권한", "개인별 메뉴 권한", "개인별 기능 권한"]);
    fireEvent.click(within(card).getByRole("button", { name: MENU_LABEL.report_settings + " · 강사: 읽기" }));
    const overrides = JSON.parse(screen.getByTestId("payload").textContent ?? "{}").overrides;
    expect(resolveMatrix(overrides).report_settings.teacher).toBe("none");
    expect(within(card).getAllByRole("button")).toHaveLength(SETTINGS_ROLE_KEYS.length * SYSTEM_ROLES.length);
  });
  it("사용하지 않는 설정은 감춰도 저장값을 보존한다", () => {
    render(<PermissionsSection initial={{ ...EMPTY, overrides: [{ menu: "ai_ment", role: "admin", access: "readonly" }] }} hiddenSettingKeys={["ai_ment", "payroll_settings"]} />);
    const card = screen.getByRole("heading", { name: "설정별 역할 권한" }).closest("section")!;
    expect(within(card).queryByText(MENU_LABEL.ai_ment)).not.toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId("payload").textContent ?? "{}").overrides).toContainEqual({ menu: "ai_ment", role: "admin", access: "readonly" });
  });
});

describe("연결 앱 권한 — 역할별 메뉴 권한 아래 · 이 지점에서 켠 앱만(원장 2026-11-05)", () => {
  const apps = [{ permission: "app_todays_math" as const, label: "오늘 수학" }];
  const appCard = () => screen.getByRole("heading", { name: "연결 앱 권한" }).closest("section") as HTMLElement;
  const cell = (role: (typeof SYSTEM_ROLES)[number], access: string) =>
    within(appCard()).getByRole("button", { name: `오늘 수학 · ${ROLE_LABEL[role]}: ${access}` });
  const savedOverrides = () => JSON.parse(screen.getByTestId("payload").textContent ?? "{}").overrides;

  it("켠 앱이 없으면 카드도 없다(꺼진 기능은 있었는지조차 모르게)", () => {
    render(<PermissionsSection initial={EMPTY} />);
    expect(screen.queryByRole("heading", { name: "연결 앱 권한" })).not.toBeInTheDocument();
  });

  it("역할별 메뉴 권한 바로 아래에 서고, 역할별 표에는 연결 앱 줄이 없다", () => {
    render(<PermissionsSection initial={EMPTY} connectedApps={apps} />);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings.indexOf("연결 앱 권한")).toBe(headings.indexOf("역할별 메뉴 권한") + 1);
    // 줄 이름이 '오늘 수학(연결 앱)'이어도 잡히게 글자 일부로 찾는다.
    expect(within(menuTable()).queryByText(/오늘 수학/)).not.toBeInTheDocument();
    expect(within(appCard()).getByRole("table")).toBeInTheDocument();
  });

  it("처음 값 = 강사 이상(원장·관리자·매니저·강사) 전체 · 상담·회계·열람·아르바이트 없음(원장 2026-11-05)", () => {
    render(<PermissionsSection initial={EMPTY} connectedApps={apps} />);
    for (const role of ["master", "admin", "manager", "teacher"] as const) expect(cell(role, "전체")).toBeInTheDocument();
    for (const role of ["counselor", "accountant", "viewer", "parttime"] as const) expect(cell(role, "없음")).toBeInTheDocument();
  });

  it("🔴 칸은 전체 ↔ 없음만 돈다 — 담당·읽기를 건너뛰고, 역할별 표와 같은 저장에 실린다", () => {
    render(<PermissionsSection initial={EMPTY} connectedApps={apps} />);
    fireEvent.click(cell("teacher", "전체"));
    expect(cell("teacher", "없음")).toBeInTheDocument();
    expect(savedOverrides()).toContainEqual({ menu: "app_todays_math", role: "teacher", access: "none" });
    fireEvent.click(cell("teacher", "없음"));
    expect(cell("teacher", "전체")).toBeInTheDocument();
    fireEvent.click(cell("parttime", "없음"));
    expect(cell("parttime", "전체")).toBeInTheDocument();
    expect(savedOverrides()).toContainEqual({ menu: "app_todays_math", role: "parttime", access: "full" });
    expect(savedOverrides()).not.toContainEqual(expect.objectContaining({ menu: "app_todays_math", role: "teacher" }));
  });

  it("연결 앱 칸의 바뀐 수는 이 카드 제목 줄에 센다 — 역할별 카드의 '저장하지 않은 칸'·'저장 전 변경'·기본값 셀 수에 섞지 않는다(리뷰 2026-11-05)", () => {
    render(<PermissionsSection initial={EMPTY} connectedApps={apps} />);
    fireEvent.click(cell("teacher", "전체"));
    expect(within(appCard()).getByText(/저장하지 않은 칸 1개/)).toBeInTheDocument();
    const roleCard = screen.getByRole("heading", { name: "역할별 메뉴 권한" }).closest("details") as HTMLElement;
    expect(within(roleCard).queryByText(/저장하지 않은 칸/)).not.toBeInTheDocument();
    expect(screen.queryByText(/저장 전 변경/)).not.toBeInTheDocument();
    expect(within(roleCard).getByText(/기본값과 다른 셀 0개/)).toBeInTheDocument();
    // 저장에는 그대로 실린다(두 카드가 한 저장).
    expect(savedOverrides()).toContainEqual({ menu: "app_todays_math", role: "teacher", access: "none" });
  });

  it("두 카드 모두 접고 펼칠 수 있다 — 처음엔 지금처럼 펼친 채(원장 *\"역할별하고 연동앱 권한도 접기 펼치기\"*)", () => {
    render(<PermissionsSection initial={EMPTY} connectedApps={apps} />);
    for (const name of ["역할별 메뉴 권한", "연결 앱 권한"]) {
      const details = screen.getByRole("heading", { name }).closest("details");
      expect(details, name).not.toBeNull();
      expect(details!.open, name).toBe(true);
    }
  });
});
