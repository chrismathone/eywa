import { describe, expect, it } from "vitest";
import {
  EYWA_TAB_PREFIX,
  eywaTabPrefix,
  eywaTabTitle,
  isEywaTab,
  sanitizeSheetTitle,
} from "./sheet-tabs";

const T = "becaa316"; // 테넌트 토큰(예: tenantId.slice(0,8))
const T2 = "deadbeef"; // 다른 테넌트

describe("sheet-tabs (구글시트 공유 탭 네임스페이스)", () => {
  it("eywaTabTitle은 eywa·{tenant}· 접두를 붙인다", () => {
    expect(eywaTabTitle("수학 6월 4주", T)).toBe("eywa·becaa316·수학 6월 4주");
    expect(eywaTabTitle("박지훈", T)).toBe("eywa·becaa316·박지훈");
    expect(eywaTabTitle("_meta", T)).toBe("eywa·becaa316·_meta");
  });

  it("isEywaTab은 접두 일치로 직전 eywa 탭을 식별한다(주차 무관)", () => {
    expect(isEywaTab("eywa·becaa316·수학 6월 3주", T)).toBe(true);
    expect(isEywaTab("eywa·becaa316·박지훈", T)).toBe(true);
    // 남의(ijw) 탭은 교체 대상이 아니다
    expect(isEywaTab("수학 6월 4주", T)).toBe(false);
    expect(isEywaTab("박지훈", T)).toBe(false);
    expect(isEywaTab("Sheet1", T)).toBe(false);
  });

  it("⚠️ 다른 테넌트의 eywa 탭은 교체 대상이 아니다(교차 덮어쓰기 방지)", () => {
    expect(isEywaTab("eywa·deadbeef·수학 6월 4주", T)).toBe(false);
    expect(isEywaTab(eywaTabTitle("박지훈", T2), T)).toBe(false);
    // 자기 테넌트 탭만 매칭
    expect(isEywaTab(eywaTabTitle("박지훈", T), T)).toBe(true);
  });

  it("eywaTabPrefix는 토큰의 금지문자/구분자를 정리한다", () => {
    expect(eywaTabPrefix(T)).toBe("eywa·becaa316·");
    expect(eywaTabPrefix("a/b·c")).toBe("eywa·a_b_c·");
  });

  it("eywaTabTitle ↔ isEywaTab 라운드트립", () => {
    for (const name of ["전체", "수학 6월 4주", "Kristine", "_meta"]) {
      expect(isEywaTab(eywaTabTitle(name, T), T)).toBe(true);
    }
  });

  it("sanitizeSheetTitle은 Excel/Sheets 금지문자를 _로 바꾼다", () => {
    expect(sanitizeSheetTitle('수학/심화:반*[A]?"x"')).toBe("수학_심화_반__A___x_");
    expect(sanitizeSheetTitle("정상 이름")).toBe("정상 이름");
  });

  it("eywaTabTitle은 100자를 넘지 않는다(접두 길이 고려)", () => {
    const long = "가".repeat(200);
    const out = eywaTabTitle(long, T);
    expect(out.startsWith(EYWA_TAB_PREFIX)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(100);
  });
});
