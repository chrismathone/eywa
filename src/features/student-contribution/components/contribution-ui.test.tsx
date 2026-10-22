import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_CONFIG, emptyRaws } from "../model/config";
import { EmbedProvider } from "@/components/workspace/embed-context";
const m = vi.hoisted(() => ({ refresh: vi.fn(), save: vi.fn(), recalc: vi.fn(), search: vi.fn(), link: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("../server/actions", () => ({ saveContributionSettings: m.save, refreshContribution: m.recalc }));
vi.mock("../server/referral-actions", () => ({ searchReviewedReferrers: m.search, linkReviewedReferral: m.link }));
import { ContributionList } from "./contribution-list";
import { ContributionSettings } from "./settings-form";
import { ReferralLink } from "./referral-link";
type Data = Parameters<typeof ContributionList>[0]["data"];
function fixture(): Data {
  const total = (id: string, tuition: number, recent: number) => ({ studentId: id, raws: { ...emptyRaws(), tuitionWon: tuition },
    recent: { ...emptyRaws(), tuitionWon: recent }, computedAt: "2026-10-22T00:00:00Z", unavailable: [] });
  const row = (id: string, status: string, tuition: number, recent: number) => ({ id, name: id, status, school: "초등학교", grade: "초5", subjects: ["math"], total: total(id, tuition, recent) });
  return { gate: { tenantId: "t", userId: "owner", canConfigure: true, canWrite: true }, ready: true, missing: false, historyReady: true,
    refreshedAt: "2026-10-22T00:00:00Z", revision: 0, config: structuredClone(DEFAULT_CONFIG), subjects: [{ key: "math", label: "수학" }], grades: ["초5"],
    rows: [row("오래다닌학생", "enrolled", 1000000, 100000), row("최근기여학생", "enrolled", 500000, 500000), row("퇴원학생", "withdrawn", 2000000, 0)] };
}
beforeEach(() => { vi.resetAllMocks(); m.save.mockResolvedValue({ ok: true, message: "저장 완료" }); m.link.mockResolvedValue({ ok: true, message: "연결 완료" }); });
afterEach(cleanup);
it("재원생 기본 목록과 최근 증가분 정렬·퇴원 포함 필터", () => {
  render(<ContributionList data={fixture()} />);
  expect(screen.queryByRole("link", { name: "퇴원학생" })).toBeNull();
  const names = () => screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/student-contribution/") && a.textContent?.endsWith("학생")).map((a) => a.textContent);
  expect(names()).toEqual(["오래다닌학생", "최근기여학생"]);
  fireEvent.change(screen.getByLabelText("정렬"), { target: { value: "recent" } }); expect(names()).toEqual(["최근기여학생", "오래다닌학생"]);
  fireEvent.change(screen.getByLabelText("재원 상태"), { target: { value: "all" } }); expect(screen.getByRole("link", { name: "퇴원학생" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("학생 이름·학교 검색"), { target: { value: "퇴원" } }); expect(names()).toEqual(["퇴원학생"]);
});
it("원래 수치를 재호출하지 않아도 배점 변경 미리보기에 과거 실적 반영", async () => {
  render(<ContributionSettings data={fixture()} />);
  expect(screen.getByText("운영 35점 · 학습·참여 0점")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("수업료 기여 배점"), { target: { value: "2" } });
  expect(screen.getByText("운영 70점 · 학습·참여 0점")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "배점 저장" }));
  await waitFor(() => expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ rates: expect.objectContaining({ tuitionWon: { enabled: true, points: 2 } }) }), 0));
});
it("학생 목록을 나눠 보여 주고 검색·표시 수 변경 시 첫 페이지로 돌아간다", () => {
  const data = fixture();
  data.rows = Array.from({ length: 26 }, (_, index) => ({ ...data.rows[0]!, id: `student-${index}`, name: `학생${String(index).padStart(2, "0")}` }));
  render(<ContributionList data={data} />);
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
it("읽기 전용이면 집계 버튼이 없고 설정 입력도 잠긴다", () => {
  const data = fixture(); data.gate.canWrite = false;
  const view = render(<ContributionList data={data} />);
  expect(screen.queryByRole("button", { name: "지금 집계" })).toBeNull(); view.unmount();
  render(<ContributionSettings data={data} />); expect(screen.getByLabelText("수업료 기여 배점").closest("fieldset")?.disabled).toBe(true);
});
it("창 안의 탭과 학생 상세 링크가 창 모드를 유지한다", () => {
  render(<EmbedProvider embed><ContributionList data={fixture()} /></EmbedProvider>);
  expect(screen.getByRole("link", { name: "학생 기록 연결" }).getAttribute("href")).toBe("/student-contribution/ontology?embed=1");
  expect(screen.getByRole("link", { name: "오래다닌학생" }).getAttribute("href")).toBe("/student-contribution/오래다닌학생?embed=1");
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
