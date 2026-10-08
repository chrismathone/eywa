import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const m = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/features/video-submit/upload-client", async (original) => ({ ...await original<typeof import("@/features/video-submit/upload-client")>(), runResumableUpload: m.run, xhrPut: vi.fn() }));
import { UploadError } from "@/features/video-submit/upload-client";
import { VideoSubmitForm } from "./video-submit-form";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/start") ? new Response(JSON.stringify({ ok: true, uploadId: id, sessionUrl: "https://example.invalid/never-called" }))
    : url.endsWith("/complete") ? new Response(JSON.stringify({ ok: true })) : new Response(null, { status: 204 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
// eslint-disable-next-line shadcn/no-unknown-classes -- className is the academic class label prop, not CSS.
const classLabel = "수학";
const show = () => render(<VideoSubmitForm token={"t".repeat(43)} academyName="가상학원" studentLabel="가*생" className={classLabel} lastDayLabel="10/9" maxLabel="1GB" />);
function pick() { fireEvent.change(screen.getByLabelText("영상 고르기"), { target: { files: [new File(["video"], "test.mp4", { type: "video/mp4" })] } }); fireEvent.click(screen.getByRole("button", { name: "올리기" })); }
it("전송 오류를 학생에게 설명하고 확인번호·기록·재시도 버튼을 제공한다", async () => {
  m.run.mockImplementation(async input => { input.onEvent("failed", { reason: "timeout", attempt: 6, httpStatus: null }); throw new UploadError("failed", "timeout"); });
  show(); pick();
  expect(await screen.findByRole("alert")).toHaveTextContent("응답 대기 시간이 지났습니다");
  expect(screen.getByText(/업로드 기록 · 확인번호 aaaaaaaa/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "다시 올리기" })).toBeEnabled();
  expect(screen.queryByText("제출했습니다. 감사합니다.")).toBeNull();
});
it("기록 서버 장애가 있어도 실제 영상 제출은 성공한다", async () => {
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => url.endsWith("/event") ? Promise.reject(new Error("log unavailable")) : original(url, options)));
  m.run.mockImplementation(async input => input.onProgress(5)); show(); pick();
  expect(await screen.findByText("제출했습니다. 감사합니다.")).toBeInTheDocument();
});
