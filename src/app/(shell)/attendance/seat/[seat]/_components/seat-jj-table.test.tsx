import { JJ_SEAT_COL_MIN_PX } from "@/features/attendance/seat/jj-fields";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import type { SeatClassPlan } from "@/features/attendance/seat/server/jj-plan";
import { ECS_PLAN_API } from "@/features/class-sheets/components/plan-api";
import { SeatJjTable, type SeatPlanContext } from "./seat-jj-table";
import { writeLockedPlaceholder } from "@/lib/write-lock";

// 계획 블록이 서버 액션을 import한다 — 렌더 테스트라 호출은 안 하지만 모듈은 실려야 한다.
vi.mock("@/features/class-sheets/server/actions", () => ({
  flushSheetPatches: vi.fn(),
  createPlanLine: vi.fn(),
  deletePlanLine: vi.fn(),
  movePlanLine: vi.fn(),
  copySlotFromPrevious: vi.fn(),
}));

afterEach(cleanup);

/** 교시 사이 신호 — 이 파일의 관심사가 아니라 빈 값으로 둔다(전용 검증은 prev-period-wiring.test.ts). */
const hints = { seatName: "JJ실" };

const roster: SeatClassRoster = {
  classId: "c1",
  className: "중등E_초5 의치대",
  end: "17:00",
  bgColor: null,
  textColor: null,
  students: [
    {
      id: "s1",
      name: "이다윤A",
      school: "칠성초",
      grade: "4",
      status: null,
      recordedBy: null,
      fromSeat: false,
      note: null,
      attitude: null,
      listeningLevel: "L3",
      memorizedWords: null,
      progressNote: null,
    },
  ],
};

describe("JJ실 출석부 표", () => {
  it("듣기 레벨·누적 암기 단어수 칸이 있고 시험 점수는 없다", () => {
    render(
      <SeatJjTable
        rosters={[roster]}
        statusOf={() => null}
        noteOf={() => null}
        onSaveNote={vi.fn()}
        showReason
        onSave={vi.fn()}
        onSaveField={vi.fn()}
        hints={hints}
        onFillClass={vi.fn()}
        readOnly={false}
        pending={false}
      />,
    );
    expect(screen.getByText("듣기 레벨")).toBeTruthy();
    expect(screen.getByText("누적 암기 단어수")).toBeTruthy();
    expect(screen.queryByText("시험 점수")).toBeNull();
    expect(screen.getByLabelText("이다윤A 듣기 레벨")).toHaveValue("L3");
  });

  it("칸을 고치면 그 필드만 넘긴다", () => {
    const onSaveField = vi.fn();
    render(
      <SeatJjTable
        rosters={[roster]}
        statusOf={() => null}
        noteOf={() => null}
        onSaveNote={vi.fn()}
        showReason
        onSave={vi.fn()}
        onSaveField={onSaveField}
        hints={hints}
        onFillClass={vi.fn()}
        readOnly={false}
        pending={false}
      />,
    );
    fireEvent.change(screen.getByLabelText("이다윤A 누적 암기 단어수"), { target: { value: "1200" } });
    // 마지막 인자 = 이 입력 직전에 화면이 보던 값(칸 편집 감사로그의 이전 값, 2026-09-14).
    expect(onSaveField).toHaveBeenCalledWith("c1", "s1", "memorizedWords", "1200", null);
    fireEvent.change(screen.getByLabelText("이다윤A 듣기 레벨"), { target: { value: "L4" } });
    expect(onSaveField).toHaveBeenLastCalledWith("c1", "s1", "listeningLevel", "L4", "L3");
  });

  it("반은 가로 칸에 나란히 놓고 학생은 반 안에서 세로로 둔다", () => {
    const other: SeatClassRoster = {
      ...roster,
      classId: "c2",
      className: "중등E_초등 브릿지 A",
      students: [{ ...roster.students[0]!, id: "s2", name: "김수민" }],
    };
    const { container } = render(
      <SeatJjTable
        rosters={[roster, other]}
        statusOf={() => null}
        noteOf={() => null}
        onSaveNote={vi.fn()}
        showReason
        onSave={vi.fn()}
        onSaveField={vi.fn()}
        hints={hints}
        onFillClass={vi.fn()}
        readOnly={false}
        pending={false}
      />,
    );
    expect((container.firstElementChild as HTMLElement).style.gridTemplateColumns).toBe(
      `repeat(2, minmax(min(100%, ${JJ_SEAT_COL_MIN_PX}px), 1fr))`,
    );
    expect(screen.getAllByRole("table")).toHaveLength(2);
    expect(screen.getByText("중등E_초5 의치대")).toBeTruthy();
    expect(screen.getByText("중등E_초등 브릿지 A")).toBeTruthy();
  });
});

const plan: SeatClassPlan = {
  classId: "c1",
  canEdit: true,
  showExamTerm: true,
  skillAreas: [{ key: "vocab", label: "Vocab" }],
  lines: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      planDate: "2026-08-25",
      slotStart: "16:20",
      termMode: "regular",
      skillArea: "vocab",
      lineNo: 1,
      textbook: "Word Master",
      pageRange: "12-20",
      progress: "Unit 3",
      homework: "단어시험",
      updatedAt: "2026-08-25T00:00:00Z",
    },
  ],
};

const planContext = (plans: Record<string, SeatClassPlan>): SeatPlanContext => ({
  plans,
  // 로그인 화면의 문 — 공개 PIN 화면은 seatPlanApi(seat)를 넘긴다(밑바닥은 같은 함수).
  api: ECS_PLAN_API,
  tenantId: "t1",
  userId: "u1",
  weekMonday: "2026-08-24",
  date: "2026-08-25",
  slotStart: "16:20",
  onCarried: vi.fn(),
  flushFields: vi.fn().mockResolvedValue(undefined),
});

const other: SeatClassRoster = {
  ...roster,
  classId: "c2",
  className: "중등E_초등 브릿지 A",
  students: [{ ...roster.students[0]!, id: "s2", name: "김수민" }],
};

describe("JJ실 출석부 진도(수업계획)", () => {
  const props = {
    statusOf: () => null,
    noteOf: () => null,
    onSaveNote: vi.fn(),
    showReason: true,
    onSave: vi.fn(),
    onSaveField: vi.fn(),
    onFillClass: vi.fn(),
    hints,
    readOnly: false,
    pending: false,
  };

  it("계획을 볼 수 있는 반에만 구획이 생긴다 — 권한 없는 반은 출결만", () => {
    render(<SeatJjTable rosters={[roster, other]} plan={planContext({ c1: plan })} {...props} />);
    // 🔴 권한 판정은 서버가 한다(플랜 키가 없는 반 = 못 보는 반) — 구획이 통째로 없어야 한다.
    expect(screen.getAllByText("수업계획")).toHaveLength(1);
    expect(screen.getByDisplayValue("Unit 3")).toBeTruthy();
    // 시트와 같은 구성 — 평시·내신 두 구획에 각각 '줄 추가'와 '내용 복사'가 선다.
    expect(screen.getAllByText("+ 줄 추가")).toHaveLength(2);
    expect(screen.getAllByText("내용 복사 (지난 수업)")).toHaveLength(2);
    expect(screen.getByText("평시")).toBeTruthy();
    expect(screen.getByText("내신")).toBeTruthy();
  });

  it("지난 날짜 보기(readOnly)에선 진도도 못 고친다", () => {
    render(<SeatJjTable rosters={[roster]} plan={planContext({ c1: plan })} {...props} readOnly />);
    expect(screen.queryByText("+ 줄 추가")).toBeNull();
    expect(screen.queryByText("내용 복사 (지난 수업)")).toBeNull();
    // 빈 내신 구획은 편집이 막히면 아예 안 그린다(시트와 같은 규약).
    expect(screen.queryByText("내신")).toBeNull();
    expect(screen.getByDisplayValue("Unit 3")).toHaveProperty("disabled", true);
  });

  it("진도가 붙으면 열을 시트와 같은 폭으로 넓힌다(진도·과제가 슬리버로 안 무너지게)", () => {
    const { container } = render(
      <SeatJjTable rosters={[roster, other]} plan={planContext({ c1: plan })} {...props} />,
    );
    expect((container.firstElementChild as HTMLElement).style.gridTemplateColumns).toBe(
      "repeat(2, minmax(min(100%, 440px), 1fr))",
    );
  });

  it("계획 재료가 아예 없으면(공개 PIN·랩실) 구획도 없고 폭도 그대로", () => {
    const { container } = render(<SeatJjTable rosters={[roster, other]} {...props} />);
    expect(screen.queryByText("수업계획")).toBeNull();
    expect((container.firstElementChild as HTMLElement).style.gridTemplateColumns).toBe(
      `repeat(2, minmax(min(100%, ${JJ_SEAT_COL_MIN_PX}px), 1fr))`,
    );
  });
});

/** 자리 출석부 읽기 권한(원장 2026-11-05) — 쓰기 단추는 그리지 않고, 입력칸은 잠그고 권한을 말한다(write-lock.ts). */
describe("JJ실 출석부 — 읽기 권한", () => {
  const base = {
    statusOf: () => null,
    noteOf: () => null,
    onSaveNote: vi.fn(),
    showReason: true,
    onSave: vi.fn(),
    onSaveField: vi.fn(),
    onFillClass: vi.fn(),
    hints,
    pending: false,
  };

  it("🔴 출결 세 단추 대신 상태 글자 · 입력칸은 잠기고 권한 안내 · '이 반 출석'은 없다", () => {
    render(<SeatJjTable rosters={[roster]} {...base} readOnly writeLocked />);
    expect(screen.queryByRole("button", { name: "이다윤A 출석" })).toBeNull();
    expect(screen.getByLabelText("이다윤A 미체크")).toBeTruthy();
    const words = screen.getByLabelText("이다윤A 누적 암기 단어수");
    expect(words).toHaveProperty("disabled", true);
    expect(words).toHaveAttribute("placeholder", writeLockedPlaceholder("seat_attendance"));
    expect(screen.queryByText("이 반 출석")).toBeNull();
  });

  it("지난 날짜 잠금(권한은 있음)은 종전대로 잠긴 세 단추 — 사유가 권한이 아니다", () => {
    render(<SeatJjTable rosters={[roster]} {...base} readOnly />);
    expect(screen.getByRole("button", { name: "이다윤A 출석" })).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("이다윤A 누적 암기 단어수")).not.toHaveAttribute("placeholder");
  });
});
