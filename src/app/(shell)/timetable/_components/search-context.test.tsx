import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  SEARCH_HIT_CLASS,
  SearchedCell,
  TimetableSearchEmptyNote,
  TimetableSearchToggle,
  TimetableSearchProvider,
  useSearchTone,
} from "./search-context";
import { TimetableEditContext, type TimetableEditState } from "./edit-context";
import { setTimetableDragging } from "./drag-flag";
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

/** 편집 상태 주입 — 실제 보드 대신 컨텍스트만 세운다(**끄는 동안** 검색이 물러나는지 확인용). */
function editState(): TimetableEditState {
  return {
    canDrag: true,
    notices: [],
    classMoves: new Map(),
    queueClassMove: () => {},
    pending: new Map(),
    incoming: new Map(),
    incomingByClass: new Map(),
    queueMove: () => {},
    openMoveDate: () => {},
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
    today: "2026-09-09",
    setHovered: () => {},
    openDayEdit: () => {},
    openClassPick: () => {},
    canSplit: false,
    openWholeSplit: () => {},
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

function Board({ enabled = true }: { enabled?: boolean }) {
  return (
    <TimetableEditContext.Provider value={editState()}>
      <TimetableSearchProvider index={index} scope="이번 주 수학 시간표" enabled={enabled}>
        <TimetableSearchToggle />
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

/** 입력칸은 토글(§10 "검색은 필요할 때만") 뒤에 있다 — 접혀 있으면 '검색'을 눌러 펼친 뒤 친다. */
const type = (v: string) => {
  if (!screen.queryByLabelText("학생 검색")) fireEvent.click(screen.getByRole("button", { name: "검색" }));
  fireEvent.change(screen.getByLabelText("학생 검색"), { target: { value: v } });
};

describe("검색 토글(§10) — 평소엔 '검색' 글자 하나, 검색어가 걸려 있으면 언제나 펼친 채", () => {
  it("접힘 → 검색 → 입력칸 · 빈 채로는 닫기 · 검색어가 있으면 닫기 대신 결과 칩", () => {
    render(<Board />);
    expect(screen.queryByLabelText("학생 검색")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(screen.getByLabelText("학생 검색")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByLabelText("학생 검색")).toBeNull();
    type("김하늘");
    expect(screen.queryByRole("button", { name: "닫기" })).toBeNull();
    expect(screen.getByText(/2\/3/)).toBeTruthy(); // 걸린 반 2/전체 3
  });
});

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

/** 걸린 줄의 클래스에서 깜빡임(재발화) 클래스만. 없으면 null — "깜빡임이 아예 안 붙었다". */
const flashOf = (name: string): string | null =>
  screen.getByText(name).className.split(/\s+/).find((c) => c.startsWith("search-hit-flash-")) ?? null;

describe("걸린 학생 이름 강조", () => {
  it("걸린 이름에만 표식이 붙는다(같은 칸의 다른 학생은 평소 서식)", () => {
    render(<Board />);
    type("이도윤");
    expect(screen.getByText("이도윤B").className).toContain(SEARCH_HIT_CLASS);
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
    expect(screen.getByText("장윤진").className).toContain(SEARCH_HIT_CLASS);
    expect(screen.getByText("장윤진").className).not.toContain("bg-ink");
    expect(SEARCH_HIT_CLASS).not.toContain("bg-ink");
  });

  it("표식 색은 형광 토큰(--search-hit)이다 — 갈색 amber로 되돌아가지 않는다", () => {
    // 원장 2026-08-20: 신입 빨강 옆에서 갈색이 묻혔다. `bg-amber!`(#995709)로 되돌리지 말 것.
    expect(SEARCH_HIT_CLASS).toContain("search-hit");
    expect(SEARCH_HIT_CLASS).not.toContain("amber");
    // 흰 글씨 금지 — 형광 채움 위에선 오히려 안 읽힌다(진한 글씨는 .search-hit이 정한다).
    expect(SEARCH_HIT_CLASS).not.toContain("text-white");
  });
});

describe("🔴 깜빡임은 검색어가 바뀔 때마다 다시 발화한다", () => {
  it("걸린 줄에 깜빡임 클래스가 붙는다", () => {
    render(<Board />);
    type("이도윤");
    expect(flashOf("이도윤B")).toBeTruthy();
  });

  it("검색어를 한 글자 더 쳐도 깜빡임 클래스가 **바뀐다** — 안 바뀌면 첫 검색만 깜빡인다", () => {
    render(<Board />);
    type("이도");
    const first = flashOf("이도윤B");
    type("이도윤");
    const second = flashOf("이도윤B");
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    // 같은 DOM 요소가 남아 있으므로(칸이 계속 걸려 있다) 클래스 이름이 바뀌어야만 다시 재생된다.
    expect(second).not.toBe(first);
  });

  it("글자 수가 그대로인 편집에서도 바뀐다 — 길이·해시로는 못 잡는다(한글 조합 'ㅇ'→'이'가 그렇다)", () => {
    render(<Board />);
    type("이도"); // 둘 다 같은 학생에 걸리는 같은 길이의 검색어
    const first = flashOf("이도윤B");
    type("도윤");
    expect(flashOf("이도윤B")).not.toBe(first);
  });

  it("두 클래스가 번갈아 나온다 — 세대는 검색어가 실제로 바뀔 때만 오른다", () => {
    render(<Board />);
    type("이도윤");
    const first = flashOf("이도윤B");
    type("이도윤"); // 같은 값 재입력 = 변화 없음
    expect(flashOf("이도윤B")).toBe(first);
  });
});

/**
 * 표식의 **실체는 CSS**(globals.css의 `.search-hit`)라 클래스 이름만 붙고 규칙이 없으면 **아무 색도 안
 * 붙는데 아무도 안 죽는다** — `bg-*`/`text-*`가 아니라서 죽은 색 클래스 가드(src/lib/design)도 못 본다.
 * 그래서 여기서 **화면이 실제로 붙이는 클래스 이름 그대로** CSS를 확인한다.
 */
const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** 이 위치가 `@layer …{ }` 안인가 — 유틸을 이기려면 표식 규칙은 **레이어 밖**이어야 한다. */
function insideLayer(css: string, at: number): boolean {
  const stack: boolean[] = [];
  for (let i = 0; i < at; i++) {
    if (css[i] === "{") {
      // 이 블록을 연 선택자(직전 `{`·`}`·`;` 이후)가 @layer인지.
      const head = css.slice(Math.max(0, css.lastIndexOf("}", i - 1), css.lastIndexOf("{", i - 1), css.lastIndexOf(";", i - 1)), i);
      stack.push(/@layer\b/.test(head));
    } else if (css[i] === "}") stack.pop();
  }
  return stack.some(Boolean);
}

describe("표식 CSS(globals.css)", () => {
  it("`.search-hit`이 레이어 밖에서 채움과 글자색을 둘 다 정한다", () => {
    const at = CSS.search(/^\.search-hit\s*\{/m);
    expect(at, "globals.css에 .search-hit 규칙이 없다 — 클래스만 붙고 색은 안 붙는다").toBeGreaterThan(-1);
    const body = CSS.slice(at).match(/\{([^}]*)\}/)![1]!;
    expect(body).toContain("background-color: var(--search-hit)");
    // 반쪽(배경만)이면 퇴원 행의 흰 글자가 형광 위에 그대로 남는다.
    expect(body).toMatch(/color:\s*var\(--foreground\)/);
    // 🔴 레이어 안으로 옮기면 `hover:bg-bg-soft`에 져서 마우스만 얹어도 표식이 사라진다.
    expect(insideLayer(CSS, at), ".search-hit이 @layer 안에 들어갔다").toBe(false);
  });

  it("화면이 붙이는 깜빡임 클래스가 실제로 정의돼 있고, 둘의 animation-name이 다르다", () => {
    render(<Board />);
    type("이도");
    const a = flashOf("이도윤B")!;
    type("도윤");
    const b = flashOf("이도윤B")!;
    expect(a).not.toBe(b);
    const names = [a, b].map((cls) => {
      const rule = CSS.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`));
      expect(rule, `globals.css에 .${cls} 규칙이 없다 — 깜빡임이 조용히 사라진다`).toBeTruthy();
      const name = rule![1]!.match(/animation:\s*([\w-]+)/)?.[1];
      expect(name, `.${cls}에 animation이 없다`).toBeTruthy();
      // 한 번만 돌고 멈춘다 — infinite면 그 칸을 읽을 수가 없다.
      expect(rule![1]).not.toContain("infinite");
      return name;
    });
    // 🔴 이름이 같으면 클래스를 갈아 끼워도 애니메이션이 다시 시작하지 않는다(재발화의 핵심).
    expect(names[0]).not.toBe(names[1]);
  });

  it("모션을 줄인 사용자에겐 애니메이션만 끄고 색 표식은 남긴다", () => {
    // 파일에 reduced-motion 블록이 여럿이라(막대 성장 등) **깜빡임을 끄는 그 블록**만 집어 본다.
    const at = CSS.indexOf(".search-hit-flash-a,");
    expect(at, "reduced-motion에서 깜빡임을 끄는 규칙이 없다").toBeGreaterThan(-1);
    const opener = CSS.lastIndexOf("@media (prefers-reduced-motion: reduce)", at);
    expect(opener, "그 규칙이 reduced-motion 안에 있지 않다").toBeGreaterThan(-1);
    const body = CSS.slice(CSS.indexOf("{", opener), CSS.indexOf("\n}", at) + 2);
    expect(body).toContain("animation: none");
    // 표식 색까지 끄면 모션을 끈 사람에겐 검색 결과가 통째로 안 보인다.
    expect(body).not.toMatch(/background-color|color:/);
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
  it("끄는 동안 — 필터가 풀리고 입력칸도 사라진다(옮길 목적지 반이 가려지면 드롭할 곳이 없다)", () => {
    render(<Board />);
    type("이도윤");
    expect(screen.queryByText("단독칸")).toBeNull();
    // 🔴 "끄는 중"은 컨텍스트가 아니라 **모듈 플래그**다(픽업 렉 때문에 상태를 뺐다 — drag-flag.ts).
    //    검색어가 걸려 있을 때만 구독하므로, 이 provider는 그때만 깨어난다.
    act(() => setTimetableDragging(true));
    expect(screen.getByText("단독칸")).toBeTruthy(); // 전 칸 복귀
    expect(screen.queryByLabelText("학생 검색")).toBeNull();
    // 손을 놓으면 치던 검색어가 그대로 살아난다.
    act(() => setTimetableDragging(false));
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
