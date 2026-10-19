import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoHomeworkManagement } from "./video-homework-management";
import type { BlankFacts } from "../no-homework";
import type { VideoArrival, VideoHomeworkLedgerRow, VideoHomeworkMark } from "../types";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../server/actions", () => ({ setVideoHomeworkRound: mocks.save }));
vi.mock("next/navigation", async (load) => ({ ...(await load<typeof import("next/navigation")>()), useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/embed-link", () => ({ EmbedHiddenInput: () => null }));

const frameSettings = (window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }).happyDOM.settings;
const previousFrameLoading = frameSettings.disableIframePageLoading;
const originalError = console.error;
let consoleSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  frameSettings.disableIframePageLoading = true;
  consoleSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes("Iframe page loading is disabled.")) return;
    originalError(...args);
  });
});
afterAll(() => { frameSettings.disableIframePageLoading = previousFrameLoading; consoleSpy.mockRestore(); });

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
const videos: VideoArrival[] = [{ id: "vid-1", studentId: "one", classId: "a", postedAt: "2026-10-07T19:00:00+09:00",
  playback: { preview: "https://drive.google.com/file/d/syntheticFile123/preview", thumbnail: "https://drive.google.com/thumbnail?id=syntheticFile123&sz=w64", uploadedAt: null } }];
const marks: VideoHomeworkMark[] = [
  { classId: "a", studentId: "one", checkDate: "2026-10-14", homeworkDate: "2026-10-13", status: "submitted", submittedDate: "2026-10-14" },
  { classId: "a", studentId: "two", checkDate: "2026-10-14", homeworkDate: "2026-10-13", status: "submitted", submittedDate: "2026-10-14" },
];
const show = () => render(<VideoHomeworkManagement rows={rows} initialMarks={marks} videos={videos} blankFacts={facts}
  fromDate="2026-10-01" toDate={today} today={today} />);
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("영상 제출 현황 — ▶ 현재 화면 재생 · 수동", () => {
  it("▶는 장부 위 재생 팝업 — 학생 상세 이동·완료 저장·편집 없이 그 영상만 열고 닫으면 재생기 제거", async () => {
    show();
    const play = screen.getByRole("button", { name: "숙제 영상 보기" });
    expect(screen.queryByRole("link", { name: "숙제 영상 보기" })).toBeNull();
    expect(play.parentElement?.closest("button")).toBeNull();
    // ▶를 눌러도 칸을 누른 것이 아니다(완료 찍기·편집 열기 없음)
    fireEvent.click(play);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading")).toHaveTextContent("김민준 · 숙제 영상 1회");
    const player = within(dialog).getByLabelText("김민준 · 숙제 영상 1회");
    expect(player).toHaveAttribute("src", `/api/homework-videos/${videos[0].id}/stream`);
    expect(screen.queryByRole("button", { name: "기록 저장" })).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(document.querySelector("video,iframe")).toBeNull());
    expect(screen.getByRole("table", { name: /수학 A/ })).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("업로드 대기는 완료로 세지 않고, 다른 학생 영상이 같은 id여도 열지 않는다", () => {
    render(<VideoHomeworkManagement rows={rows} initialMarks={marks} videos={[{ ...videos[0], studentId: "other-student" }, { ...videos[0], playback: null }]}
      fromDate="2026-10-01" toDate={today} today={today} />);
    expect(screen.queryByRole("button", { name: "숙제 영상 보기" })).toBeNull();
    expect(screen.getByRole("button", { name: "김민준 1회 2026-10-06 미확인" })).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
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

describe("영상 제출 현황 — 서버가 새 기록을 내려주면 다시 그린다(원장 2026-10-14 '배정하고도 안바뀌길래')", () => {
  const missing = [marks[0]!, { ...marks[1]!, status: "missing" as const, submittedDate: null }];
  const view = (initial: VideoHomeworkMark[]) => <VideoHomeworkManagement rows={rows} initialMarks={initial} videos={videos} blankFacts={facts}
    fromDate="2026-10-01" toDate={today} today={today} />;
  it("🔴 배정 뒤 다시 그린 화면의 기록을 따른다 — 처음 받은 '미수행'을 붙들지 않는다", () => {
    const { rerender } = render(view(missing));
    expect(screen.getByRole("button", { name: "이서연 2회 2026-10-13 미수행" })).toBeInTheDocument();
    rerender(view([...marks]));
    expect(screen.getByRole("button", { name: "이서연 2회 2026-10-13 완료" })).toBeInTheDocument();
  });
  it("저장 중에 온 값은 저장이 끝난 뒤에 맞춘다 — 방금 그린 칸을 저장 도중에 덮지 않는다", async () => {
    let finish: (value: { ok: boolean }) => void = () => {};
    mocks.save.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { rerender } = render(view(marks));
    fireEvent.click(screen.getByRole("button", { name: "김민준 3회 2026-10-20 미확인" }));
    expect(screen.getByRole("status")).toHaveTextContent("기록 저장 중");
    rerender(view(missing));
    expect(screen.getByRole("button", { name: "이서연 2회 2026-10-13 완료" })).toBeInTheDocument();
    finish({ ok: true });
    expect(await screen.findByRole("button", { name: "이서연 2회 2026-10-13 미수행" })).toBeInTheDocument();
    // 🔴 저장 중에 온 값은 저장 전에 만든 것일 수 있다 — 방금 저장한 칸은 '미확인'으로 돌아가지 않는다(적대 리뷰)
    expect(screen.getByRole("button", { name: "김민준 3회 2026-10-20 완료" })).toBeInTheDocument();
    // 저장이 끝난 뒤에 온 값은 그대로 따른다
    rerender(view([...marks]));
    expect(screen.getByRole("button", { name: "이서연 2회 2026-10-13 완료" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "김민준 3회 2026-10-20 미확인" })).toBeInTheDocument();
  });
});

describe("영상 제출 현황 — 결석은 —, 숙제없음은 사유 표시(회차 수는 그대로)", () => {
  it("이서연의 결석 칸은 — · 10.20 숙제없음, 박도윤은 입반 전이라 —", () => {
    show();
    const rowOf = (name: string) => within(screen.getByRole("row", { name: new RegExp(name) }));
    expect(rowOf("이서연").getByLabelText("숙제 없음")).toHaveTextContent("—");
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
    expect(screen.queryByText("결석")).not.toBeInTheDocument();
  });
  // 원장 2026-10-14 *"날짜 순서가 이상한데"* — 전주율: 10/1 숙제없음이 10/8·10/12 회차 뒤 3회 자리에 섰다.
  it("🔴 빈 칸도 날짜순으로 회차 사이에 선다 — 이서연: 10/06 결석(—) · 10/13 회차 · 10/20 숙제없음", () => {
    show();
    const cells = within(screen.getByRole("row", { name: /이서연/ })).getAllByRole("cell").slice(-3);
    expect(cells.map((td) => td.textContent)).toEqual(["—", expect.stringContaining("10.13"), "10.20숙제없음"]);
  });
  it("표시 뜻은 위쪽 안내 한 줄에 들어간다", () => {
    show();
    expect(screen.getByText("수동 = 영상 없이 완료", { exact: false })).toBeInTheDocument();
  });
});
