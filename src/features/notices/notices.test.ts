import { describe, it, expect } from "vitest";
import { SYSTEM_ROLES, type SystemRole } from "@/lib/permissions";
import {
  NOTICE_AUDIENCES,
  audienceMatchesRole,
  audiencesForRole,
  isWithinWindow,
  normalizeNoticeAudience,
  noticesForRole,
  type NoticeAudience,
} from "./audience";
import { dismissUntil, isDismissed } from "./dismiss";

describe("audienceMatchesRole", () => {
  const expectedByRole: Record<SystemRole, NoticeAudience[]> = {
    master: ["all", "staff", "office"],
    admin: ["all", "staff", "office"],
    manager: ["all", "staff", "office"],
    teacher: ["all", "staff", "teachers"],
    counselor: ["all", "staff", "office", "counselors"],
    accountant: ["all", "staff", "office", "accounting"],
    viewer: ["all", "staff", "office"],
    parttime: ["all", "staff"],
    student: ["all"],
  };

  it.each(SYSTEM_ROLES)("%s 역할의 전체 audience 매트릭스를 정확히 적용", (role) => {
    const expected = expectedByRole[role];
    for (const audience of NOTICE_AUDIENCES) {
      expect(audienceMatchesRole(audience, role)).toBe(expected.includes(audience));
    }
    expect(audiencesForRole(role)).toEqual(expected);
  });

  it("알 수 없는 audience → 안전하게 전체 노출", () => {
    expect(audienceMatchesRole("weird", "teacher")).toBe(true);
  });

  it("office 폼 값을 보존하고 알 수 없는 값만 all로 정규화", () => {
    expect(normalizeNoticeAudience("office")).toBe("office");
    expect(normalizeNoticeAudience(" teachers ")).toBe("teachers");
    expect(normalizeNoticeAudience("weird")).toBe("all");
    expect(normalizeNoticeAudience(null)).toBe("all");
  });

  it("관리 목록은 유지하면서 카드용 목록만 역할과 limit에 맞게 파생", () => {
    const rows = NOTICE_AUDIENCES.map((audience) => ({ audience, title: audience }));
    expect(noticesForRole(rows, "teacher", 2).map((row) => row.audience)).toEqual(["all", "staff"]);
    expect(noticesForRole(rows, "teacher", 0)).toEqual([]);
    expect(rows).toHaveLength(NOTICE_AUDIENCES.length);
  });
});

describe("isDismissed (계정 단위 dismiss 유효성)", () => {
  const V = "2026-06-30T00:00:00Z";
  const NOW = Date.parse("2026-07-01T00:00:00Z");
  const iso = (ms: number) => new Date(ms).toISOString();

  it("기록 없으면 보임", () => {
    expect(isDismissed(undefined, V, NOW)).toBe(false);
  });

  it("until=null(영구)이면 숨김", () => {
    expect(isDismissed({ until: null, version: V }, V, NOW)).toBe(true);
  });

  it("until 미래면 숨김, 과거면 보임", () => {
    expect(isDismissed({ until: iso(NOW + 100_000), version: V }, V, NOW)).toBe(true);
    expect(isDismissed({ until: iso(NOW - 100_000), version: V }, V, NOW)).toBe(false);
  });

  it("버전(updatedAt)이 바뀌면 옛 dismiss 무시 → 재노출", () => {
    const OLD = "2026-06-01T00:00:00Z";
    expect(isDismissed({ until: null, version: OLD }, V, NOW)).toBe(false);
    expect(isDismissed({ until: iso(NOW + 100_000), version: OLD }, V, NOW)).toBe(false);
  });

  it("표기가 달라도 같은 시각이면 같은 버전(timestamptz 문자열 포맷 차이 흡수)", () => {
    expect(isDismissed({ until: null, version: "2026-06-30T00:00:00+00:00" }, V, NOW)).toBe(true);
  });

  it("파싱 불가 값은 숨기지 않는다(공지를 삼키지 않는 쪽으로)", () => {
    expect(isDismissed({ until: null, version: "" }, V, NOW)).toBe(false);
  });
});

describe("dismissUntil", () => {
  const NOW = Date.parse("2026-07-01T00:00:00Z");

  it("forever는 만료 없음(null)", () => {
    expect(dismissUntil("forever", NOW)).toBeNull();
  });

  it("today=1일, week=7일 뒤", () => {
    expect(dismissUntil("today", NOW)).toBe(NOW + 86_400_000);
    expect(dismissUntil("week", NOW)).toBe(NOW + 7 * 86_400_000);
  });
});

describe("isWithinWindow (팝업 노출 기간 — 요청 시각 판정)", () => {
  const at = (iso: string) => new Date(iso).getTime();
  it("빈 값은 그쪽 제한 없음", () => {
    expect(isWithinWindow(null, null, at("2026-10-14T06:58:00Z"))).toBe(true);
  });
  it("시작 전은 안 뜨고, 시작 시각부터 뜬다(경계 포함)", () => {
    const start = "2026-10-14T15:58:00+09:00";
    expect(isWithinWindow(start, null, at("2026-10-14T15:57:59+09:00"))).toBe(false);
    expect(isWithinWindow(start, null, at("2026-10-14T15:58:00+09:00"))).toBe(true);
  });
  it("종료 시각까지 뜨고 지나면 안 뜬다(경계 포함)", () => {
    const end = "2026-10-23T18:00:00+09:00";
    expect(isWithinWindow(null, end, at("2026-10-23T18:00:00+09:00"))).toBe(true);
    expect(isWithinWindow(null, end, at("2026-10-23T18:00:01+09:00"))).toBe(false);
  });
  it("해석 못 하는 값은 띄우지 않는다", () => {
    expect(isWithinWindow("엉뚱한 값", null, at("2026-10-14T06:58:00Z"))).toBe(false);
  });
});
