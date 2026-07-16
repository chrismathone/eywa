import { describe, it, expect } from "vitest";
import { SYSTEM_ROLES, type SystemRole } from "@/lib/permissions";
import {
  NOTICE_AUDIENCES,
  audienceMatchesRole,
  audiencesForRole,
  normalizeNoticeAudience,
  noticesForRole,
  type NoticeAudience,
} from "./audience";
import { isHidden } from "./popup-store";

describe("audienceMatchesRole", () => {
  const expectedByRole: Record<SystemRole, NoticeAudience[]> = {
    master: ["all", "staff", "office"],
    admin: ["all", "staff", "office"],
    manager: ["all", "staff", "office"],
    teacher: ["all", "staff", "teachers"],
    counselor: ["all", "staff", "office", "counselors"],
    accountant: ["all", "staff", "office", "accounting"],
    viewer: ["all", "staff", "office"],
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

describe("isHidden (dismiss 유효성)", () => {
  const V = "2026-06-30T00:00:00Z";

  it("엔트리 없으면 보임", () => {
    expect(isHidden(undefined, V)).toBe(false);
  });

  it("forever면 숨김", () => {
    expect(isHidden({ until: "forever", v: V }, V)).toBe(true);
  });

  it("until 미래면 숨김, 과거면 보임", () => {
    expect(isHidden({ until: Date.now() + 100_000, v: V }, V)).toBe(true);
    expect(isHidden({ until: Date.now() - 100_000, v: V }, V)).toBe(false);
  });

  it("버전(updatedAt)이 바뀌면 옛 dismiss 무시 → 재노출", () => {
    expect(isHidden({ until: "forever", v: "old-version" }, V)).toBe(false);
    expect(isHidden({ until: Date.now() + 100_000, v: "old-version" }, V)).toBe(false);
  });
});
