import { licenseExplicitlyOn, type LicenseRow } from "@/lib/license/rule";

/** 카카오 등하원 알림은 기본 꺼짐이다. 행 없음·조회 실패·끔·만료는 모두 발송하지 않는다. */
export function kakaoLicenseActive(row: LicenseRow, readFailed = false, now: Date = new Date()): boolean {
  return !readFailed && licenseExplicitlyOn(row, now);
}
