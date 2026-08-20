import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  SEARCH_HIT_CLASS,
  SearchedCell,
  TimetableSearchBox,
  TimetableSearchEmptyNote,
  TimetableSearchProvider,
  useSearchTone,
} from "./search-context";
import { TimetableEditContext, type TimetableEditState } from "./edit-context";
import { buildTimetableSearchIndex } from "@/features/timetable/lib/student-search";

/**
 * 시간표 학생 검색의 **화면 계약** — "그 학생이 든 수업만 남는다"가 실제로 그렇게 그려지는지.
 * 순수 판정(정규화·색인·0건 문구)은 [student-search.test.ts](src/features/timetable/lib/student-search.test.ts)가 잠근다.
 */

const 이도윤 = { name: "이도윤B", school: "철성초", grade: "초3", studentId: "s1" };
const 김하늘 = { name: "김하늘", school: "경명여중", grade: "중2", studentId: "s2" };
const 박서준 = { name: "박서준", school: "대구중", grade: "중2", studentId: "s3" };
/** 퇴원 학생 — 셀의 '퇴원' 섹션에 진회색 배경(`bg-ink/80!`)으로 그려진다. */
const 장윤진 = {
  name: "장윤진",
  school: "칠성초",
  grade: "초6",
  studentId: "s4",
  tone: "bg-ink/80! font-bold text-white/65",
};

const index = buildTimetableSearchIndex([
  { classId: "c1", students: [이도윤, 김하늘] },
  { classId: "c2", students: [박서준] },
  { classId: "c3", students: [김하늘, 장윤진] },
]);

/** 편집 상태 주입 — 실제 보드 대신 컨텍스트만 세운다(편집 모드에서 검색이 물러나는지 확인용). */
function editState(editing: boolean): TimetableEditState {
  return {
    editing,
    setEditing: () => {},
    pending: new Map(),
    incoming: new Map(),
    queueMove: () => {},
    pendingCount: 0,
    save: () => {},
    cancel: () => {},
    saving: false,
    error: null,
    failed: [],
    scheduledDate: null,
    setScheduledDate: () => {},
    dateFloor: "",
    queueDate: null,
    weekMismatch: false,
    setHovered: () => {},
    openDayEdit: () => {},
    openClassPick: () => {},
  };
}

/**
 * 이름 한 줄 — 평소엔 그 학생의 tone, 검색에 걸리면 표식.
 * 🔴 퇴원 행 tone(`bg-ink/80!`)을 일부러 준다 — 표식을 **덧붙이면** 그 tone이 이겨서 강조가 사라진다.
 */
function Row({ student }: { student: { name: string; school: string; grade: string; tone?: string } }) {
  const tone = useSearchTone(student, student.tone ?? "text-foreground");
  return <span className={tone}>{student.name}</span>;
}

function Board({ enabled = true, editing = false }: { enabled?: boolean; editing?: boolean }) {
  return (
    <TimetableEditContext.Provider value={editState(editing)}>
      <TimetableSearchProvider index={index} scope="이번 주 수학 시간표" enabled={enabled}>
        <TimetableSearchBox />
        <TimetableSearchEmptyNote />
        {/* 합반 칸(c1+c2) · 단독 칸(c3) · 반이 아닌 칸(감독 블록) */}
        <SearchedCell classIds={["c1", "c2"]}>
          <div>
            합반칸
            <Row student={이도윤} />
            <Row student={박서준} />
          </div>
        </SearchedCell>
        <SearchedCell classIds={["c3"]}>
          <div>
            단독칸
            <Row student={김하늘} />
            <Row student={장윤진} />
          </div>
        </SearchedCell>
        <SearchedCell classIds={[]}>
          <div>감독블록</div>
        </SearchedCell>
      </TimetableSearchProvider>
    </TimetableEditContext.Provider>
  );
}

const type = (v: string) =>
  fireEvent.change(screen.getByLabelText("학생 검색"), { target: { value: v } });

describe("시간표 학생 검색 — 칸 남기기", () => {
  it("검색 전엔 모든 칸이 그대로다", () => {
    render(<Board />);
    expect(screen.getByText("합반칸")).toBeTruthy();
    expect(screen.getByText("단독칸")).toBeTruthy();
    expect(screen.getByText("감독블록")).toBeTruthy();
  });

  it("이름을 치면 그 학생이 든 칸만 남는다 — 나머지는 **안 그린다**", () => {
    render(<Board />);
    type("이도윤");
    expect(screen.getByText("합반칸")).toBeTruthy();
    expect(screen.queryByText("단독칸")).toBeNull();
    // 반이 아닌 칸(감독·준비 블록)도 물러난다 — 어떤 학생도 들어 있지 않다.
    expect(screen.queryByText("감독블록")).toBeNull();
  });

  it("합반 칸은 **한 반만 걸려도 통째로** 남는다 — 그 아이가 명단 어디에 있는지 봐야 한다", () => {
    render(<Board />);
    type("박서준");
    expect(screen.getByText("합반칸")).toBeTruthy();
    // 같은 칸의 다른 학생은 그대로 보인다(반 전체가 보여야 위치가 읽힌다).
    expect(screen.getByText("이도윤B")).toBeTruthy();
  });

  it("학교·학년으로 치면 그 학생이 있는 칸이 여럿 남는다", () => {
    render(<Board />);
    type("중2");
    expect(screen.getByText("합반칸")).toBeTruthy(); // 김하늘
    expect(screen.getByText("단독칸")).toBeTruthy(); // 김하늘
  });

  it("지우면 즉시 원래대로", () => {
    render(<Board />);
    type("이도윤");
    expect(screen.queryByText("단독칸")).toBeNull();
    type("");
    expect(screen.getByText("단독칸")).toBeTruthy();
    expect(screen.getByText("감독블록")).toBeTruthy();
  });

  it("공백만 친 것은 검색이 아니다 — 화면이 통째로 비면 안 된다", () => {
    render(<Board />);
    type("   ");
    expect(screen.getByText("합반칸")).toBeTruthy();
    expect(screen.getByText("단독칸")).toBeTruthy();
  });
});

describe("걸린 학생 이름 강조", () => {
  it("걸린 이름에만 표식이 붙는다(같은 칸의 다른 학생은 평소 서식)", () => {
    render(<Board />);
    type("이도윤");
    expect(screen.getByText("이도윤B").className).toBe(SEARCH_HIT_CLASS);
    expect(screen.getByText("박서준").className).toBe("text-foreground");
  });

  it("검색 전에는 아무 이름에도 표식이 없다 — 평소 tone 그대로", () => {
    render(<Board />);
    expect(screen.getByText("이도윤B").className).toBe("text-foreground");
  });

  it("🔴 표식은 평소 tone을 **대신한다**(덧붙이지 않는다) — 퇴원 행 배경이 표식을 덮어 강조가 사라졌었다", () => {
    render(<Board />);
    type("장윤진");
    // 퇴원 tone을 들고 있어도 걸린 줄은 표식만 남는다(두 배경이 같은 자리를 다투지 않는다).
    expect(screen.getByText("장윤진").className).toBe(SEARCH_HIT_CLASS);
    expect(SEARCH_HIT_CLASS).not.toContain("bg-ink");
  });
});

describe("0건", () => {
  it("왜 비었는지 한 줄로 말하고, 그 자리에서 지울 수 있다", () => {
    render(<Board />);
    type("없는이름");
    expect(screen.queryByText("합반칸")).toBeNull();
    const note = screen.getByText(/없는이름/);
    expect(note.textContent).toContain("이번 주 수학 시간표");
    // ⚠️ 입력칸의 ✕도 같은 이름(aria-label)이라 역할로 고르면 둘이 걸린다 — 안내 안의 글자 버튼을 고른다.
    fireEvent.click(screen.getByText("검색 지우기"));
    expect(screen.getByText("합반칸")).toBeTruthy();
  });
});

describe("🔴 검색이 스스로 물러나는 자리", () => {
  it("편집 모드 — 필터가 풀리고 입력칸도 사라진다(옮길 목적지 반이 가려지면 편집이 막힌다)", () => {
    const { rerender } = render(<Board />);
    type("이도윤");
    expect(screen.queryByText("단독칸")).toBeNull();
    rerender(<Board editing />);
    expect(screen.getByText("단독칸")).toBeTruthy(); // 전 칸 복귀
    expect(screen.queryByLabelText("학생 검색")).toBeNull();
    // 편집을 끄면 치던 검색어가 그대로 살아난다.
    rerender(<Board />);
    expect(screen.queryByText("단독칸")).toBeNull();
  });

  it("검색이 없는 뷰(교실뷰·배치 편집) — 치던 검색어가 남아 있어도 안 거르고 0건 안내도 안 뜬다", () => {
    const { rerender } = render(<Board />);
    type("없는이름");
    expect(screen.getByText(/없는이름/)).toBeTruthy();
    rerender(<Board enabled={false} />);
    expect(screen.getByText("합반칸")).toBeTruthy();
    expect(screen.queryByText(/없는이름/)).toBeNull();
    expect(screen.queryByLabelText("학생 검색")).toBeNull();
  });
});
