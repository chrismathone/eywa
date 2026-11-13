import { afterEach, describe, expect, it, vi } from "vitest";
import { adviceRequest } from "./advice-request";
const auth = vi.hoisted(() => ({ refreshSession: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth }) }));
const response = (status: number) => ({ status, ok: status < 400 }) as Response;
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("비서 처리 요청 세션 회복", () => {
  it("쓰기 전 401에만 세션을 갱신하고 동일 상태·잠금 시각을 한 번 재송신한다", async () => {
    const first = response(401), second = response(200), fetcher = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    vi.stubGlobal("fetch", fetcher); auth.refreshSession.mockResolvedValue({ data: { session: { user: { id: "u" } } }, error: null });
    const init = { method: "PATCH", body: '{"status":"adopted","statusAt":"original"}' };
    expect(await adviceRequest("/api/assistant/advice/id", init)).toBe(second);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]).toEqual(fetcher.mock.calls[1]);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ ...init, credentials: "same-origin" });
  });
  it("새 세션도 거절되면 더 반복하지 않고 인증 실패를 그대로 돌려준다", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(401)); vi.stubGlobal("fetch", fetcher);
    auth.refreshSession.mockResolvedValue({ data: { session: {} }, error: null });
    expect((await adviceRequest("/api/assistant/advice/id", {})).status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("세션 갱신 실패와 취소는 저장을 재시도하지 않는다", async () => {
    const first = response(401), fetcher = vi.fn().mockResolvedValue(first); vi.stubGlobal("fetch", fetcher);
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error("expired") });
    expect(await adviceRequest("/api/assistant/advice/id", {})).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const controller = new AbortController(); controller.abort();
    await adviceRequest("/api/assistant/advice/id", { signal: controller.signal });
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });
  it("권한 거절·동시 변경·서버 오류·연결 끊김은 반복 저장하지 않는다", async () => {
    for (const status of [200, 403, 409, 500]) {
      const fetcher = vi.fn().mockResolvedValue(response(status)); vi.stubGlobal("fetch", fetcher);
      expect((await adviceRequest("/api/assistant/advice/id", {})).status).toBe(status);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await expect(adviceRequest("/api/assistant/advice/id", {})).rejects.toThrow("network");
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });
  it("세션 갱신이 응답하지 않아도 요청 취소 시 기다림을 끝내고 재송신하지 않는다", async () => {
    const controller = new AbortController(), fetcher = vi.fn().mockResolvedValue(response(401));
    vi.stubGlobal("fetch", fetcher);
    auth.refreshSession.mockImplementation(() => { controller.abort(); return new Promise(() => {}); });
    const pending = adviceRequest("/api/assistant/advice/id", { signal: controller.signal });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
