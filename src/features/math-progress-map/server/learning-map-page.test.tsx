import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "@/app/(shell)/mcs/progress-map/page";
import { learningMapFixture } from "../learning-map.test-fixture";
const mocks = vi.hoisted(() => ({ access: vi.fn(), preview: vi.fn(), sample: vi.fn(), query: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: mocks.access }));
vi.mock("../server/access", () => ({ canPreviewProgressMap: mocks.preview }));
vi.mock("../server/learning-map-query", () => ({ getStudentLearningMap: mocks.query }));
vi.mock("../sample", () => ({ buildSampleProgress: mocks.sample }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); }, redirect: (href: string) => { mocks.redirect(href); throw new Error("redirect"); } }));
vi.mock("../components/math-progress-dashboard", () => ({ MathProgressDashboard: () => null }));
vi.mock("../components/linked-learning-map", () => ({ LinkedLearningMap: () => null }));
beforeEach(() => vi.resetAllMocks());

describe("진도맵 실제/시안 라우팅의 권한 경계", () => {
  it("학생 실데이터는 MCS 접근을 사용하고 시안 관리자 게이트로 우회하지 않는다", async () => {
    const f = learningMapFixture();
    mocks.query.mockResolvedValue({ status: "ok", ...f });
    await expect(Page({ searchParams: Promise.resolve({ classId: f.classId, student: f.student.studentId, month: f.month, date: "2026-08-27", view: "day", display: "full", topic: "중2:직각삼각형의 합동", embed: "1" }) })).rejects.toThrow("redirect");
    expect(mocks.access).toHaveBeenCalledWith("mcs");
    expect(mocks.query).toHaveBeenCalledWith(f.classId, f.student.studentId, f.month);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.sample).not.toHaveBeenCalled();
    const url = new URL(mocks.redirect.mock.calls[0][0], "https://example.test");
    expect(url.pathname).toBe(`/mcs/${f.classId}/month`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ student: f.student.studentId, month: f.month, date: "2026-08-27", view: "day", display: "full", topic: "중2:직각삼각형의 합동", embed: "1" });
  });
  it.each(["no-goal", "failed"])("%s 상태도 목표 설정·재조회가 가능한 집중 보기로 연결한다", async status => {
    const f = learningMapFixture();
    mocks.query.mockResolvedValue({ status, ...f });
    await expect(Page({ searchParams: Promise.resolve({ classId: f.classId, student: f.student.studentId }) })).rejects.toThrow("redirect");
    expect(mocks.redirect).toHaveBeenCalledWith(`/mcs/${f.classId}/month?month=${f.month}&student=${f.student.studentId}`);
    expect(mocks.sample).not.toHaveBeenCalled();
  });
  it.each([{ classId: "bad" }, { student: "bad" }, { classId: ["one", "two"], student: "bad" }])("일부 또는 변조된 식별자는 샘플로 되돌리지 않는다: %j", async params => {
    await expect(Page({ searchParams: Promise.resolve(params) })).rejects.toThrow("404");
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.sample).not.toHaveBeenCalled();
  });
  it("권한 없는 학생은 샘플 전환 없이 404", async () => {
    const f = learningMapFixture();
    mocks.query.mockResolvedValue({ status: "not-found" });
    await expect(Page({ searchParams: Promise.resolve({ classId: f.classId, student: f.student.studentId }) })).rejects.toThrow("404");
    expect(mocks.sample).not.toHaveBeenCalled();
  });
  it("식별자 없는 시안은 여전히 관리자 이상만 본다", async () => {
    mocks.preview.mockResolvedValue(false);
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("404");
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.sample).not.toHaveBeenCalled();
    mocks.preview.mockResolvedValue(true);
    await Page({ searchParams: Promise.resolve({}) });
    expect(mocks.sample).toHaveBeenCalledOnce();
  });
});
