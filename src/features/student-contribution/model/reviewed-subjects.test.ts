import { expect, it } from "vitest";
import { CONTRIBUTION_PILOT_TENANT } from "./access";
import { reviewedHistoricalSubject } from "./reviewed-subjects";
const bill = { makeedu_no: "10903", bill_month: "2022-08-01", seq: 1, item_name: "(재원생여름특강)", billed: 20000 };
it("원자료를 대조한 청구에만 출처를 붙여 과목을 보완한다", () => {
  const result = reviewedHistoricalSubject(CONTRIBUTION_PILOT_TENANT, bill);
  expect(result?.subject).toBe("english");
  expect(result?.reference).toContain("range=C2:C11");
});
it("다른 학생·지점·시기·청구 줄·수업명·금액에 검토 결과를 확대하지 않는다", () => {
  expect(reviewedHistoricalSubject("another-campus", bill)).toBeNull();
  for (const change of [{ makeedu_no: "other" }, { bill_month: "2023-08-01" }, { seq: 2 }, { item_name: "여름특강" }, { billed: 40000 }]) {
    expect(reviewedHistoricalSubject(CONTRIBUTION_PILOT_TENANT, { ...bill, ...change })).toBeNull();
  }
});
it("원장이 확인한 세 학생의 해당 청구 네 줄만 수학으로 확정한다", () => {
  const approved = [
    { makeedu_no: "09417", bill_month: "2024-02-01", seq: 5, item_name: "중등3T 월수목", billed: 278000 },
    { makeedu_no: "12303", bill_month: "2024-02-01", seq: 6, item_name: "중등3T 화수금", billed: 268000 },
    { makeedu_no: "12303", bill_month: "2024-02-01", seq: 9, item_name: "중등3T 화수금", billed: 20000 },
    { makeedu_no: "13360", bill_month: "2023-09-01", seq: 5, item_name: "중등2T 월목", billed: 120000 },
  ];
  for (const row of approved) {
    expect(reviewedHistoricalSubject(CONTRIBUTION_PILOT_TENANT, row)).toMatchObject({ subject: "math", basis: "owner_confirmed", reference: expect.stringContaining("원장 확인") });
    expect(reviewedHistoricalSubject("another-campus", row)).toBeNull();
    for (const change of [{ makeedu_no: "other" }, { bill_month: "2025-09-01" }, { seq: 99 }, { billed: 1 }, { item_name: "중등2T 화금" }])
      expect(reviewedHistoricalSubject(CONTRIBUTION_PILOT_TENANT, { ...row, ...change })).toBeNull();
  }
});
it("토요일 중등내신특강은 지점 내 수업 전체를 수학으로 확인하되 다른 특강으로 확대하지 않는다", () => {
  const special = { ...bill, makeedu_no: "unlisted-student", bill_month: "2025-04-01", item_name: "중등 내신 특강(토)" };
  expect(reviewedHistoricalSubject(CONTRIBUTION_PILOT_TENANT, special)).toMatchObject({ subject: "math", basis: "owner_confirmed" });
  expect(reviewedHistoricalSubject("another-campus", special)).toBeNull();
  expect(reviewedHistoricalSubject(CONTRIBUTION_PILOT_TENANT, { ...special, item_name: "중등내신특강(일)" })).toBeNull();
});
