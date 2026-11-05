import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeLockedNote } from "@/lib/write-lock";

/**
 * 자리 PIN — 편집자 마스킹·자동완성 방지, 읽기 전용 열람자에겐 값 미전송(2026-10-03 운영점검 합의 A15).
 * **실제 섹션 폼**(숨은 JSON 입력 포함)으로 그린다 — 값이 새는 자리는 보이는 칸이 아니라 그 숨은 입력이다.
 * 합성 값으로 검증한다(실제 PIN·기본값은 적지 않는다).
 */
vi.mock("@/features/owner/server/actions", () => ({ saveOwnerSection: vi.fn() }));
vi.mock("@/features/owner/server/subject-actions", () => ({
  absorbSubject: vi.fn(),
  getSubjectUsage: vi.fn(),
  removeUnusedSubject: vi.fn(),
}));
vi.mock("@/components/workspace/use-concurrent-edit-guard", () => ({
  useConcurrentEditGuard: () => ({ notifySaved: () => undefined, rebaseline: () => undefined }),
}));
vi.mock("@/components/workspace/use-unsaved-guard", () => ({ useUnsavedGuard: () => ({ markSaved: () => undefined }) }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => false }));
vi.mock("@/features/owner/navigation-context", () => ({ useNavigationSettings: () => ({ tenantId: "tenant" }) }));
vi.mock("@/lib/realtime/record-channel", () => ({ publishRecordSaved: vi.fn() }));
vi.mock("@/components/forms/form-action-bar", () => ({
  FormActionBar: ({ children }: { children: ReactNode }) => <div data-testid="action-bar">{children}</div>,
}));
vi.mock("./classroom-manager", () => ({ ClassroomManager: () => null }));
vi.mock("./subject-session-editor", () => ({ SubjectSessionEditor: () => null }));

import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import type { OperationsSettings } from "@/features/owner/settings-types";
import { operationsForViewer, seatPinStatus } from "@/features/owner/seat-pin-view";
import { OperationsSection } from "./operations-section";
import { SubjectsSection } from "./subjects-section";

const SYNTHETIC_LAB = "Zq7!labPIN";
const SYNTHETIC_JJ = "Xk3#jjPIN";
const operations = (pins: Partial<OperationsSettings["seatPins"]> = {}): OperationsSettings => ({
  ...DEFAULT_SETTINGS.operations,
  seatPins: { lab: SYNTHETIC_LAB, jj: SYNTHETIC_JJ, ...pins },
});
const payloadOf = (container: HTMLElement) =>
  JSON.parse((container.querySelector('input[type="hidden"][name="data"]') as HTMLInputElement).value) as OperationsSettings;

afterEach(cleanup);

describe("운영 체계 면 — 읽기 전용 열람자", () => {
  const renderReadOnly = (ops = operations()) =>
    render(
      <OperationsSection
        initial={operationsForViewer(ops, false)}
        classrooms={[]}
        readOnly
        seatPinStatus={seatPinStatus(ops)}
      />,
    );

  it("🔴 HTML 전체(보이는 칸 + 숨은 payload)에 합성 PIN 문자열이 없다", () => {
    const { container } = renderReadOnly();
    expect(container.innerHTML).not.toContain(SYNTHETIC_LAB);
    expect(container.innerHTML).not.toContain(SYNTHETIC_JJ);
    const hidden = container.querySelector('input[type="hidden"][name="data"]') as HTMLInputElement;
    expect(hidden.value).not.toContain(SYNTHETIC_LAB);
    expect(hidden.value).not.toContain(SYNTHETIC_JJ);
  });

  it("PIN 칸이 없고 '설정됨 / 꺼짐'만 선다", () => {
    const { container } = renderReadOnly(operations({ jj: "" }));
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByLabelText(/비밀번호$/)).toBeNull();
    expect(screen.getByText("랩실(603호)").parentElement?.textContent).toContain("설정됨");
    expect(screen.getByText("JJ실(305호)").parentElement?.textContent).toContain("꺼짐");
  });

  it("저장 바가 없다 — 지운 payload를 제출할 버튼이 없다", () => {
    const { container } = renderReadOnly();
    expect(screen.queryByTestId("action-bar")).toBeNull();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    // 읽기 권한 안내 = 공통 문구(원장 2026-11-05, src/lib/write-lock.ts) — 막은 권한 키(운영 설정)를 적는다.
    expect(screen.getByText(writeLockedNote("operations_settings"))).toBeInTheDocument();
  });
});

describe("운영 체계 면 — 편집자", () => {
  const renderEditor = () => render(<OperationsSection initial={operations()} classrooms={[]} />);

  it("두 칸 모두 기본 마스킹(type=password)이고 눈 버튼으로만 잠깐 보인다", () => {
    renderEditor();
    const lab = screen.getByLabelText("랩실(603호) 비밀번호") as HTMLInputElement;
    const jj = screen.getByLabelText("JJ실(305호) 비밀번호") as HTMLInputElement;
    expect(lab.type).toBe("password");
    expect(jj.type).toBe("password");
    expect(lab.value).toBe(SYNTHETIC_LAB);
    fireEvent.click(screen.getAllByRole("button", { name: "비밀번호 표시" })[0]!);
    expect(lab.type).toBe("text");
    expect(jj.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 숨기기" }));
    expect(lab.type).toBe("password");
  });

  it("🔴 자동완성 방지 — 저장해 둔 로그인 비밀번호가 채워지지 않게 하는 속성이 붙어 있다", () => {
    renderEditor();
    for (const label of ["랩실(603호) 비밀번호", "JJ실(305호) 비밀번호"]) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.getAttribute("autocomplete")).toBe("new-password");
      expect(input.hasAttribute("data-1p-ignore")).toBe(true);
      expect(input.getAttribute("data-lpignore")).toBe("true");
      expect(input.getAttribute("data-bwignore")).toBe("true");
      expect(input.getAttribute("data-form-type")).toBe("other");
      // 로그인 칸으로 읽힐 단서(name)를 주지 않는다.
      expect(input.hasAttribute("name")).toBe(false);
      expect(input.maxLength).toBe(12);
      // 자리 표시 문구가 기본값을 드러내지 않는다.
      expect(input.placeholder).not.toMatch(/\d/);
    }
  });

  it("라벨이 입력에만 이어져 있다 — 눈 버튼 이름이 칸 이름에 섞이지 않는다", () => {
    renderEditor();
    const input = screen.getByLabelText("랩실(603호) 비밀번호");
    // 입력이 <label>로 감싸여 있으면 그 안의 버튼 이름까지 칸 이름이 된다.
    expect(input.closest("label")).toBeNull();
    const label = document.querySelector(`label[for="${input.id}"]`)!;
    expect(label.textContent).toBe("랩실(603호) 비밀번호");
    expect(label.querySelector("button")).toBeNull();
    const hint = document.getElementById(input.getAttribute("aria-describedby")!)!;
    expect(hint.textContent).toContain("/seat/lab");
  });

  it("칸을 고치면 그 값만 바뀌고 다른 자리 값은 그대로 payload에 실린다(비우기 포함)", () => {
    const { container } = renderEditor();
    fireEvent.change(screen.getByLabelText("JJ실(305호) 비밀번호"), { target: { value: "" } });
    expect(payloadOf(container).seatPins).toEqual({ lab: SYNTHETIC_LAB, jj: "" });
    fireEvent.change(screen.getByLabelText("랩실(603호) 비밀번호"), { target: { value: "N3w!pin" } });
    expect(payloadOf(container).seatPins).toEqual({ lab: "N3w!pin", jj: "" });
  });

  it("저장 바가 있다(편집 저장은 종전 그대로)", () => {
    const { container } = renderEditor();
    expect(screen.getByTestId("action-bar")).toBeInTheDocument();
    expect(container.querySelector('button[type="submit"]')).not.toBeNull();
  });
});

describe("과목 운영 면 — 같은 운영 섹션을 통째로 싣는다", () => {
  it("🔴 읽기 전용 열람자: HTML·숨은 payload에 합성 PIN이 없고 저장 바도 없다", () => {
    const ops = operations();
    const { container } = render(
      <SubjectsSection initial={operationsForViewer(ops, false)} sessionYear={2026} readOnly />,
    );
    expect(container.innerHTML).not.toContain(SYNTHETIC_LAB);
    expect(container.innerHTML).not.toContain(SYNTHETIC_JJ);
    expect(screen.queryByTestId("action-bar")).toBeNull();
  });

  it("편집자: 과목만 고쳐도 payload의 PIN은 그대로다(저장 시 보존)", () => {
    const ops = operations();
    const { container } = render(<SubjectsSection initial={ops} sessionYear={2026} />);
    expect(payloadOf(container).seatPins).toEqual({ lab: SYNTHETIC_LAB, jj: SYNTHETIC_JJ });
    // 과목명 하나를 고친다 — 운영 섹션의 다른 칸(PIN)은 건드리지 않는다.
    const firstLabel = ops.subjects[0]!.label;
    const input = [...container.querySelectorAll("input")].find(
      (el) => el.type !== "hidden" && el.value === firstLabel,
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: `${firstLabel}X` } });
    const after = payloadOf(container);
    expect(after.subjects[0]!.label).toBe(`${firstLabel}X`);
    expect(after.seatPins).toEqual({ lab: SYNTHETIC_LAB, jj: SYNTHETIC_JJ });
    expect(screen.getByTestId("action-bar")).toBeInTheDocument();
  });
});
