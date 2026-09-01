import { describe, expect, it } from "vitest";
import { consultOriginLabel } from "./consult-origin";

// 실측(2026-09-01) 기반 — 원장이 "왕복 버그 같다"고 의심한 그 짝이 아래 두 줄이다.
describe("consultOriginLabel — 우리가 보낸 것과 makeedu에서 온 것을 가른다", () => {
  it("🔴 우리가 보낸 QR 접수는 'makeedu 연동'이 아니다(그렇게 부르면 왕복처럼 보인다)", () => {
    expect(
      consultOriginLabel({ makeeduId: "5528", makeeduPushedAt: "2026-08-26T00:00:00Z", fromPublicIntake: true }),
    ).toBe("QR 접수 · makeedu 전송함");
  });

  it("직접 입력분을 보낸 것도 우리 기록이다", () => {
    expect(
      consultOriginLabel({ makeeduId: "5500", makeeduPushedAt: "2026-08-12T00:00:00Z", fromPublicIntake: false }),
    ).toBe("직접 입력 · makeedu 전송함");
  });

  it("보낸 적 없는데 makeedu 키가 있으면 진짜 'makeedu 연동'(가져온 것)", () => {
    expect(consultOriginLabel({ makeeduId: "1234", makeeduPushedAt: null })).toBe("makeedu 연동");
  });

  it("옛 시트 이관이 가장 앞선다", () => {
    expect(consultOriginLabel({ legacyKey: "sheet:1", makeeduId: "1", fromPublicIntake: true })).toBe("옛 시트 이관");
  });

  it("나머지 둘", () => {
    expect(consultOriginLabel({ fromPublicIntake: true })).toBe("QR 접수");
    expect(consultOriginLabel({})).toBe("직접 입력");
  });
});
