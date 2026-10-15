import { describe, expect, it } from "vitest";
import { ATTENDANCE_STATUS_ORDER, attendanceStatusColor } from "@/features/students/detail/attendance-tab";
import { ATT_SOFT, type AttendanceStatusKey } from "@/features/attendance/status-color";
import { BILLING_BADGE, BILLING_LABEL, type BillingStatusKey } from "@/features/billing/status-color";
import { OUTCOME_PILL } from "@/features/enrollment/outcome-meta";
import { outcomeBadge } from "@/features/enrollment/outcome-meta";

/**
 * 색 맵을 `Object.fromEntries`로 만든 곳의 **키 누락** 가드.
 *
 * v4에서 화면 로컬 색 맵들을 단일 소스에서 파생시키면서 `Object.fromEntries(...)` + `as Record<...>`
 * 패턴을 썼다. 이건 타입 단언이라 **키가 빠져도 타입체크가 통과한다** — 소비처가 `map[key]`로 인덱싱하면
 * `undefined`가 클래스 문자열 자리에 들어가고, 화이트 캔버스에선 "색이 없는 배지"가 정상처럼 보인다.
 * 그래서 런타임으로 센다.
 */
describe("파생 색 맵에 키가 빠지지 않는다", () => {
  it("학생 상세 출결 탭 — 표시 순서의 6개 상태가 전부 색을 갖는다", () => {
    for (const k of ATTENDANCE_STATUS_ORDER) {
      const cls = attendanceStatusColor(k);
      expect(cls, `attendanceStatusColor("${k}")`).toBeTruthy();
      expect(cls, `attendanceStatusColor("${k}")`).not.toContain("undefined");
    }
    // 파생원(ATT_SOFT)과 키 집합이 같아야 한다 — 한쪽에만 상태가 늘면 조용히 무색이 된다.
    expect([...ATTENDANCE_STATUS_ORDER].sort()).toEqual(
      (Object.keys(ATT_SOFT) as AttendanceStatusKey[]).sort()
    );
  });

  it("수납 배지 — 라벨과 색의 키 집합이 일치한다", () => {
    expect((Object.keys(BILLING_LABEL) as BillingStatusKey[]).sort()).toEqual(
      (Object.keys(BILLING_BADGE) as BillingStatusKey[]).sort()
    );
    for (const k of Object.keys(BILLING_LABEL) as BillingStatusKey[]) {
      expect(BILLING_BADGE[k], `BILLING_BADGE.${k}`).not.toContain("undefined");
    }
  });

  it("등록상담 outcome — 7개 상태 전부 배지 클래스가 나온다", () => {
    for (const k of Object.keys(OUTCOME_PILL)) {
      const b = outcomeBadge(k);
      expect(b.label, `outcomeBadge("${k}").label`).toBeTruthy();
      expect(b.class, `outcomeBadge("${k}").class`).toBeTruthy();
      expect(b.class).not.toContain("undefined");
    }
    // 미지의 값도 죽지 않고 pending으로 떨어진다(종전 `?? OUTCOME_BADGE.pending!`과 같은 폴백).
    expect(outcomeBadge("__unknown__").label).toBe(OUTCOME_PILL.pending!.label);
  });
});
