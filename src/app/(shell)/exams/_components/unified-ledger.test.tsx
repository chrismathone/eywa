import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GradeSheet } from "@/features/grades/types";
import type { UnifiedRow } from "@/features/grades/unified/model";
import { UnifiedLedger } from "./unified-ledger";

vi.mock("@/features/grades/unified/server/actions", () => ({ saveUnifiedGrade: vi.fn() }));
vi.mock("@/features/grades/unified/server/roster-action", () => ({ saveUnifiedRosterGrade: vi.fn() }));
afterEach(cleanup);

const record: UnifiedRow = {
  key: "grade:one", source: "grade", sourceId: "one", studentId: "student", name: "김서아",
  school: "칠성중", grade: "중2", subject: "math", kind: "monthly", date: "2026-09-21",
  score: 66, maxScore: 100, rawScore: null, classes: [
    { id: "main", name: "중등 수학 월·수", teacher: "최민정", days: 2 },
    { id: "extra", name: "중등 수학 금", teacher: "서유진", days: 1 },
  ], consultationDate: "2026-09-22", manualConsultationDate: null, editHref: "/exams",
  previousScore: 78, previousMaxScore: 100, delta: -12, deltaUnit: "점",
};

describe("통합 성적 입력표", () => {
  it("기존 기록의 날짜·점수·만점·상담일을 입력 행에 채우고 두 반을 순서대로 보인다", () => {
    render(<UnifiedLedger rows={[record]} canWrite />);
    expect(screen.getByLabelText("김서아 시험일")).toHaveValue("2026-09-21");
    expect(screen.getByLabelText("김서아 점수")).toHaveValue(66);
    expect(screen.getByLabelText("김서아 만점")).toHaveValue(100);
    expect(screen.getByLabelText("김서아 성적 상담")).toBeChecked();
    expect(screen.getByTitle("중등 수학 월·수 / 중등 수학 금")).toBeInTheDocument();
    expect(screen.getByLabelText("직전보다 12점 하락")).toBeInTheDocument();
  });

  it("시험 명단에는 이미 저장한 점수와 빈 점수를 함께 입력 가능하게 표시한다", () => {
    const sheet: GradeSheet = {
      selection: { year: 2026, term: 2, subject: "math", track: null, classId: null,
        slot: "monthly", date: "2026-09-21", month: 9, maxScore: 100 },
      classes: [], schemaReady: true, marksReady: true, noExamReady: true, monthReady: true,
      rows: [
        { studentId: "one", name: "박준호", school: "칠성중", grade: "중2", classId: "main", className: "월·수반",
          score: 83, scoreId: "saved", maxScore: 100, takenOn: "2026-09-19", marks: { ask1: null, ask2: null, received: null },
          noExam: false, noExamReason: null, applies: true, withdrawn: false },
        { studentId: "two", name: "송채린", school: "칠성고", grade: "고1", classId: "main", className: "월·수반",
          score: null, scoreId: null, maxScore: null, takenOn: null, marks: { ask1: null, ask2: null, received: null },
          noExam: false, noExamReason: null, applies: true, withdrawn: false },
      ],
    };
    render(<UnifiedLedger rows={[]} canWrite sheet={sheet} />);
    expect(screen.getByLabelText("박준호 점수")).toHaveValue(83);
    expect(screen.getByLabelText("박준호 시험일")).toHaveValue("2026-09-19");
    expect(screen.getByLabelText("송채린 점수")).toHaveValue(null);
  });
});
