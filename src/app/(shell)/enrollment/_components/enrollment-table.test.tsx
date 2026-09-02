import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSIGNED_LABEL, BOARD_STAGES, QR_INTAKE_LABEL } from "@/features/enrollment/board-stages";
import type { ConsultationTableRow } from "@/features/enrollment/server/queries";
import { EnrollmentTable } from "./enrollment-table";

/**
 * 시트형 목록뷰 가드(원장 2026-09-02 *"칸반뷰를 목록뷰로"* · *"상태를 칸반뷰처럼 4단계로 통합"*) — 표 규약과
 * "칸반 카드의 내용을 칸반과 같은 판정으로 보여 준다"를 잠근다. 무거운 자식(창 링크·동시편집 배지·동기화 태그·
 * 잡고 끌기 영역)은 껍데기로 바꾼다 — 여기서 검증하는 건 표의 모양·값이다.
 */
vi.mock("@/components/workspace/window-link", () => ({
  WindowLink: ({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/presence/editing-badge", () => ({ EditingBadge: () => null }));
vi.mock("@/components/makeedu-origin-tag", () => ({ MakeeduOriginTag: () => <span>동기화</span> }));
vi.mock("@/components/relative-time", () => ({ RelativeTime: () => <span>방금 전</span> }));
vi.mock("@/components/ui/drag-scroll-area", () => ({
  DragScrollArea: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

afterEach(cleanup);

const row = (over: Partial<ConsultationTableRow> = {}): ConsultationTableRow => ({
  id: "c1",
  prospectName: "선혜주",
  prospectGrade: "중3",
  prospectSchool: "강북중",
  parentPhone: "010-2848-6420",
  parentRequest: "◆25.7.4\n<수학>\n-칠곡에서 공통수학 1 진행",
  consultantName: "김초롱",
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

const cellsOf = (label: string) =>
  screen
    .getAllByRole("cell")
    .filter((td) => td.getAttribute("data-label") === label)
    .map((td) => td.textContent);

describe("시트형 목록뷰 — 열·규약", () => {
  it("열 = 칸반 카드의 내용(상태·번호·학생이름·학교·학년·연락처·상담사·수업·상담 내용·접수) — 시트의 열이 아니다", () => {
    render(<EnrollmentTable rows={[row()]} nowMs={0} />);
    const heads = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(heads).toEqual(["상태", "번호", "학생이름", "학교·학년", "연락처", "상담사", "수업", "상담 내용", "접수"]);
    for (const th of screen.getAllByRole("columnheader")) {
      expect(th.className).toContain("text-center");
      expect(th.className).toContain("sticky"); // 시트의 freeze A4 — 열 제목이 위에 고정
    }
  });

  it("열 구분선은 표 **한 곳**에서 옅게(border-l-line-faint) + sticky 테두리를 위해 border-separate", () => {
    render(<EnrollmentTable rows={[row()]} nowMs={0} />);
    const cls = screen.getByRole("table").className;
    expect(cls).toContain("[&_tr>*:not(:first-child)]:border-l-line-faint");
    expect(cls).toContain("border-separate");
  });

  it("모든 본문 칸에 data-label이 있다(좁은 화면 카드 스택 규약) — 라벨은 열 제목과 같다", () => {
    render(<EnrollmentTable rows={[row()]} nowMs={0} />);
    const heads = screen.getAllByRole("columnheader").map((th) => th.textContent);
    const cells = screen.getAllByRole("cell");
    expect(cells).toHaveLength(heads.length);
    expect(cells.map((td) => td.getAttribute("data-label"))).toEqual(heads);
  });
});

describe("시트형 목록뷰 — 값", () => {
  it("상태는 칸반과 같은 4단계다 — 예약은 '상담 전', 노쇼는 '미등록'(원값 7종을 세우지 않는다)", () => {
    render(<EnrollmentTable rows={[row({ outcome: "scheduled" }), row({ id: "c2", outcome: "no_show" })]} nowMs={0} />);
    expect(cellsOf("상태")).toEqual(["상담 전", "미등록"]);
  });

  it("배정(수강 ≥ 1)은 '등록 완료' 칸 + 이름 옆 '반 배정 완료' 표식 + 수업 N개(칸반 카드와 같은 규칙)", () => {
    render(<EnrollmentTable rows={[row({ outcome: "consulted", assignedClassCount: 2 })]} nowMs={0} />);
    expect(cellsOf("상태")).toEqual(["등록 완료"]);
    expect(screen.getByText(ASSIGNED_LABEL)).toBeTruthy();
    expect(cellsOf("수업")).toEqual(["2개"]);
  });

  it("범례는 칸반 4칸을 같은 라벨로 표 위에 세운다", () => {
    render(<EnrollmentTable rows={[row()]} nowMs={0} />);
    const legend = screen.getByLabelText("상태 범례").textContent ?? "";
    for (const s of BOARD_STAGES) expect(legend).toContain(s.label);
    expect(legend).not.toContain(ASSIGNED_LABEL); // 배정은 상태가 아니라 표식
  });

  it("번호는 페이지를 넘어 이어진다(startIndex) · 학교·학년은 카드와 같은 압축 표기 · 접수는 KST 날짜 M/D", () => {
    render(<EnrollmentTable rows={[row(), row({ id: "c2" })]} nowMs={0} startIndex={50} />);
    expect(cellsOf("번호")).toEqual(["51", "52"]);
    expect(cellsOf("학교·학년")[0]).toBe("강북중3");
    expect(cellsOf("접수")[0]).toContain("8/27");
    expect(cellsOf("상담사")[0]).toBe("김초롱");
    expect(cellsOf("상담 내용")[0]).toContain("칠곡에서 공통수학 1 진행");
  });

  it("빈 값은 시트처럼 비워 둔다('—' 없음) — 좁은 화면 카드가 빈 칸을 감출 수 있게 자식이 없다", () => {
    render(
      <EnrollmentTable
        rows={[row({ parentRequest: null, consultantName: null, prospectSchool: null, prospectGrade: null, parentPhone: null })]}
        nowMs={0}
      />,
    );
    for (const label of ["상담 내용", "상담사", "학교·학년", "연락처", "수업"]) {
      const cell = screen.getAllByRole("cell").find((td) => td.getAttribute("data-label") === label);
      expect(cell?.childNodes.length, label).toBe(0);
    }
  });

  it("칸반 카드와 같은 표식 — 상담 전 QR 접수 건엔 'QR 접수', 동기화로 들어온 건엔 동기화 태그", () => {
    render(
      <EnrollmentTable
        rows={[row({ outcome: "pending", fromPublicIntake: true, syncAddedAt: "2026-09-01T00:00:00Z" })]}
        nowMs={0}
      />,
    );
    expect(screen.getByText(QR_INTAKE_LABEL)).toBeTruthy();
    expect(screen.getByText("동기화")).toBeTruthy();
  });
});
