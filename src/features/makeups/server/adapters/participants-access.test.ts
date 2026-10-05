import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ mode: "on", error: null as null | { code: string; details?: string; message?: string }, rpc: vi.fn() }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ makeups: { mode: m.mode } }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: m.rpc }) }));
import { loadNativeParticipants, participantsOrLegacy } from "./participants";

beforeEach(() => {
  m.mode = "on";
  m.error = { code: "42501", details: '{"code":"forbidden"}', message: "보강관리 권한이 없습니다" };
  m.rpc.mockReset().mockImplementation(async () => ({ data: null, error: m.error }));
});

describe("기존 화면의 선택적 보강 조회", () => {
  it.each(["on", "draining"])("%s에서 메뉴 권한이 없으면 기존 명단을 그대로 사용할 수 있고 엄격 조회는 거절된다", async mode => {
    m.mode = mode;
    const legacy = [{ id: "regular" }, { id: "unlinked-reservation" }];
    const optional = await loadNativeParticipants({ session_date: "2026-10-05" }, { sharedRead: true });
    expect([...legacy, ...participantsOrLegacy(optional)]).toEqual(legacy);
    const strict = await loadNativeParticipants({ session_date: "2026-10-05" });
    expect(strict.status).toBe("failed");
    expect(() => participantsOrLegacy(strict)).toThrow("보강 참여를 확인하지 못했습니다");
  });

  it.each([
    { code: "42501", details: "forbidden" },
    { code: "42501", details: '{"code":"inactive_user"}' },
    { code: "P0001", details: '{"code":"forbidden"}' },
    { code: "08006", message: "network interrupted" },
  ])("일반 오류나 잘못된 권한 응답을 빈 보강 목록으로 숨기지 않는다: %j", async error => {
    m.error = error;
    const outcome = await loadNativeParticipants({}, { sharedRead: true });
    expect(outcome.status).toBe("failed");
    expect(() => participantsOrLegacy(outcome)).toThrow();
  });

  it("권한 있는 사용자에게 실제 보강 참여를 합치고 깨진 성공 본문은 거절한다", async () => {
    m.rpc.mockResolvedValueOnce({ data: { participants: [{ id: "native", student_id: "student", session_date: "2026-10-05", status: "unknown" }], legacy_maps: [], truncated: false }, error: null });
    expect(participantsOrLegacy(await loadNativeParticipants({}, { sharedRead: true })).map(row => row.id)).toEqual(["native"]);
    m.rpc.mockResolvedValueOnce({ data: {}, error: null });
    expect((await loadNativeParticipants({}, { sharedRead: true })).status).toBe("failed");
  });

  it("꺼진 지점은 권한 RPC를 호출하지 않는다", async () => {
    m.mode = "off";
    expect(await loadNativeParticipants({}, { sharedRead: true })).toEqual({ status: "off" });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
