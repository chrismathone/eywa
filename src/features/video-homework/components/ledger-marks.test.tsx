import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoHomeworkManagement } from "./video-homework-management";
import type { BlankFacts } from "../no-homework";
import type { VideoArrival, VideoHomeworkLedgerRow, VideoHomeworkMark } from "../types";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../server/actions", () => ({ setVideoHomeworkRound: mocks.save }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/embed-link", () => ({ EmbedHiddenInput: () => null }));

const today = "2026-10-30";
const row = (patch: Partial<VideoHomeworkLedgerRow>): VideoHomeworkLedgerRow => ({ classId: "a", className: "수학 A", subject: "수학",
  studentId: "one", studentName: "김민준", school: "한빛중", grade: "중1", assignedDates: [], tracked: true, editable: true, ...patch });
// 반 숙제일 10/06·10/13·10/20 — 김민준은 셋 다, 이서연은 10/13만(10/06 결석 · 10/20 숙제없음), 박도윤은 10/20만(앞 두 날은 입반 전).
const rows = [
  row({ assignedDates: ["2026-10-06", "2026-10-13", "2026-10-20"] }),
  row({ studentId: "two", studentName: "이서연", assignedDates: ["2026-10-13"] }),
  row({ studentId: "three", studentName: "박도윤", assignedDates: ["2026-10-20"] }),
];
const facts: BlankFacts = { "a:two": { "2026-10-06": "absent", "2026-10-20": "none" } };
const videos: VideoArrival[] = [{ id: "vid-1", studentId: "one", classId: "a", postedAt: "2026-10-07T19:00:00+09:00" }];
const marks: VideoHomeworkMark[] = [
  { classId: "a", studentId: "one", checkDate: "2026-10-14", homeworkDate: "2026-10-13", status: "submitted", submittedDate: "2026-10-14" },
  { classId: "a", studentId: "two", checkDate: "2026-10-14", homeworkDate: "2026-10-13", status: "submitted", submittedDate: "2026-10-14" },
];
const show = () => render(<VideoHomeworkManagement rows={rows} initialMarks={marks} videos={videos} blankFacts={facts}
  fromDate="2026-10-01" toDate={today} today={today} />);
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("영상 제출 현황 — ▶ 영상 바로가기 · 수동", () => {
  it("영상으로 완료된 칸에 ▶ — 그 학생의 숙제 영상 탭에 그 영상을 미리 골라 여는 주소, 칸 버튼과 별개", () => {
    show();
    const link = screen.getByRole("link", { name: "숙제 영상 보기" });
    expect(link).toHaveAttribute("href", "/students/one?tab=homework-videos&video=vid-1");
    expect(screen.getAllByRole("link", { name: "숙제 영상 보기" })).toHaveLength(1);
    expect(link.closest("button")).toBeNull();
    // ▶를 눌러도 칸을 누른 것이 아니다(완료 찍기·편집 열기 없음)
    fireEvent.click(link);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("영상 없이 찍은 완료는 '수동'(누를 수 없음) — 영상이 짝지어진 칸은 수동이 아니다", () => {
    show();
    expect(screen.getAllByText("수동")).toHaveLength(2); // 김민준 10/13 · 이서연 10/13(영상은 김민준 10/06 칸에만)
    expect(screen.queryByRole("link", { name: "숙제 영상 수동" })).toBeNull();
    const manual = screen.getAllByText("수동")[0];
    expect(manual.closest("a,button")).toBeNull();
  });
  it("🔴 영상 도착 기록을 못 읽었으면 '수동'을 띄우지 않는다(영상이 있는지 모르니)", () => {
    render(<VideoHomeworkManagement rows={rows} initialMarks={marks} videos={[]} blankFacts={facts} videosKnown={false}
      fromDate="2026-10-01" toDate={today} today={today} />);
    expect(screen.queryByText("수동")).toBeNull();
  });
  it("칸 누르기는 그대로 — 미확인 칸은 오늘 날짜로 완료(회귀)", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "김민준 3회 2026-10-20 미확인" }));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ studentId: "one", roundKey: "h:2026-10-20", status: "submitted", submittedDate: today }));
  });
});

describe("영상 제출 현황 — 빈 칸에 결석·숙제없음(회차 수는 그대로)", () => {
  it("이서연의 빈 칸 = 10.06 결석 · 10.20 숙제없음, 박도윤은 입반 전이라 —", () => {
    show();
    const rowOf = (name: string) => within(screen.getByRole("row", { name: new RegExp(name) }));
    expect(rowOf("이서연").getByLabelText("2026-10-06 결석")).toHaveTextContent("10.06결석");
    expect(rowOf("이서연").getByLabelText("2026-10-20 숙제없음")).toHaveTextContent("10.20숙제없음");
    expect(rowOf("박도윤").queryByLabelText(/결석|숙제없음/)).toBeNull();
    expect(rowOf("박도윤").getAllByLabelText("숙제 없음")).toHaveLength(2);
  });
  it("🔴 사유 칸은 회차가 아니다 — 완료 n/m의 m·열 수·미확인 집계가 그대로", () => {
    show();
    const table = screen.getByRole("table", { name: /수학 A/ });
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["", "학생", "학교 · 학년", "완료", "1회", "2회", "3회"]);
    const two = within(screen.getByRole("row", { name: /이서연/ }));
    expect(two.getByText("/1")).toBeInTheDocument(); // m = 자기 회차 1개
    expect(screen.getByText("결석")).toBeInTheDocument();
  });
  it("안내 줄에 표시 뜻이 한 줄 들어간다", () => {
    show();
    expect(screen.getByText("▶ 영상 · 수동 · 결석 · 숙제없음", { exact: false })).toBeInTheDocument();
  });
});
