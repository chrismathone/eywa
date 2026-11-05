import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnifiedRow } from "@/features/grades/unified/model";
import { saveUnifiedGrade } from "@/features/grades/unified/server/actions";
import { UnifiedLedger } from "./unified-ledger";

vi.mock("@/features/grades/unified/server/actions", () => ({ saveUnifiedGrade: vi.fn(async () => ({ ok: true })) }));
afterEach(() => { cleanup(); vi.mocked(saveUnifiedGrade).mockClear(); });

const record: UnifiedRow = {
  key: "grade:one", source: "grade", sourceId: "one", studentId: "student", name: "김서아",
  school: "칠성중", grade: "중2", subject: "math", kind: "monthly", date: "2026-09-21",
  score: 66, maxScore: 100, rawScore: null, classes: [
    { id: "main", name: "중등 수학 월·수", teacher: "최민정", days: 2 },
    { id: "extra", name: "중등 수학 금", teacher: "서유진", days: 1 },
  ], consultationDate: "2026-09-22", manualConsultationDate: null, editHref: "/exams",
  previousScore: 78, previousMaxScore: 100, delta: -12, deltaUnit: "점",
};
const table = (rows: UnifiedRow[]) => <UnifiedLedger rows={rows} canWrite head={<thead><tr><th>머리</th></tr></thead>} />;

describe("통합 성적 원장", () => {
  it("기본은 읽기 전용 — 입력칸 없이 값과 [수정]·[삭제]만 보인다", () => {
    render(table([record]));
    expect(screen.queryByLabelText("김서아 점수")).toBeNull();
    expect(screen.getByText("26.09.21")).toBeInTheDocument();
    expect(screen.getByTitle("중등 수학 월·수 / 중등 수학 금")).toBeInTheDocument();
    expect(screen.getByLabelText("직전보다 12점 하락")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "수정" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "삭제" })).toBeInTheDocument();
  });

  it("100점 만점은 백분율을 반복하지 않고, 0점 변화는 변화없음으로 표시한다", () => {
    render(table([{ ...record, delta: 0 }]));
    const cells = screen.getByText("김서아").closest("tr")?.querySelectorAll("td");
    // 열: 0 과목 · 1 시험일 · 2 이름 · 3 학교학년 · 4 반 · 5 담임 · 6 시험 · 7 시험정보 · 8 점수 · 9 증감
    expect(cells?.[8]).toHaveTextContent("66점 / 100점");
    expect(cells?.[8]).not.toHaveTextContent("%");
    expect(cells?.[8]).not.toHaveTextContent("환산");
    expect(cells?.[9]).toHaveTextContent("변화없음");
    expect(cells?.[9]).not.toHaveTextContent("±0");
  });

  it("[수정] → 칸이 열리고 [저장]은 이 줄의 값을 **날짜까지** 실어 보낸다(옛 '시험일을 확인해 주세요' 회귀)", async () => {
    render(table([record]));
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    expect(screen.getByLabelText("김서아 시험일")).toHaveValue("2026-09-21");
    fireEvent.change(screen.getByLabelText("김서아 점수"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(saveUnifiedGrade).toHaveBeenCalled());
    const fd = vi.mocked(saveUnifiedGrade).mock.calls[0]![1];
    expect(fd.get("date")).toBe("2026-09-21");
    expect(fd.get("score")).toBe("70");
    expect(fd.get("id")).toBe("one");
  });

  it("🔴 읽기 권한이면 [수정]·[삭제]를 **그리지 않는다**(비활성 단추로 남기지 않음 — 원장 2026-11-05)", () => {
    render(<UnifiedLedger rows={[record]} canWrite={false} head={<thead><tr><th>머리</th></tr></thead>} />);
    expect(screen.queryByRole("button", { name: "수정" })).toBeNull();
    expect(screen.queryByRole("button", { name: "삭제" })).toBeNull();
    // 관리 칸이 통째로 빠져 줄은 11칸(과목~상담)이다 — 빈 칸이 남아 열이 밀리지 않게.
    expect(screen.getByText("김서아").closest("tr")?.querySelectorAll("td")).toHaveLength(11);
  });

  it("[삭제]는 한 번 더 확인한 뒤 점수를 비운다(행은 남는다)", async () => {
    render(table([record]));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(saveUnifiedGrade).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "지우기" }));
    await waitFor(() => expect(saveUnifiedGrade).toHaveBeenCalled());
    expect(vi.mocked(saveUnifiedGrade).mock.calls[0]![1].get("score")).toBe("");
  });
});
