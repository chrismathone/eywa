import { describe, expect, it } from "vitest";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { isEmptyCard, summaryOf } from "./summary";

const ok = <T,>(data: T) => ({ data, at: 1, error: false });
const snap = (sections: Record<string, unknown>) => ({ today: "2026-10-01", subjects: { math: "수학" }, sections }) as unknown as OverviewSnapshot;

describe("요약형 값 = 카드가 그리는 값", () => {
  it("KPI는 카드 숫자와 같은 배열을 센다", () => {
    expect(summaryOf("kpi:intake", snap({ intake: ok([{ id: "1" }, { id: "2" }]) }))).toMatchObject({ value: "2", unit: "건" });
    // 퇴원 칸은 서버가 고른 달(1~10일은 지난달 · 원장 2026-11-03)을 적는다 — '이번 달'로 고정하면 KPI 칸 꼬리표와 어긋난다.
    expect(summaryOf("kpi:withdrawals", snap({ withdrawals: ok({ month: "2026-10", rows: [{ id: "a" }, { id: "b" }] }) }))).toMatchObject({ value: "2", detail: "26.10 퇴원(수강종료) · 수업료 낸 달 기준" });
    expect(summaryOf("kpi:absent", snap({ absent: ok({ from: "2026-09-23", to: "2026-09-29", students: [{}] }) }))).toMatchObject({ value: "1", detail: "최근 7일 결석", danger: true });
  });

  it("이번 달 수납 — 금액 옵션이 꺼지면 건수만, 켜면 미수 잔액", () => {
    const s = snap({ billing: ok([{ totalCount: 10, paidCount: 6, partialCount: 1, unpaidCount: 3, outstanding: 2_340_000, totalBilled: 0, totalDiscount: 0 }]) });
    expect(summaryOf("panel:billingMonth", s)).toMatchObject({ value: "6/10", detail: "미납·부분납 4건" });
    expect(summaryOf("panel:billingMonth", s, { amounts: true })?.detail).toBe("미수 잔액 234만원");
  });

  it("출결 현황 — (출석+지각)/기록 칸, 기록이 없으면 '—'", () => {
    expect(summaryOf("panel:attendance", snap({ attendance: ok({ total: 10, present: 7, late: 1, absent: 2, excused: 0 }) }))?.value).toBe("80");
    expect(summaryOf("panel:attendance", snap({ attendance: ok(null) }))?.value).toBe("—");
  });

  it("레벨테스트 일정 — 취소된 일정(kind null)은 숫자에 안 든다 · 어제 줄('전일 입테'용)은 일정 카드에 안 든다", () => {
    const day = { startDate: "2026-10-01", endDate: "2026-10-01" };
    const yday = { startDate: "2026-09-30", endDate: "2026-09-30" };
    const s = snap({
      calendar: ok([
        { kind: "levelTest", ...yday },
        { kind: "levelTest", ...day },
        { kind: "firstClass", ...day },
        { kind: null, cancelledKind: "levelTest", ...day },
      ]),
    });
    expect(summaryOf("panel:admissionsSchedule", s)).toMatchObject({ value: "2", detail: "한 달 · 입테 1 · 첫수업 1" });
    // KPI '전일 입테' = 어제 입테만.
    expect(summaryOf("kpi:calendar", s)).toMatchObject({ value: "1", detail: "전일 레벨테스트" });
    // 어제 줄만 있으면 일정 카드는 비어 있다(얇게).
    expect(isEmptyCard("panel:admissionsSchedule", snap({ calendar: ok([{ kind: "levelTest", ...yday }]) }))).toBe(true);
  });

  it("빈 카드 판정(얇게 그린다)", () => {
    expect(isEmptyCard("panel:notices", snap({ notices: ok([]) }))).toBe(true);
    expect(isEmptyCard("panel:notices", snap({}))).toBe(false);
    expect(isEmptyCard("panel:attendance", snap({ attendance: ok(null) }))).toBe(false);
  });
});
