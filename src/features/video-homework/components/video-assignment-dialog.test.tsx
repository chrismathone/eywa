import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const m = vi.hoisted(() => ({ options: vi.fn(), save: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: m.refresh }), usePathname: () => "/lesson-reports/video-homework" }));
vi.mock("../server/video-assignment", () => ({ getVideoAssignmentOptions: m.options, assignHomeworkVideo: m.save }));
vi.mock("@/features/students/components/homework-video-player", () => ({ HomeworkVideoPlayer: () => <div>영상 재생</div> }));
import { VideoAssignmentDialog } from "./video-assignment-dialog";
const row = { classId: "math", className: "수학반", studentId: "student", studentName: "가상학생", subject: "수학", school: null, grade: null, tracked: true, editable: true, assignedDates: ["2026-10-01"] };
beforeEach(() => {
  vi.clearAllMocks(); m.save.mockResolvedValue({ ok: true });
  m.options.mockResolvedValue({ ok: true, dates: ["2026-10-01"], videos: [{ id: "v", postedAt: "2026-10-02T10:00:00Z", className: "영어반", homeworkDate: "2026-10-02", source: "ClassNote", postId: 123, revision: 4, excluded: false, playback: { preview: "preview", thumbnail: "thumb", uploadedAt: null } }] });
});
afterEach(cleanup);
async function pickVideo() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("combobox", { name: "영상 선택" }));
  await user.click(await screen.findByRole("option", { name: /2026-10-02.*영어반/ }));
}
it("다른 반 영상의 원래 게시물과 숙제를 확인한 뒤 사유를 적어 배정한다", async () => {
  const ledgerUrl = "/lesson-reports/video-homework?embed=1&from=2026-10-01&to=2026-10-31&teacher=t1";
  window.history.replaceState(null, "", ledgerUrl);
  const close = vi.fn(); render(<VideoAssignmentDialog row={row} fromDate="2026-10-01" toDate="2026-10-31" onClose={close} />);
  await pickVideo();
  expect(m.options).toHaveBeenCalledWith({ classId: "math", studentId: "student", fromDate: "2026-10-01", toDate: "2026-10-31" });
  expect(screen.getByText(/현재 연결: 영어반/)).toHaveTextContent("게시물 123");
  expect(screen.getByRole("button", { name: "영상 배정 저장" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "변경 사유" }), { target: { value: "수학 영상을 영어반에 올림" } });
  fireEvent.click(screen.getByRole("button", { name: "영상 배정 저장" }));
  await waitFor(() => expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ classId: "math", videoId: "v", revision: 4, homeworkDate: "2026-10-01" })));
  await waitFor(() => expect(close).toHaveBeenCalled());
  // 스크롤은 그대로 — router.refresh()는 장부를 맨 위로 올렸다(원장 2026-10-14, ledger-refresh.ts). 창(embed)·기간·필터가 주소 그대로 실린다.
  expect(m.refresh).toHaveBeenCalledWith(ledgerUrl, { scroll: false });
  window.history.replaceState(null, "", "/");
});
it("장부를 떠난 뒤 끝난 배정은 옮겨 간 화면을 다시 받지 않는다", async () => {
  const close = vi.fn(); render(<VideoAssignmentDialog row={row} fromDate="2026-10-01" toDate="2026-10-31" onClose={close} />);
  await pickVideo();
  fireEvent.change(screen.getByRole("textbox", { name: "변경 사유" }), { target: { value: "정정" } });
  window.history.replaceState(null, "", "/students/abc");
  fireEvent.click(screen.getByRole("button", { name: "영상 배정 저장" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(m.refresh).not.toHaveBeenCalled();
  window.history.replaceState(null, "", "/");
});
it("칸에서 연 배정 창은 그 칸의 숙제를 먼저 골라 둔다 — 목록에 없는 날이면 종전대로", async () => {
  const original = await m.options();
  m.options.mockResolvedValue({ ...original, dates: ["2026-10-08", "2026-10-01"] });
  // 종전 규칙이면 영상이 들어갈 수 있는 첫 숙제(10/01)를 고른다 — 칸에서 열었으면 그 칸(10/08)이 먼저다.
  render(<VideoAssignmentDialog row={row} initialDate="2026-10-08" fromDate="2026-10-01" toDate="2026-10-31" onClose={vi.fn()} />);
  expect(await screen.findByRole("combobox", { name: "배정할 영상 숙제" })).toHaveValue("2026-10-08");
  cleanup();
  render(<VideoAssignmentDialog row={row} initialDate="2026-09-01" fromDate="2026-10-01" toDate="2026-10-31" onClose={vi.fn()} />);
  expect(await screen.findByRole("combobox", { name: "배정할 영상 숙제" })).toHaveValue("2026-10-01");
});
// 원장 2026-10-23 — 이영준: 최근 숙제(10/20)를 먼저 골라 이미 붙은 영상 하나만 보여 "다 배정됐다"로 읽혔다. 안 붙은 영상은 10/13 숙제에만 들어간다.
it("아직 안 붙은 영상이 들어갈 숙제를 먼저 골라 두고, 안 붙은 영상을 목록 맨 위에 둔다", async () => {
  const original = await m.options();
  const base = { ...original.videos[0], className: "수학반", classId: "math" };
  m.options.mockResolvedValue({ ...original, dates: ["2026-10-20", "2026-10-13"], videos: [
    { ...base, id: "late", homeworkDate: "2026-10-20", postedAt: "2026-10-22T14:10:00Z" },
    { ...base, id: "first", homeworkDate: "2026-10-13", postedAt: "2026-10-15T14:13:00Z" },
    { ...base, id: "loose", homeworkDate: null, free: true, note: "10월13일 2단원", postedAt: "2026-10-15T14:16:00Z" },
  ] });
  render(<VideoAssignmentDialog row={{ ...row, assignedDates: ["2026-10-13", "2026-10-20"] }} fromDate="2026-10-01" toDate="2026-10-31" onClose={vi.fn()} />);
  expect(await screen.findByRole("combobox", { name: "배정할 영상 숙제" })).toHaveValue("2026-10-13");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("combobox", { name: "영상 선택" }));
  expect(within(await screen.findByRole("listbox")).getAllByRole("option").map(option => option.textContent)[0]).toMatch(/숙제 없이 올림.*10월13일 2단원/);
});
it("저장 충돌은 창을 닫지 않고 이유를 보여 준다", async () => {
  m.save.mockResolvedValue({ ok: false, error: "다른 곳에서 변경됐습니다." }); const close = vi.fn();
  render(<VideoAssignmentDialog row={row} fromDate="2026-10-01" toDate="2026-10-31" onClose={close} />);
  await pickVideo();
  fireEvent.change(screen.getByRole("textbox", { name: "변경 사유" }), { target: { value: "정정" } });
  fireEvent.click(screen.getByRole("button", { name: "영상 배정 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("다른 곳"); expect(close).not.toHaveBeenCalled();
});
it("영상 목록은 제목행 없이 배정 상태를 보여 주고, 숙제일~14일 범위를 벗어난 영상과 날짜 변경 전 선택을 제거한다", async () => {
  const original = await m.options();
  m.options.mockResolvedValue({ ...original, dates: ["2026-10-01", "2026-11-01"], videos: [
    ...original.videos, { ...original.videos[0], id: "march", postedAt: "2026-03-15T12:54:02+09:00", source: "ClassNote / Drive" },
    { ...original.videos[0], id: "before", postedAt: "2026-09-30T23:59:59+09:00" },
    { ...original.videos[0], id: "after15", postedAt: "2026-10-16T00:00:00+09:00" },
    { ...original.videos[0], id: "unassigned", className: null, homeworkDate: null },
    { ...original.videos[0], id: "automatic", homeworkDate: null },
    { ...original.videos[0], id: "free", homeworkDate: null, free: true, note: "개념 강의 찍기" },
    { ...original.videos[0], id: "excluded", excluded: true },
  ] });
  render(<VideoAssignmentDialog row={row} fromDate="2026-10-01" toDate="2026-11-01" onClose={vi.fn()} linked={new Map([["automatic", "2026-10-01"]])} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("combobox", { name: "영상 선택" }));
  expect(screen.queryByText("게시일")).not.toBeInTheDocument();
  expect(screen.queryByText("반", { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText("연결된 숙제")).not.toBeInTheDocument();
  expect(screen.queryByText(/ClassNote|Drive|2026-03-15|2026-09-30|2026-10-16/)).not.toBeInTheDocument();
  // "2026-10-02 배정"은 "10/2에 배정한 날"로 읽혔다(원장 2026-10-13) — 어느 숙제에 붙었나를 말한다.
  expect(screen.getByRole("option", { name: /10\.02 숙제에 연결됨/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /10\.01 숙제에 자동 연결됨/ })).toBeInTheDocument();
  // "이 기간 숙제엔 안 붙음"은 "붙일 수 없다"로 읽혔다(원장 2026-10-15) — 짧게 · 숙제를 안 고르고 올린 영상은 그렇게 말한다.
  expect(screen.getByRole("option", { name: /연결 안 됨/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /숙제 없이 올림.*개념 강의 찍기/ })).toBeInTheDocument();
  expect(screen.queryByText(/이 기간/)).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /배정$|미배정|숙제일 미지정/ })).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: /집계 제외/ })).toBeInTheDocument();
  await user.click(screen.getByRole("option", { name: /10\.02 숙제에 연결됨/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "변경 사유" }), { target: { value: "정정" } });
  expect(screen.getByRole("button", { name: "영상 배정 저장" })).toBeEnabled();
  fireEvent.change(screen.getByRole("combobox", { name: "배정할 영상 숙제" }), { target: { value: "2026-11-01" } });
  expect(screen.getByRole("combobox", { name: "영상 선택" })).toBeDisabled();
  expect(screen.queryByText(/현재 연결:/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "영상 배정 저장" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("배정할 수 있는 업로드 완료 영상이 없습니다");
});
// 원장 2026-10-22 '숙제없음 칸에 바로 배정' — 숙제 0건 반의 줄에서 연 창은 그 학생이 들은 수업일(숙제없음)을 고른다.
it("숙제가 없으면 영상이 들어갈 수 있는 숙제없음 수업일을 골라 두고, 그날로 저장한다 — 영상이 못 들어가는 수업일은 늘어놓지 않는다", async () => {
  const original = await m.options();
  m.options.mockResolvedValue({ ...original, dates: [], blankDates: ["2026-09-24", "2026-10-01", "2026-10-05"],
    videos: [{ ...original.videos[0], homeworkDate: null, free: true, note: "10월 1일 숙제", postedAt: "2026-10-02T10:00:00Z" }] });
  render(<VideoAssignmentDialog row={{ ...row, assignedDates: [], lessonDates: ["2026-09-24", "2026-10-01", "2026-10-05"] }} fromDate="2026-09-20" toDate="2026-10-31" onClose={vi.fn()} />);
  const select = await screen.findByRole("combobox", { name: "배정할 영상 숙제" });
  expect(select).toHaveValue("2026-09-24");
  // 9/24 수업 → 10/2 영상은 14일 안이라 들어간다 · 10/5 수업은 영상보다 늦어 못 받는다
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["수학반 · 2026-09-24 · 숙제없음 수업", "수학반 · 2026-10-01 · 숙제없음 수업", "숙제 완료 집계에서 제외"]);
  expect(screen.getByText(/영상 숙제가 없던 수업입니다/)).toBeInTheDocument();
  fireEvent.change(select, { target: { value: "2026-10-01" } });
  await pickVideo();
  fireEvent.change(screen.getByRole("textbox", { name: "변경 사유" }), { target: { value: "메모 보고 배정" } });
  fireEvent.click(screen.getByRole("button", { name: "영상 배정 저장" }));
  await waitFor(() => expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ homeworkDate: "2026-10-01", excluded: false })));
});
it("칸에서 연 숙제없음 날은 영상이 못 들어가도 골라 둔다(왜 못 붙이는지 보인다)", async () => {
  const original = await m.options();
  m.options.mockResolvedValue({ ...original, dates: [], blankDates: ["2026-10-01", "2026-10-05"] });
  render(<VideoAssignmentDialog row={row} initialDate="2026-10-05" fromDate="2026-10-01" toDate="2026-10-31" onClose={vi.fn()} />);
  expect(await screen.findByRole("combobox", { name: "배정할 영상 숙제" })).toHaveValue("2026-10-05");
  expect(screen.getByRole("status")).toHaveTextContent("배정할 수 있는 업로드 완료 영상이 없습니다");
});
it("숙제도 숙제없음 수업일도 없으면 고를 것이 없다고 말한다", async () => {
  m.options.mockResolvedValue({ ok: true, dates: [], blankDates: [], videos: [] });
  render(<VideoAssignmentDialog row={row} fromDate="2026-10-01" toDate="2026-10-31" onClose={vi.fn()} />);
  expect(await screen.findByText("조회 기간에 영상을 붙일 숙제나 수업일이 없습니다.")).toBeInTheDocument();
});
// 적대적 리뷰 2026-10-22 — 숙제없음 날에 다른 숙제 칸의 영상을 옮기면 그 숙제가 다시 미확인·미수행이 되고 알림이 나간다.
it("숙제없음 수업일엔 아직 칸에 안 붙은 영상만 — 고른 숙제 · 자동 연결 · 다른 반 · 집계 제외 영상은 숙제 날짜에서만", async () => {
  const original = await m.options();
  const base = { ...original.videos[0], homeworkDate: null, className: "수학반", classId: "math" };
  m.options.mockResolvedValue({ ...original, dates: ["2026-10-01"], blankDates: ["2026-10-02"], videos: [
    { ...base, id: "loose", postedAt: "2026-10-03T10:00:00Z" },
    { ...base, id: "picked", homeworkDate: "2026-10-01", postedAt: "2026-10-03T11:00:00Z" },
    { ...base, id: "auto", postedAt: "2026-10-03T12:00:00Z" },
    { ...base, id: "other", classId: "eng", className: "영어반", postedAt: "2026-10-03T13:00:00Z" },
    { ...base, id: "gone", excluded: true, postedAt: "2026-10-03T14:00:00Z" },
  ] });
  render(<VideoAssignmentDialog row={row} initialDate="2026-10-02" fromDate="2026-10-01" toDate="2026-10-31" onClose={vi.fn()} linked={new Map([["auto", "2026-10-01"]])} />);
  expect(await screen.findByRole("combobox", { name: "배정할 영상 숙제" })).toHaveValue("2026-10-02");
  expect(screen.getByText(/영상 선택 \(1개\)/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "배정할 영상 숙제" }), { target: { value: "2026-10-01" } });
  expect(screen.getByText(/영상 선택 \(5개\)/)).toBeInTheDocument();
});
it("옮겨 남긴 숙제 칸에 붙은 영상을 옮기면 그 칸이 비어 남는다고 알린다 · 칸 날짜를 못 고르면 그 까닭을 말한다", async () => {
  const original = await m.options();
  m.options.mockResolvedValue({ ...original, dates: ["2026-10-01", "2026-10-02"], videos: [{ ...original.videos[0], homeworkDate: "2026-10-02" }] });
  render(<VideoAssignmentDialog row={{ ...row, assignedDates: ["2026-10-01", "2026-10-02"], kept: ["2026-10-02"] }} initialDate="2026-09-20"
    fromDate="2026-10-01" toDate="2026-10-31" onClose={vi.fn()} />);
  expect(await screen.findByText(/2026-09-20은\(는\) 고를 수 있는 숙제·수업일이 아니어서/)).toBeInTheDocument();
  await pickVideo();
  expect(screen.getByText(/지금 2026-10-02 칸.*'숙제 취소'로 거둘/)).toBeInTheDocument();
});
