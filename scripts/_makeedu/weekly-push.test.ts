import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const W = require_("./weekly-push.cjs") as {
  weeklyBucketOf: (now?: Date) => string;
  WEEKLY_HOUR_KST: number;
};
const L = require_("./lib.cjs") as {
  isPushableConsultation: (outcome: string, studentMakeeduId: string | null | undefined) => boolean;
};

// 2026-08-30 = 일요일. 아래 시각은 전부 KST(+09:00)로 적는다 — 이 규칙 자체가 KST 벽시계 기준이다.
const kst = (iso: string) => new Date(`${iso}+09:00`);

describe("주간 버킷 — 일요일 06:00 KST 경계", () => {
  it("경계 시각(일 06:00)에 새 버킷이 열린다", () => {
    expect(W.weeklyBucketOf(kst("2026-08-30T06:00:00"))).toBe("weekly:2026-08-30");
  });

  it("경계 **이전**(일 05:59)은 아직 지난 주 버킷 — 06:00이 지나야 밀린다", () => {
    expect(W.weeklyBucketOf(kst("2026-08-30T05:59:59"))).toBe("weekly:2026-08-23");
  });

  it("주중 아무 때나 = 그 주 일요일 버킷(워처가 꺼져 있었으면 켜질 때 따라잡는다)", () => {
    expect(W.weeklyBucketOf(kst("2026-09-01T10:00:00"))).toBe("weekly:2026-08-30");
    expect(W.weeklyBucketOf(kst("2026-09-05T23:59:59"))).toBe("weekly:2026-08-30");
  });

  it("다음 일요일 06:00에 정확히 7일 뒤 버킷으로 넘어간다", () => {
    expect(W.weeklyBucketOf(kst("2026-09-06T05:59:59"))).toBe("weekly:2026-08-30");
    expect(W.weeklyBucketOf(kst("2026-09-06T06:00:00"))).toBe("weekly:2026-09-06");
  });

  it("KST 기준이라 UTC 날짜와 갈려도 같은 버킷을 준다", () => {
    // 2026-08-29T21:00Z == 2026-08-30 06:00 KST (UTC로는 아직 토요일)
    expect(W.weeklyBucketOf(new Date("2026-08-29T21:00:00Z"))).toBe("weekly:2026-08-30");
    // 2026-08-29T20:59Z == 05:59 KST → 아직 지난 주
    expect(W.weeklyBucketOf(new Date("2026-08-29T20:59:00Z"))).toBe("weekly:2026-08-23");
  });

  it("한 주 안에서는 몇 번을 물어도 같은 키 — 15초마다 도는 워처가 다시 밀지 않는다", () => {
    const keys = new Set(
      ["2026-08-30T06:00:00", "2026-08-31T03:12:00", "2026-09-03T18:40:00", "2026-09-06T05:00:00"].map(
        (t) => W.weeklyBucketOf(kst(t)),
      ),
    );
    expect([...keys]).toEqual(["weekly:2026-08-30"]);
  });

  it("경계 시각은 원장 지정값(06시)에서 온다", () => {
    expect(W.WEEKLY_HOUR_KST).toBe(6);
  });
});

// 앱 단일 소스 = src/features/integrations/push-eligibility.ts. CJS 쪽은 lib.cjs 한 벌만 두고
// 주간 적재(weekly-push)와 제출(push-consultations)이 함께 쓴다 — 갈리면 한쪽만 보내거나 두 번 보낸다.
describe("푸시 대상 판정 — 앱 규칙과 같은 한 벌", () => {
  it("등록 전 상태는 모두 보낼 수 있다", () => {
    for (const o of ["pending", "scheduled", "consulted", "ai_done", "declined", "no_show"]) {
      expect(L.isPushableConsultation(o, null)).toBe(true);
      expect(L.isPushableConsultation(o, "14067")).toBe(true);
    }
  });

  it("등록완료 + makeedu 원생 = 제외(다니는 학생을 신규 문의로 밀지 않는다)", () => {
    expect(L.isPushableConsultation("enrolled", "14067")).toBe(false);
  });

  it("등록완료지만 makeedu에 학생이 없으면 = 보낸다(권도현 케이스)", () => {
    expect(L.isPushableConsultation("enrolled", null)).toBe(true);
    expect(L.isPushableConsultation("enrolled", undefined)).toBe(true);
    expect(L.isPushableConsultation("enrolled", "")).toBe(true);
  });
});
