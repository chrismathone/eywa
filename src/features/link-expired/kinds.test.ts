import { describe, expect, it } from "vitest";
import { REPORT_SHARE_LINK_DAYS } from "@/features/onescreen/share-expiry";
import {
  expiredLinkCopy,
  expiredLinkHref,
  LINK_EXPIRED_PATH,
  LINK_EXPIRED_TITLE,
  parseExpiredLinkKind,
  VIDEO_SUBMIT_LINK_DAYS,
} from "./kinds";

describe("링크 만료 문구 — 종류별 한 줄(원장 2026-10-01)", () => {
  it("보고서 = 보고서일로부터 90일 · 담당 선생님께 다시 요청", () => {
    const { title, detail } = expiredLinkCopy("report");
    expect(title).toBe("링크가 만료되었습니다");
    expect(detail).toBe("수업보고서 링크는 보고서일로부터 90일 동안 열 수 있습니다. 담당 선생님께 다시 요청해 주세요.");
  });

  it("영상 제출 = 7일 · 다음 수업보고서의 새 링크", () => {
    expect(expiredLinkCopy("video").detail).toBe(
      "영상 제출 링크는 7일 동안 쓸 수 있습니다. 다음 수업보고서의 새 링크를 이용해 주세요.",
    );
  });

  it("기간 숫자는 상수에서 읽는다(문구에 박지 않는다 — 판정과 안내가 한 값)", () => {
    expect(REPORT_SHARE_LINK_DAYS).toBe(90);
    expect(VIDEO_SUBMIT_LINK_DAYS).toBe(7);
    expect(expiredLinkCopy("report").detail).toContain(`${REPORT_SHARE_LINK_DAYS}일`);
    expect(expiredLinkCopy("video").detail).toContain(`${VIDEO_SUBMIT_LINK_DAYS}일`);
  });

  it("접수 QR·직원 등록 QR은 링크마다 마감일이 달라 숫자를 적지 않는다", () => {
    for (const k of ["intake", "staff"]) {
      const { detail } = expiredLinkCopy(k);
      expect(detail).not.toMatch(/\d/);
      expect(detail).toContain("학원에 문의해 주세요");
    }
    expect(expiredLinkCopy("intake").detail).toContain("입학 상담 신청 링크");
    expect(expiredLinkCopy("staff").detail).toContain("직원 등록 링크");
  });

  it("모르는 종류·없음 → 일반 문구(제목은 같다)", () => {
    const general = expiredLinkCopy(undefined);
    expect(general.title).toBe(LINK_EXPIRED_TITLE);
    expect(general.detail).toContain("사용 기간이 지나");
    for (const raw of [null, "", "  ", "reports", "r", "kiosk", "%20report", ["unknown"]]) {
      expect(expiredLinkCopy(raw)).toEqual(general);
    }
  });

  it("🔴 프로토타입 키(`constructor`·`__proto__`·`toString`)는 종류로 안 읽힌다", () => {
    for (const raw of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(parseExpiredLinkKind(raw)).toBeNull();
      expect(typeof expiredLinkCopy(raw).detail).toBe("string");
      expect(expiredLinkCopy(raw)).toEqual(expiredLinkCopy(undefined));
    }
  });

  it("대소문자·앞뒤 공백은 너그럽게, 배열은 첫 값", () => {
    expect(parseExpiredLinkKind(" Report ")).toBe("report");
    expect(parseExpiredLinkKind(["video", "report"])).toBe("video");
    expect(parseExpiredLinkKind([])).toBeNull();
  });

  it("🔴 만료 주소엔 종류만 — 토큰·다른 쿼리 없음", () => {
    expect(expiredLinkHref("report")).toBe("/expired?kind=report");
    expect(expiredLinkHref("video")).toBe("/expired?kind=video");
    const u = new URL(expiredLinkHref("intake"), "https://example.test");
    expect(u.pathname).toBe(LINK_EXPIRED_PATH);
    expect([...u.searchParams.keys()]).toEqual(["kind"]);
  });
});
