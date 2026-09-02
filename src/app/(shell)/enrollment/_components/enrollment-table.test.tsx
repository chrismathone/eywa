import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSIGNED_LABEL, QR_INTAKE_LABEL } from "@/features/enrollment/board-stages";
import { OUTCOME_PILL } from "@/features/enrollment/outcome-meta";
import type { ConsultationTableRow } from "@/features/enrollment/server/queries";
import { EnrollmentTable } from "./enrollment-table";

/**
 * 시트형 목록뷰 가드(원장 2026-09-02 *"칸반뷰를 시트처럼 목록뷰화"*) — 표 규약과 "원값을 보여 준다"를 잠근다.
 * 무거운 자식(창 링크·동시편집 배지·잡고 끌기 영역)은 껍데기로 바꾼다 — 여기서 검증하는 건 표의 모양·값이다.
 */
vi.mock("@/components/workspace/window-link", () => ({
  WindowLink: ({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/presence/editing-badge", () => ({ EditingBadge: () => null }));
vi.mock("@/components/relative-time", () => ({ RelativeTime: () => <span>방금 전</span> }));
vi.mock("@/components/ui/drag-scroll-area", () => ({
  DragScrollArea: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));
vi.mock("@/features/owner/operations-context", () => ({
  useSubjectMaps: () => ({
    labelOf: (k: string) => ({ math: "수학", english: "영어" })[k] ?? k,
    colorOf: (k: string) => ({ math: "blue", english: "rose" })[k] ?? "neutral",
  }),
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
  subject: "영어, 수학",
  receivedDate: "2026-08-27",
  consultationDate: "2026-08-31",
  receiver: "은미",
  counselor: null,
  consultationPath: "재원생 추천",
  address: "대구역자이더스타",
  registrationStatus: "이번달 등록예정",
  paymentAmount: "300000",
  paymentDate: "2026-09-05",
  followUpDate: null,
  followUpContent: null,
  nonRegistrationReason: null,
  ...over,
});

describe("시트형 목록뷰 — 열·규약", () => {
  it("열은 옛 시트 순서(상태·번호·콜일자·학생이름·전화번호·문의과목·학교·학년·상담 내용 …)이고 제목은 가운데", () => {
    render(<EnrollmentTable rows={[row()]} nowMs={0} />);
    const heads = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(heads.slice(0, 9)).toEqual([
      "상태",
      "번호",
      "콜일자",
      "학생이름",
      "전화번호",
      "문의과목",
      "학교",
      "학년",
      "상담 내용",
    ]);
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
  it("상태는 outcome 원값(예약·노쇼…)이다 — 칸반 4칸으로 뭉개지 않는다", () => {
    render(<EnrollmentTable rows={[row({ outcome: "scheduled" }), row({ id: "c2", outcome: "no_show" })]} nowMs={0} />);
    const cells = screen.getAllByRole("cell").filter((td) => td.getAttribute("data-label") === "상태");
    expect(cells.map((c) => c.textContent)).toEqual([OUTCOME_PILL.scheduled!.label, OUTCOME_PILL.no_show!.label]);
  });

  it("배정(수강 ≥ 1)은 outcome을 이겨 '반 배정 완료'", () => {
    render(<EnrollmentTable rows={[row({ outcome: "consulted", assignedClassCount: 1 })]} nowMs={0} />);
    const cell = screen.getAllByRole("cell").find((td) => td.getAttribute("data-label") === "상태");
    expect(cell?.textContent).toBe(ASSIGNED_LABEL);
  });

  it("범례는 outcome 7종 + '반 배정 완료'를 표 위에 같은 라벨로 세운다", () => {
    render(<EnrollmentTable rows={[row()]} nowMs={0} />);
    const legend = screen.getByLabelText("상태 범례").textContent ?? "";
    for (const m of Object.values(OUTCOME_PILL)) expect(legend).toContain(m.label);
    expect(legend).toContain(ASSIGNED_LABEL);
  });

  it("번호는 페이지를 넘어 이어진다(startIndex) · 콜일자는 접수일 M/D · 상담일은 요일 · 결제는 원", () => {
    render(<EnrollmentTable rows={[row(), row({ id: "c2" })]} nowMs={0} startIndex={50} />);
    const byLabel = (label: string) =>
      screen.getAllByRole("cell").filter((td) => td.getAttribute("data-label") === label).map((td) => td.textContent);
    expect(byLabel("번호")).toEqual(["51", "52"]);
    expect(byLabel("콜일자")[0]).toContain("8/27");
    expect(byLabel("상담일")[0]).toBe("8/31 (월)");
    expect(byLabel("결제")[0]).toBe("300,000원9/5");
    expect(byLabel("상담자")[0]).toBe("김초롱");
  });

  it("과목은 학원설정 라벨로(원값 '영어, 수학' → 영어·수학 배지) — raw 키가 화면에 안 나온다", () => {
    render(<EnrollmentTable rows={[row({ subject: "math" })]} nowMs={0} />);
    const cell = screen.getAllByRole("cell").find((td) => td.getAttribute("data-label") === "문의과목");
    expect(cell?.textContent).toBe("수학");
    expect(cell?.textContent).not.toContain("math");
  });

  it("상담자 계정 연결이 없으면 텍스트 상담자(counselor)로 폴백", () => {
    render(<EnrollmentTable rows={[row({ consultantName: null, counselor: "초롱" })]} nowMs={0} />);
    const cell = screen.getAllByRole("cell").find((td) => td.getAttribute("data-label") === "상담자");
    expect(cell?.textContent).toBe("초롱");
  });

  it("빈 값은 시트처럼 비워 둔다('—' 없음) — 좁은 화면 카드가 빈 칸을 감출 수 있게 자식이 없다", () => {
    render(
      <EnrollmentTable
        rows={[
          row({
            parentRequest: null,
            receiver: null,
            consultationPath: null,
            address: null,
            registrationStatus: null,
            paymentAmount: null,
            paymentDate: null,
            consultationDate: null,
          }),
        ]}
        nowMs={0}
      />,
    );
    for (const label of ["상담 내용", "수신자", "유입경로", "주소", "등록현황", "결제", "상담일", "비고"]) {
      const cell = screen.getAllByRole("cell").find((td) => td.getAttribute("data-label") === label);
      expect(cell?.childNodes.length, label).toBe(0);
    }
  });

  it("칸반 카드와 같은 표식 규칙 — 상담 전 QR 접수 건엔 'QR 접수'가 붙는다", () => {
    render(<EnrollmentTable rows={[row({ outcome: "pending", fromPublicIntake: true })]} nowMs={0} />);
    expect(screen.getByText(QR_INTAKE_LABEL)).toBeTruthy();
  });
});
