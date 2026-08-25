import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HubSearchResult } from "@/features/attendance/hub-search";
import { OperationsProvider } from "@/features/owner/operations-context";
import { subjectSchema, type SubjectSetting } from "@/features/owner/settings-types";
import { HubStudentSearch } from "./hub-student-search";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("@/features/attendance/server/hub-search-actions", () => ({
  searchAttendanceHubStudents: search,
}));

const T1 = "8af63269-437c-4a4b-b3fa-f4ae34ec0e75";

function result(over: Partial<HubSearchResult> = {}): HubSearchResult {
  return {
    hits: [
      {
        studentId: "s1",
        studentName: "윤현소",
        schoolGrade: "침산중2",
        classId: "c1",
        className: "고등M 개별 TP4E",
        subject: "math",
        teacherName: "이수진",
        linkTeacherId: T1,
        attendLabel: "월·목",
      },
    ],
    truncated: false,
    limit: 20,
    where: "8월 출석부",
    ...over,
  };
}

const linkOf = (name: string) => screen.getByText(name).closest("a") as HTMLAnchorElement;

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/attendance");
});

describe("허브 학생 검색 — 결과 줄", () => {
  it("이름·학교/학년·반·담당을 한 줄에 싣는다", () => {
    render(<HubStudentSearch month="2026-08" initialQuery="윤현소" initialResult={result()} />);
    expect(screen.getByText("윤현소")).toBeTruthy();
    expect(screen.getByText("침산중2")).toBeTruthy();
    // 🔴 반 이름과 담임은 **각자 칸**이다(원장 2026-08-24 "담임선생님 이름이 정렬 안되어있음") —
    //    한 문자열로 이어 붙이면 반 이름 길이에 따라 담임이 제각각 자리에 선다.
    expect(screen.getByText("고등M 개별 TP4E")).toBeTruthy();
    expect(screen.getByText("이수진")).toBeTruthy();
  });

  it("🔴 다섯 칸이 **한 격자**로 줄을 맞춘다 — 줄마다 flex면 담임 열이 흐트러진다", () => {
    const { container } = render(
      <HubStudentSearch month="2026-08" initialQuery="윤현소" initialResult={result()} />,
    );
    const list = container.querySelector("ul")!;
    expect(list.className).toContain("grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]");
    // 줄(li)과 링크가 그 격자의 열을 **그대로 물려받는다**(subgrid) — 각자 열을 새로 만들면 또 어긋난다.
    const row = linkOf("윤현소");
    expect(row.className).toContain("grid-cols-subgrid");
    expect(row.parentElement!.className).toContain("grid-cols-subgrid");
    // 줄어드는 칸은 반 이름 하나 — 요일 칸은 auto라 잘리지 않는다.
    expect(screen.getByText("고등M 개별 TP4E").className).toContain("truncate");
    expect(screen.getByText("월·목").className).not.toContain("truncate");
  });

  it("🔴 학교/학년·담임이 없어도 **빈 칸을 그린다** — 안 그리면 그 줄만 열이 밀린다", () => {
    render(
      <HubStudentSearch
        month="2026-08"
        initialQuery="윤현소"
        initialResult={result({
          hits: [{ ...result().hits[0]!, schoolGrade: "", teacherName: null }],
        })}
      />,
    );
    // 링크의 자식 칸 수는 언제나 5.
    expect(linkOf("윤현소").children).toHaveLength(5);
  });

  it("🔑 등원 요일을 줄 끝에 싣는다 — 같은 학생의 여러 줄을 가르는 유일한 단서(원장 2026-08-24)", () => {
    render(<HubStudentSearch month="2026-08" initialQuery="윤현소" initialResult={result()} />);
    const dow = screen.getByText("월·목");
    expect(dow).toBeTruthy();
    // 원문은 `title`에 — 시트(matrix-row)와 같은 문구.
    expect(dow.getAttribute("title")).toBe("등원 월·목");
    // 🔴 절대 잘리지 않는다 — 격자의 `auto` 칸이라 내용만큼 서고, 양보는 반 이름(1fr) 몫이다.
    expect(dow.className).not.toContain("truncate");
  });

  it("🔴 요일을 모르는 줄엔 **자리표시를 두지 않는다**(그 달 슬롯이 0인 활성 반이 실제로 있다)", () => {
    const { container } = render(
      <HubStudentSearch
        month="2026-08"
        initialQuery="윤현소"
        initialResult={result({ hits: [{ ...result().hits[0]!, attendLabel: "" }] })}
      />,
    );
    expect(container.textContent).not.toContain("—");
    expect(screen.getByText("윤현소")).toBeTruthy();
  });

  it("🔴 누르면 그 강사 출석부가 **검색어를 들고** 열린다(q = 그 학생 이름)", () => {
    render(<HubStudentSearch month="2026-08" initialQuery="윤" initialResult={result()} />);
    const url = new URL(linkOf("윤현소").getAttribute("href")!, "http://x");
    expect(url.searchParams.get("teacher")).toBe(T1);
    expect(url.searchParams.get("mode")).toBe("teacher");
    expect(url.searchParams.get("month")).toBe("2026-08");
    // 한 글자만 쳤어도 도착한 표에는 그 학생 줄만 남아야 한다.
    expect(url.searchParams.get("q")).toBe("윤현소");
  });

  it("담임이 없는 반(자리)은 **그 반**을 연다 — 없는 강사 시트로 보내지 않는다", () => {
    render(
      <HubStudentSearch
        month="2026-08"
        initialQuery="윤"
        initialResult={result({
          hits: [{ ...result().hits[0]!, linkTeacherId: null, teacherName: null, className: "LAB 자리" }],
        })}
      />,
    );
    const url = new URL(linkOf("윤현소").getAttribute("href")!, "http://x");
    expect(url.searchParams.get("class")).toBe("c1");
    expect(url.searchParams.get("mode")).toBe("class");
    expect(url.searchParams.get("teacher")).toBeNull();
  });

  it("🔴 상한에 걸리면 잘랐다고 밝힌다 — 전부인 척하지 않는다", () => {
    const { container } = render(
      <HubStudentSearch month="2026-08" initialQuery="김" initialResult={result({ truncated: true })} />,
    );
    expect(container.textContent).toContain("앞 20건만 표시합니다");
  });

  it("0건이면 **왜 비었는지** 말한다(권한 이야기는 하지 않는다)", () => {
    const { container } = render(
      <HubStudentSearch
        month="2026-08"
        initialQuery="없는이름"
        initialResult={result({ hits: [], where: "8월 담당 반" })}
      />,
    );
    expect(container.textContent).toContain("‘없는이름’ 이름의 학생을 8월 담당 반에서 찾지 못했습니다");
    expect(container.textContent).not.toContain("권한");
  });

  it("조회가 실패하면 사유를 보여준다 — 목록이 조용히 비지 않게", () => {
    const { container } = render(
      <HubStudentSearch
        month="2026-08"
        initialQuery="윤"
        initialResult={result({ hits: [], error: "학생을 찾는 중 오류가 났습니다 — 잠시 후 다시 시도해 주세요" })}
      />,
    );
    expect(container.textContent).toContain("오류가 났습니다");
  });
});

describe("허브 학생 검색 — 입력", () => {
  it("입력이 멎으면 서버에 묻고 결과를 그린다", async () => {
    vi.useFakeTimers();
    try {
      search.mockResolvedValue(result());
      render(<HubStudentSearch month="2026-08" />);
      const input = screen.getByLabelText("학생 검색") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "윤현" } });
      // 디바운스 전에는 아직 안 묻는다(글자마다 왕복 금지).
      expect(search).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(300);
      expect(search).toHaveBeenCalledWith({ query: "윤현", month: "2026-08" });
      expect(new URLSearchParams(window.location.search).get("q")).toBe("윤현");
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(screen.getByText("윤현소")).toBeTruthy());
  });

  it("🔴 지우기(X)는 결과도 URL의 q도 **즉시** 걷는다", () => {
    window.history.replaceState(null, "", "/attendance?month=2026-08&q=%EC%9C%A4%ED%98%84%EC%86%8C");
    render(<HubStudentSearch month="2026-08" initialQuery="윤현소" initialResult={result()} />);
    fireEvent.click(screen.getByLabelText("검색 지우기"));
    expect(screen.queryByText("윤현소")).toBeNull();
    expect(window.location.search).toBe("?month=2026-08");
    expect(search).not.toHaveBeenCalled();
  });

  it("씨앗이 없으면 조용히 입력칸만 선다(허브는 요약 화면 — 진입 비용 0)", () => {
    const { container } = render(<HubStudentSearch month="2026-08" />);
    expect(search).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("찾는 중");
  });
});

/**
 * 과목 그룹 — 라벨·순서는 **학원설정**(OperationsProvider)이 단일 소스.
 * 화면 파일에 과목 맵을 만들면 설정에 없는 과목이 새거나 설정 변경이 화면에 안 붙는다.
 */
describe("허브 학생 검색 — 과목 그룹", () => {
  // 학원설정의 과목 두 개(수학 → 영어 순) — 스키마 기본값을 채워 실제 저장 모양과 같게 만든다.
  const SUBJECTS: SubjectSetting[] = [
    subjectSchema.parse({ key: "math", label: "수학", color: "primary" }),
    subjectSchema.parse({ key: "english", label: "영어", color: "blue" }),
  ];
  const twoSubjects = () =>
    result({
      hits: [
        { ...result().hits[0]!, classId: "c1", subject: "math", className: "중등M 개별 BS3Q" },
        {
          ...result().hits[0]!,
          classId: "c2",
          subject: "english",
          className: "중등E_중2 정규 A",
          attendLabel: "월·목",
        },
      ],
    });
  const withSettings = (node: React.ReactNode) => (
    <OperationsProvider subjects={SUBJECTS} gradeLevels={[]}>
      {node}
    </OperationsProvider>
  );

  it("🔴 머리글은 학원설정 라벨 · 순서도 설정 순서(수학 → 영어)", () => {
    const { container } = render(
      withSettings(
        <HubStudentSearch month="2026-08" initialQuery="최하림" initialResult={twoSubjects()} />,
      ),
    );
    const heads = [...container.querySelectorAll("li")]
      .map((li) => li.textContent ?? "")
      .filter((t) => t === "수학" || t === "영어");
    expect(heads).toEqual(["수학", "영어"]);
    // 반 이름보다 머리글이 먼저 나온다(그룹이 줄을 감싼다).
    expect(container.textContent!.indexOf("수학")).toBeLessThan(
      container.textContent!.indexOf("중등M 개별 BS3Q"),
    );
  });

  it("🔴 구분선은 **그룹 사이에만** — 마지막 그룹 아래엔 없다", () => {
    const { container } = render(
      withSettings(
        <HubStudentSearch month="2026-08" initialQuery="최하림" initialResult={twoSubjects()} />,
      ),
    );
    const divided = [...container.querySelectorAll("li")].filter(
      (d) => d.className.includes("border-t") && d.className.includes("border-line"),
    );
    expect(divided).toHaveLength(1); // 그룹 2개 → 선 1개
  });

  it("그룹이 하나뿐이어도 머리글은 그린다(글자를 치는 동안 줄이 안 튄다)", () => {
    const { container } = render(
      withSettings(<HubStudentSearch month="2026-08" initialQuery="윤" initialResult={result()} />),
    );
    expect(container.textContent).toContain("수학");
  });

  it("🔴 설정에 없는 과목 키는 `기타`로 그린다 — raw 키(subject_9)를 화면에 내보내지 않는다", () => {
    const { container } = render(
      withSettings(
        <HubStudentSearch
          month="2026-08"
          initialQuery="윤"
          initialResult={result({ hits: [{ ...result().hits[0]!, subject: "subject_9" }] })}
        />,
      ),
    );
    expect(container.textContent).toContain("기타");
    expect(container.textContent).not.toContain("subject_9");
  });
});

describe("🔴 다시 묻는 중에는 '없습니다'를 말하지 않는다", () => {
  it("0건 결과가 떠 있는 상태로 새 검색어를 치면 '찾는 중'으로 바뀐다", () => {
    vi.useFakeTimers();
    try {
      search.mockResolvedValue(result());
      const { container } = render(
        <HubStudentSearch month="2026-08" initialQuery="없는이름" initialResult={result({ hits: [] })} />,
      );
      expect(container.textContent).toContain("찾지 못했습니다");
      fireEvent.change(screen.getByLabelText("학생 검색"), { target: { value: "윤현소" } });
      expect(container.textContent).not.toContain("찾지 못했습니다");
      expect(container.textContent).toContain("찾는 중");
    } finally {
      vi.useRealTimers();
    }
  });
});
