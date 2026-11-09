import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_CONFIG, emptyRaws } from "../model/config";
import { sumRaws } from "../model/calc";
import { EmbedProvider } from "@/components/workspace/embed-context";

/** 학생 순위표는 눌러서 연다(원장 2026-10-29 요약 먼저) — 목록을 다루는 테스트는 먼저 펼친다. */
const openList = () => { const button = screen.queryByRole("button", { name: /학생 목록 보기/ }); if (button) fireEvent.click(button); };
const m = vi.hoisted(() => ({ refresh: vi.fn(), save: vi.fn(), recalc: vi.fn(), search: vi.fn(), link: vi.fn(), recent: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }), useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("../server/actions", () => ({ saveContributionSettings: m.save, refreshContribution: m.recalc }));
vi.mock("../server/recent-action", () => ({ readContributionRecent: m.recent }));
vi.mock("../server/referral-actions", () => ({ searchReviewedReferrers: m.search, linkReviewedReferral: m.link }));
import { ContributionList } from "./contribution-list";
import { ContributionSettings } from "./settings-form";
import { ReferralLink } from "./referral-link";
type Data = Parameters<typeof ContributionList>[0]["data"];
function fixture(): Data {
  const total = (id: string, tuition: number, recent: number) => ({ studentId: id, raws: { ...emptyRaws(), tuitionWon: tuition },
    recent: { ...emptyRaws(), tuitionWon: recent }, computedAt: "2026-10-22T00:00:00Z", unavailable: [] });
  const row = (id: string, status: string, tuition: number, recent: number) => ({ id, name: id, status, family: {state:"ready" as const,asOf:"2026-11-09",members:[],activeCount:status==="enrolled"?1:0,activeSiblings:0,selfActive:status==="enrolled",needsReview:0}, school: "초등학교", grade: "초5", subjects: ["math"], enrolledMonths: 13, total: total(id, tuition, recent) });
  return { month: "2026-10", checkedAt: "2026-10-22T01:00:00Z", refreshCron: "40 15 * * *", gate: { tenantId: "t", userId: "owner", canConfigure: true, canWrite: true }, ready: true, missing: false, historyReady: true,
    refreshedAt: "2026-10-22T00:00:00Z", revision: 0, config: structuredClone(DEFAULT_CONFIG), subjects: [{ key: "math", label: "수학" }], grades: ["초5"],
    rows: [row("오래다닌학생", "enrolled", 1000000, 100000), row("최근기여학생", "enrolled", 500000, 500000), row("퇴원학생", "withdrawn", 2000000, 0)] };
}
function settingsFixture(data = fixture()): Parameters<typeof ContributionSettings>[0]["data"] {
  return { parentEventsApproved: false, gate: data.gate, ready: data.ready, config: data.config, revision: data.revision, historyReady: data.historyReady,
    studentCount: data.rows.length, families:data.rows.map(r=>r.family), raws: sumRaws(data.rows.flatMap((row) => row.total ? [row.total.raws] : [])) };
}
beforeEach(() => { vi.resetAllMocks(); window.history.replaceState(null, "", "/student-contribution"); m.save.mockResolvedValue({ ok: true, message: "저장 완료" }); m.link.mockResolvedValue({ ok: true, message: "연결 완료" }); });
afterEach(cleanup);
it("재원생 기본 목록과 최근 증가분 정렬·퇴원 포함 필터", () => {
  render(<ContributionList data={fixture()} />); openList();
  expect(screen.queryByRole("link", { name: "퇴원학생" })).toBeNull();
  const names = () => screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/student-contribution/") && a.textContent?.endsWith("학생")).map((a) => a.textContent);
  expect(names()).toEqual(["오래다닌학생", "최근기여학생"]);
  fireEvent.change(screen.getByLabelText("정렬"), { target: { value: "recent" } }); expect(names()).toEqual(["최근기여학생", "오래다닌학생"]);
  fireEvent.change(screen.getByLabelText("재원 상태"), { target: { value: "all" } }); expect(screen.getByRole("link", { name: "퇴원학생" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("학생 이름·학교 검색"), { target: { value: "퇴원" } }); expect(names()).toEqual(["퇴원학생"]);
});
it("기간을 바꾸고 낮은 순으로 정렬하며 늦게 끝난 이전 조회는 무시한다", async () => {
  let finishThree!: (value: unknown) => void;
  m.recent.mockImplementation(({ period }: { period: number }) => period === 3 ? new Promise((resolve) => { finishThree = resolve; })
    : Promise.resolve({ rows: [{ studentId: "오래다닌학생", recent: { ...emptyRaws(), tuitionWon: -200000 } }, { studentId: "최근기여학생", recent: { ...emptyRaws(), tuitionWon: 100000 } }] }));
  render(<ContributionList data={fixture()} />); openList();
  fireEvent.change(screen.getByLabelText("변화 조회 기간"), { target: { value: "3" } });
  await waitFor(() => expect(m.recent).toHaveBeenCalledWith(expect.objectContaining({ period: 3 })));
  fireEvent.change(screen.getByLabelText("변화 조회 기간"), { target: { value: "6" } });
  fireEvent.change(screen.getByLabelText("정렬"), { target: { value: "recent" } });
  fireEvent.change(screen.getByLabelText("정렬 방향"), { target: { value: "asc" } });
  await waitFor(() => expect(screen.queryByText("최근 6개월 변화를 불러오는 중입니다.")).toBeNull());
  const names = () => screen.getAllByRole("link").filter((a) => a.textContent?.endsWith("학생")).map((a) => a.textContent);
  expect(names()).toEqual(["오래다닌학생", "최근기여학생"]);
  finishThree({ rows: [{ studentId: "오래다닌학생", recent: { ...emptyRaws(), tuitionWon: 9000000 } }] });
  await waitFor(() => expect((screen.getByLabelText("변화 조회 기간") as HTMLSelectElement).value).toBe("6"));
  expect(names()).toEqual(["오래다닌학생", "최근기여학생"]);
  expect(screen.getByRole("columnheader", { name: "최근 6개월 ↑" }).getAttribute("aria-sort")).toBe("ascending");
});
it("조회 실패를 0점으로 채우지 않고 재시도할 수 있다", async () => {
  m.recent.mockResolvedValueOnce({ error: "조회 실패" }).mockResolvedValueOnce({ rows: [] });
  render(<ContributionList data={fixture()} />); openList();
  fireEvent.change(screen.getByLabelText("변화 조회 기간"), { target: { value: "1" } });
  expect(await screen.findByText("조회 실패")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(m.recent).toHaveBeenCalledTimes(2));
});
it("집계 기준이 바뀌면 옛 기준 재시도 대신 페이지 데이터를 새로 읽는다", async () => {
  m.recent.mockResolvedValue({ error: "집계 기준 변경", code: "stale" });
  render(<ContributionList data={fixture()} />); openList();
  fireEvent.change(screen.getByLabelText("변화 조회 기간"), { target: { value: "3" } });
  fireEvent.click(await screen.findByRole("button", { name: "새로고침" }));
  expect(m.refresh).toHaveBeenCalledOnce(); expect(m.recent).toHaveBeenCalledOnce();
});
it("원래 수치를 재호출하지 않아도 배점 변경 미리보기에 과거 실적 반영", async () => {
  render(<ContributionSettings data={settingsFixture()} />);
  expect(screen.getByText("운영 35점 · 학습·참여 0점 · 가족 0점")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("수업료 기여 배점"), { target: { value: "2" } });
  expect(screen.getByText("운영 70점 · 학습·참여 0점 · 가족 0점")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "배점 저장" }));
  await waitFor(() => expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ rates: expect.objectContaining({ tuitionWon: { enabled: true, points: 2 } }) }), 0));
});
it("학생 목록을 나눠 보여 주고 검색·표시 수 변경 시 첫 페이지로 돌아간다", () => {
  const data = fixture();
  data.rows = Array.from({ length: 26 }, (_, index) => ({ ...data.rows[0]!, id: `student-${index}`, name: `학생${String(index).padStart(2, "0")}` }));
  render(<ContributionList data={data} />); openList();
  expect(screen.queryByRole("link", { name: "학생10" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "학생 목록 다음 페이지" }));
  expect(screen.getByRole("link", { name: "학생10" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "학생00" })).toBeNull();
  fireEvent.change(screen.getByLabelText("학생 이름·학교 검색"), { target: { value: "학생25" } });
  expect(screen.getByRole("link", { name: "학생25" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "학생 목록 이전 페이지" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("학생 이름·학교 검색"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("학생 목록 표시 수"), { target: { value: "20" } });
  expect(screen.getByRole("link", { name: "학생19" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "학생20" })).toBeNull();
});
it("상세에서 돌아오면 직전 목록의 페이지·정렬·필터를 복구한다", () => {
  const data = fixture();
  data.rows = Array.from({ length: 24 }, (_, i) => ({ ...data.rows[0]!, id: `s${i}`, name: `학생${String(i).padStart(2, "0")}` }));
  const first = render(<ContributionList data={data} />); openList();
  fireEvent.change(screen.getByLabelText("재원 상태"), { target: { value: "all" } });
  fireEvent.change(screen.getByLabelText("정렬"), { target: { value: "recent" } });
  fireEvent.click(screen.getByRole("button", { name: "학생 목록 다음 페이지" }));
  const href = screen.getByRole("link", { name: "학생10" }).getAttribute("href")!;
  const saved = new URL(href, "https://test.local").searchParams.get("list");
  first.unmount(); window.history.replaceState(null, "", `/student-contribution?${saved}`);
  render(<ContributionList data={data} />); openList();
  expect(screen.getByRole("link", { name: "학생10" })).toBeTruthy(); expect(screen.queryByRole("link", { name: "학생00" })).toBeNull();
  expect((screen.getByLabelText("재원 상태") as HTMLSelectElement).value).toBe("all");
  expect((screen.getByLabelText("정렬") as HTMLSelectElement).value).toBe("recent");
});
it("셸이 목록 컴포넌트를 유지해도 외부 URL 변경과 새 메뉴의 초기값을 따른다", () => {
  const data = fixture(); data.rows = Array.from({ length: 24 }, (_, i) => ({ ...data.rows[0]!, id: `s${i}`, name: `학생${String(i).padStart(2, "0")}` }));
  const view = render(<ContributionList data={data} />); openList();
  window.history.replaceState(null, "", "/student-contribution?page=2"); view.rerender(<ContributionList data={data} />);
  expect(screen.getByRole("link", { name: "학생10" })).toBeTruthy(); expect(screen.queryByRole("link", { name: "학생00" })).toBeNull();
  window.history.replaceState(null, "", "/student-contribution"); view.rerender(<ContributionList data={data} />);
  expect(screen.getByRole("link", { name: "학생00" })).toBeTruthy();
});
it("읽기 전용이면 집계 버튼이 없고 설정 입력도 잠긴다", () => {
  const data = fixture(); data.gate.canWrite = false;
  const view = render(<ContributionList data={data} />); openList();
  expect(screen.queryByRole("button", { name: "지금 집계" })).toBeNull(); view.unmount();
  render(<ContributionSettings data={settingsFixture(data)} />); expect(screen.queryByRole("button", {name:"배점 저장"})).toBeNull(); expect(screen.queryByRole("button", {name:"변경 취소"})).toBeNull(); expect(screen.getByLabelText("수업료 기여 배점").closest("fieldset")?.disabled).toBe(true);
});
it("창 안의 탭과 학생 상세 링크가 창 모드를 유지한다", () => {
  render(<EmbedProvider embed><ContributionList data={fixture()} /></EmbedProvider>); openList();
  expect(screen.getByRole("link", { name: "학생 기록 연결" }).getAttribute("href")).toBe("/student-contribution/ontology?embed=1");
  expect(decodeURI(screen.getByRole("link", { name: "오래다닌학생" }).getAttribute("href")!)).toBe("/student-contribution/오래다닌학생?embed=1");
  fireEvent.change(screen.getByLabelText("정렬"), { target: { value: "recent" } });
  expect(new URLSearchParams(window.location.search).get("embed")).toBe("1");
});
it("자동 후보가 없는 상담도 퇴원생 검색 후 근거를 적어 명시 연결", async () => {
  m.search.mockResolvedValue({ options: [{ id: "withdrawn", label: "김학생 · 초등학교 초5 · 퇴원" }] });
  render(<ReferralLink consultationId="c" options={[]} />);
  fireEvent.change(screen.getByLabelText("소개자 이름 검색"), { target: { value: "김학생" } });
  fireEvent.click(screen.getByRole("button", { name: "원생 찾기" }));
  await screen.findByRole("option", { name: "김학생 · 초등학교 초5 · 퇴원" });
  fireEvent.change(screen.getByLabelText("확인한 소개자"), { target: { value: "withdrawn" } });
  expect((screen.getByRole("button", { name: "확인한 소개자 연결" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("소개 연결 확인 근거"), { target: { value: "상담 원문과 보호자 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "확인한 소개자 연결" }));
  await waitFor(() => expect(m.link).toHaveBeenCalledWith({ consultationId: "c", studentId: "withdrawn", reason: "상담 원문과 보호자 확인" }));
  expect(await screen.findByText("연결 완료")).toBeTruthy();
});

it("가족 배점을 수정하면 저장 미리보기와 저장 요청에 함께 반영한다", async () => {
  const data=fixture();data.rows[0].family={...data.rows[0].family,activeCount:3,activeSiblings:2};
  render(<ContributionSettings data={settingsFixture(data)} />);
  expect(screen.getByText("운영 35점 · 학습·참여 0점 · 가족 250점")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("3남매 재원 가족 배점"),{target:{value:"300"}});
  expect(screen.getByText("운영 35점 · 학습·참여 0점 · 가족 300점")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"배점 저장"}));
  await waitFor(()=>expect(m.save).toHaveBeenCalledWith(expect.objectContaining({family:expect.objectContaining({three:300})}),0));
});
