import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  license: { data: null as null | { is_active: boolean; expires_at: string | null }, error: null as null | { message: string } },
  channel: {
    data: null as null | {
      pf_id: string | null;
      checkin_template_id: string | null;
      checkout_template_id: string | null;
      sms_fallback: boolean;
      is_active: boolean;
    },
    error: null as null | { message: string },
  },
  sendAlimtalk: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const result = table === "tenant_licenses" ? fakes.license : fakes.channel;
      const q = {
        select() { return this; },
        eq() { return this; },
        maybeSingle: () => Promise.resolve(result),
      };
      return q;
    },
  }),
}));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettingsByTenantId: vi.fn(async () => ({ notifications: { alimtalkSenderKey: "" } })),
}));
vi.mock("./solapi", () => ({ sendAlimtalk: fakes.sendAlimtalk }));

import { resolveKakaoChannel, sendAttendanceNotification } from "./provider";

describe("카카오 등하원 알림 발송 문", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.license.data = { is_active: true, expires_at: null };
    fakes.license.error = null;
    fakes.channel.data = {
      pf_id: "pf",
      checkin_template_id: "in",
      checkout_template_id: "out",
      sms_fallback: true,
      is_active: true,
    };
    fakes.channel.error = null;
    fakes.sendAlimtalk.mockResolvedValue({ ok: true, providerMessageId: "mock" });
  });

  it("만료 행·행 없음·조회 실패면 채널을 내주지 않는다", async () => {
    fakes.license.data = { is_active: true, expires_at: "2000-01-01T00:00:00Z" };
    await expect(resolveKakaoChannel("tenant")).resolves.toBeNull();

    fakes.license.data = null;
    await expect(resolveKakaoChannel("tenant")).resolves.toBeNull();

    fakes.license.data = { is_active: true, expires_at: null };
    fakes.license.error = { message: "읽기 실패" };
    await expect(resolveKakaoChannel("tenant")).resolves.toBeNull();
    expect(fakes.sendAlimtalk).not.toHaveBeenCalled();
  });

  it("침산 조건처럼 유효하게 켜졌으면 모의 발송 함수까지 넘긴다", async () => {
    const channel = await resolveKakaoChannel("cs");
    expect(channel).not.toBeNull();

    await sendAttendanceNotification({
      channel: channel!,
      recipientPhone: "01000000000",
      studentName: "테스트",
      time: "16:00",
      academyName: "학원",
      kind: "checkin",
    });

    expect(fakes.sendAlimtalk).toHaveBeenCalledWith(expect.objectContaining({ pfId: "pf", templateId: "in" }));
  });
});
