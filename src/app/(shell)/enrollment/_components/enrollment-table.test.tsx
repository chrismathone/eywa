import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSIGNED_DRAG_BLOCKED,
  ASSIGNED_LABEL,
  BOARD_STAGES,
  QR_INTAKE_LABEL,
} from "@/features/enrollment/board-stages";
import type { ConsultationTableRow } from "@/features/enrollment/server/queries";
import { EnrollmentTable } from "./enrollment-table";
import { EDIT_CELL_TITLE } from "./sheet-editable-cells";

/**
 * 시트형 목록뷰 가드(원장 2026-09-02 *"칸반뷰를 목록뷰로"* · *"상태를 칸반뷰처럼 4단계로 통합"* · *"수업 -> 과목으로"* ·
 * *"나머지는 더블클릭하면 엑셀처럼 수정"* · *"접수 뒤에 자세히 열 추가하고 열기 버튼"*) — 표 규약과 "칸반 카드의 내용을
 * 칸반과 같은 판정으로 보여 주고, 같은 서버 액션으로 고친다"를 잠근다. 무거운 자식(창 링크·동시편집 배지·동기화 태그·
 * 잡고 끌기 영역·presence)은 껍데기로 바꾼다 — 여기서 검증하는 건 표의 모양·값·저장 호출이다.
 */
vi.mock("@/components/workspace/window-link", () => ({
  WindowLink: ({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/presence/editing-badge", () => ({ EditingBadge: () => null }));
vi.mock("@/features/presence/edit-presence", () => ({ useEditPresence: () => {} }));
vi.mock("@/components/makeedu-origin-tag", () => ({ MakeeduOriginTag: () => <span>동기화</span> }));
vi.mock("@/components/relative-time", () => ({ RelativeTime: () => <span>방금 전</span> }));
vi.mock("@/components/ui/drag-scroll-area", () => ({
  DragScrollArea: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));
// 과목·학년은 학원설정 단일 소스(클라는 훅) — 표는 이 맵만 읽는다(하드코딩 없음).
vi.mock("@/features/owner/operations-context", () => ({
  useSubjectMaps: () => ({
    labelOf: (k: string) => ({ math: "수학", english: "영어" })[k] ?? k,
    colorOf: (k: string) => ({ math: "blue", english: "green" })[k] ?? "neutral",
    options: [
      { value: "math", label: "수학" },
      { value: "english", label: "영어" },
    ],
    filters: [],
  }),
  useGradeLevels: () => ["초3", "중1", "중3"],
}));
const patch = vi.fn<(id: string, p: unknown) => Promise<{ ok: true }>>(async () => ({ ok: true }));
const setOutcome = vi.fn<(prev: unknown, fd: FormData) => Promise<{ ok?: boolean; error?: string }>>(async () => ({
  ok: true,
}));
vi.mock("@/features/enrollment/server/actions", () => ({
  patchConsultationCells: (id: string, p: unknown) => patch(id, p),
  setEnrollmentOutcome: (prev: unknown, fd: FormData) => setOutcome(prev, fd),
}));

afterEach(cleanup);
beforeEach(() => {
  patch.mockClear();
  setOutcome.mockClear();
  toastError.mockClear();
});

const row = (over: Partial<ConsultationTableRow> = {}): ConsultationTableRow => ({
  id: "c1",
  prospectName: "선혜주",
  prospectGrade: "중3",
  prospectSchool: "강북중",
  parentPhone: "010-0000-9108",
  parentRequest: "◆25.7.4\n<수학>\n-칠곡에서 공통수학 1 진행",
  consultantName: "김초롱",
  consultantId: "u1",
  subject: "math",
  outcome: "scheduled",
  consultedAt: "2026-08-27T05:43:48.024Z",
  hasAiAnalysis: false,
  processingStatus: "idle" as ConsultationTableRow["processingStatus"],
  hasAudio: false,
  fromPublicIntake: false,
  syncAddedAt: null,
  studentId: null,
  assignedClassCount: 0,
  ...over,
});

const HEADS = ["상태", "번호", "학생이름", "학교·학년", "연락처", "상담사", "과목", "상담 내용", "접수", "자세히"];

const cellOf = (label: string, nth = 0) =>
  screen.getAllByRole("cell").filter((td) => td.getAttribute("data-label") === label)[nth]!;
const cellsOf = (label: string) =>
  screen
    .getAllByRole("cell")
    .filter((td) => td.getAttribute("data-label") === label)
    .map((td) => td.textContent);

describe("시트형 목록뷰 — 열·규약", () => {
  it("열 = 칸반 카드의 내용 + 과목 + 자세히 — 시트의 열이 아니다", () => {
    render(<EnrollmentTable rows={[row()]} nowMs={0} canWrite={false} />);
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(HEADS);
    for (const th of screen.getAllByRole("columnheader")) {
      // 열 제목과 값은 같은 축(원장 2026-09-18) — 상담 내용(긴 글)·학생이름(뒤에 표식)은 제목·값 모두 왼쪽, 나머지는 가운데.
      expect(th.className).toContain(["상담 내용", "학생이름"].includes(th.textContent ?? "") ? "text-left" : "text-center");
      expect(th.className).toContain("sticky"); // 시트의 freeze A4 — 열 제목이 위에 고정
    }
  });

  it("열 구분선은 표 **한 곳**에서 옅게(border-l-line-faint) + sticky 테두리를 위해 border-separate", () => {
    render(<EnrollmentTable rows={[row()]} nowMs={0} canWrite={false} />);
    const cls = screen.getByRole("table").className;
    expect(cls).toContain("[&_tr>*:not(:first-child)]:border-l-line-faint");
    expect(cls).toContain("border-separate");
  });

  it("모든 본문 칸에 data-label이 있다(좁은 화면 카드 스택 규약) — 라벨은 열 제목과 같다", () => {
    render(<EnrollmentTable rows={[row()]} nowMs={0} canWrite={false} />);
    const cells = screen.getAllByRole("cell");
    expect(cells).toHaveLength(HEADS.length);
    expect(cells.map((td) => td.getAttribute("data-label"))).toEqual(HEADS);
  });
});

describe("시트형 목록뷰 — 값", () => {
  it("상태는 칸반과 같은 4단계다 — 예약은 '상담 전', 노쇼는 '미등록'(원값 7종을 세우지 않는다)", () => {
    render(
      <EnrollmentTable
        rows={[row({ outcome: "scheduled" }), row({ id: "c2", outcome: "no_show" })]}
        nowMs={0}
        canWrite={false}
      />,
    );
    expect(cellsOf("상태")).toEqual(["상담 전", "미등록"]);
  });

  it("배정(수강 ≥ 1)은 '등록 완료' 칸 + 이름 옆 '반 배정 완료' 표식(칸반 카드와 같은 규칙)", () => {
    render(<EnrollmentTable rows={[row({ outcome: "consulted", assignedClassCount: 2 })]} nowMs={0} canWrite={false} />);
    expect(cellsOf("상태")).toEqual(["등록 완료"]);
    expect(screen.getByText(ASSIGNED_LABEL)).toBeTruthy();
  });

  it("녹음 표식은 단계와 무관 — 반 배정된 '등록 완료' 행에도 마이크가 선다(원장 *\"녹음기 아이콘만 넣어\"*)", () => {
    render(
      <EnrollmentTable
        rows={[row({ outcome: "enrolled", assignedClassCount: 1, hasAudio: true, hasAiAnalysis: true })]}
        nowMs={0}
        canWrite={false}
      />,
    );
    expect(screen.getByText(ASSIGNED_LABEL)).toBeTruthy();
    expect(screen.getByLabelText("녹음 상담 · AI 분석 완료")).toBeTruthy();
  });

  it("범례는 칸반 4칸을 같은 라벨로 표 위에 세운다", () => {
    render(<EnrollmentTable rows={[row()]} nowMs={0} canWrite={false} />);
    const legend = screen.getByLabelText("상태 범례").textContent ?? "";
    for (const s of BOARD_STAGES) expect(legend).toContain(s.label);
    expect(legend).not.toContain(ASSIGNED_LABEL); // 배정은 상태가 아니라 표식
  });

  it("과목은 학원설정 라벨 — 키 'math'는 '수학'(알약), 옛 시트 자유 텍스트는 원문 그대로(색 없음)", () => {
    render(
      <EnrollmentTable
        rows={[row({ subject: "math" }), row({ id: "c2", subject: "영어 수학" }), row({ id: "c3", subject: null })]}
        nowMs={0}
        canWrite={false}
      />,
    );
    expect(cellsOf("과목")).toEqual(["수학", "영어 수학", ""]);
    expect(cellOf("과목", 0).querySelector("span")?.className).toContain("rounded-pill");
    expect(cellOf("과목", 1).querySelector("span")?.className).not.toContain("rounded-pill");
    expect(screen.queryByText("math")).toBeNull(); // raw 키 노출 금지
  });

  it("번호는 페이지를 넘어 이어진다(startIndex) · 학교·학년은 카드와 같은 압축 표기 · 접수는 KST 날짜 M/D", () => {
    render(<EnrollmentTable rows={[row(), row({ id: "c2" })]} nowMs={0} startIndex={50} canWrite={false} />);
    expect(cellsOf("번호")).toEqual(["51", "52"]);
    expect(cellsOf("학교·학년")[0]).toBe("강북중3");
    expect(cellsOf("접수")[0]).toContain("8/27");
    expect(cellsOf("상담사")[0]).toBe("김초롱");
    expect(cellsOf("상담 내용")[0]).toContain("칠곡에서 공통수학 1 진행");
  });

  it("빈 값은 시트처럼 비워 둔다('—' 없음) — 좁은 화면 카드가 빈 칸을 감출 수 있게 자식이 없다", () => {
    render(
      <EnrollmentTable
        rows={[
          row({
            parentRequest: null,
            consultantName: null,
            consultantId: null,
            prospectSchool: null,
            prospectGrade: null,
            parentPhone: null,
            subject: null,
          }),
        ]}
        nowMs={0}
        canWrite={false}
      />,
    );
    for (const label of ["상담 내용", "상담사", "학교·학년", "연락처", "과목"]) {
      expect(cellOf(label).childNodes.length, label).toBe(0);
    }
  });

  it("수정 가능이면 빈 칸에도 더블클릭 버튼이 서므로 td에 data-empty를 달아 좁은 화면 카드가 감춘다", () => {
    render(
      <EnrollmentTable
        rows={[row({ parentRequest: " ", consultantName: null, consultantId: null, prospectSchool: null, prospectGrade: null, parentPhone: null, subject: null })]}
        nowMs={0}
        canWrite={true}
      />,
    );
    for (const label of ["상담 내용", "상담사", "학교·학년", "연락처", "과목"]) {
      expect(cellOf(label).getAttribute("data-empty"), label).toBe("true");
      expect(within(cellOf(label)).getByTitle(EDIT_CELL_TITLE)).toBeTruthy();
    }
    for (const label of ["상태", "학생이름", "접수", "자세히"]) expect(cellOf(label).getAttribute("data-empty")).toBeNull();
    cleanup();
    render(<EnrollmentTable rows={[row()]} nowMs={0} canWrite={true} />);
    for (const label of ["상담 내용", "상담사", "학교·학년", "연락처", "과목"]) {
      expect(cellOf(label).getAttribute("data-empty"), label).toBeNull();
    }
  });

  it("칸반 카드와 같은 표식 — 상담 전 QR 접수 건엔 'QR 접수', 동기화로 들어온 건엔 동기화 태그", () => {
    render(
      <EnrollmentTable
        rows={[row({ outcome: "pending", fromPublicIntake: true, syncAddedAt: "2026-09-01T00:00:00Z" })]}
        nowMs={0}
        canWrite={false}
      />,
    );
    expect(screen.getByText(QR_INTAKE_LABEL)).toBeTruthy();
    expect(screen.getByText("동기화")).toBeTruthy();
  });

  it("'자세히'의 '열기'는 칸반 카드 클릭과 같은 상세 주소 — 이름은 링크가 아니다(더블클릭 편집과 부딪힌다)", () => {
    render(<EnrollmentTable rows={[row()]} nowMs={0} canWrite={true} />);
    const open = within(cellOf("자세히")).getByRole("link", { name: "열기" });
    expect(open.getAttribute("href")).toBe("/enrollment/c1");
    expect(cellOf("학생이름").querySelector("a")).toBeNull();
  });
});

describe("시트형 목록뷰 — 더블클릭 인라인 수정(엑셀식)", () => {
  it("쓰기 권한이 없으면 더블클릭 대상 자체가 없다(값만 보인다)", () => {
    render(<EnrollmentTable rows={[row()]} nowMs={0} canWrite={false} />);
    expect(screen.queryAllByTitle(EDIT_CELL_TITLE)).toHaveLength(0);
  });

  it("연락처 더블클릭 → 입력칸 → Enter = patchConsultationCells(id, { parentPhone })", async () => {
    render(<EnrollmentTable rows={[row()]} nowMs={0} canWrite={true} />);
    fireEvent.doubleClick(within(cellOf("연락처")).getByTitle(EDIT_CELL_TITLE));
    const input = within(cellOf("연락처")).getByDisplayValue("010-0000-9108");
    fireEvent.change(input, { target: { value: "010-1111-2222" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(patch).toHaveBeenCalledWith("c1", { parentPhone: "010-1111-2222" }));
    // 저장 직후(새 행이 오기 전)에도 방금 저장한 값이 보인다 — 옛 값이 되돌아오면 두 번 저장한다.
    await waitFor(() => expect(cellOf("연락처").textContent).toBe("010-1111-2222"));
  });

  it("Esc = 취소(저장 호출 없음) · 값을 안 바꾸고 떠나도 저장하지 않는다", () => {
    render(<EnrollmentTable rows={[row()]} nowMs={0} canWrite={true} />);
    fireEvent.doubleClick(within(cellOf("학생이름")).getByTitle(EDIT_CELL_TITLE));
    const input = within(cellOf("학생이름")).getByDisplayValue("선혜주");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(patch).not.toHaveBeenCalled();
    fireEvent.doubleClick(within(cellOf("학생이름")).getByTitle(EDIT_CELL_TITLE));
    fireEvent.blur(within(cellOf("학생이름")).getByDisplayValue("선혜주"));
    expect(patch).not.toHaveBeenCalled();
    expect(cellOf("학생이름").textContent).toContain("선혜주");
  });

  it("상담 내용은 여러 줄 — Shift+Enter는 줄바꿈, Enter가 저장", async () => {
    render(<EnrollmentTable rows={[row({ parentRequest: "첫 줄" })]} nowMs={0} canWrite={true} />);
    fireEvent.doubleClick(within(cellOf("상담 내용")).getByTitle(EDIT_CELL_TITLE));
    const ta = within(cellOf("상담 내용")).getByDisplayValue("첫 줄");
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    expect(patch).not.toHaveBeenCalled();
    fireEvent.change(ta, { target: { value: "첫 줄\n둘째 줄" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    await waitFor(() => expect(patch).toHaveBeenCalledWith("c1", { parentRequest: "첫 줄\n둘째 줄" }));
  });

  it("학교·학년은 한 편집기에서 둘 다 — 저장은 { prospectSchool, prospectGrade }", async () => {
    render(<EnrollmentTable rows={[row()]} nowMs={0} canWrite={true} />);
    fireEvent.doubleClick(within(cellOf("학교·학년")).getByTitle(EDIT_CELL_TITLE));
    const school = within(cellOf("학교·학년")).getByPlaceholderText("학교");
    fireEvent.change(school, { target: { value: "경명여중" } });
    fireEvent.keyDown(school, { key: "Enter" });
    await waitFor(() => expect(patch).toHaveBeenCalledWith("c1", { prospectSchool: "경명여중", prospectGrade: "중3" }));
  });

  it("과목 더블클릭 → 학원설정 과목 목록이 열린 채로 → 고르면 바로 저장 { subject }", async () => {
    render(<EnrollmentTable rows={[row({ subject: "math" })]} nowMs={0} canWrite={true} />);
    fireEvent.doubleClick(within(cellOf("과목")).getByTitle(EDIT_CELL_TITLE));
    fireEvent.click(within(cellOf("과목")).getByRole("button", { name: /^영어$/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith("c1", { subject: "english" }));
  });

  it("상담사 더블클릭 → 직원 목록 → '없음'을 고르면 consultantId: null", async () => {
    render(
      <EnrollmentTable rows={[row()]} nowMs={0} canWrite={true} consultants={[{ id: "u1", name: "김초롱" }, { id: "u2", name: "오은진" }]} />,
    );
    fireEvent.doubleClick(within(cellOf("상담사")).getByTitle(EDIT_CELL_TITLE));
    fireEvent.click(within(cellOf("상담사")).getByRole("button", { name: /^없음$/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith("c1", { consultantId: null }));
  });

  it("상태 더블클릭 → 4단계 목록 → 고르면 칸반 드롭과 같은 setEnrollmentOutcome(대표값 outcomeForDrop)", async () => {
    render(<EnrollmentTable rows={[row({ outcome: "scheduled" })]} nowMs={0} canWrite={true} />);
    fireEvent.doubleClick(within(cellOf("상태")).getByTitle(EDIT_CELL_TITLE));
    const list = within(cellOf("상태")).getAllByRole("listitem").map((li) => li.textContent);
    expect(list).toEqual(BOARD_STAGES.map((s) => s.label));
    fireEvent.click(within(cellOf("상태")).getByRole("button", { name: /^미등록$/ }));
    await waitFor(() => expect(setOutcome).toHaveBeenCalledTimes(1));
    const fd = setOutcome.mock.calls[0]![1];
    expect(fd.get("id")).toBe("c1");
    expect(fd.get("outcome")).toBe("declined"); // 미등록 칸의 대표값(예약→미등록)
    expect(patch).not.toHaveBeenCalled(); // 상태는 칸 PATCH가 아니라 상태 액션
    await waitFor(() => expect(cellOf("상태").textContent).toBe("미등록"));
  });

  it("반 배정된 행의 상태는 못 옮긴다 — 이유를 띄우고 저장 호출 없음(칸반 드롭 거절과 같은 문장)", () => {
    render(<EnrollmentTable rows={[row({ outcome: "consulted", assignedClassCount: 2 })]} nowMs={0} canWrite={true} />);
    fireEvent.doubleClick(within(cellOf("상태")).getByTitle(EDIT_CELL_TITLE));
    fireEvent.click(within(cellOf("상태")).getByRole("button", { name: /^상담 전$/ }));
    expect(toastError).toHaveBeenCalledWith(ASSIGNED_DRAG_BLOCKED);
    expect(setOutcome).not.toHaveBeenCalled();
    expect(cellOf("상태").textContent).toBe("등록 완료");
  });
});
