import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HubSearchResult } from "@/features/attendance/hub-search";
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
        teacherName: "이수진",
        linkTeacherId: T1,
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
    expect(screen.getByText(/고등M 개별 TP4E · 이수진/)).toBeTruthy();
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
