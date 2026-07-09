import { describe, expect, it } from "vitest";
import { activityDetail } from "./activity";

describe("activityDetail — 사람이 읽는 요약", () => {
  it("영문 enum 값을 한글로 번역한다 (2026-07-08 렌더 감사)", () => {
    const { changes } = activityDetail("invoices", "UPDATE", "홍길동", {
      status: { old: "unpaid", new: "paid" },
      payment_method: { old: null, new: "card" },
    });
    expect(changes).toEqual(["상태 미납→완납", "결제수단 비움→카드"]);
  });

  it("ISO 타임스탬프는 KST 시각으로 (원문은 기계 문자열)", () => {
    const { changes } = activityDetail("textbook_orders", "UPDATE", "최하림", {
      paid_at: { old: null, new: "2026-07-08T11:33:32.691+00:00" },
    });
    expect(changes).toEqual(["납부 비움→2026. 07. 08. 20:33"]);
  });

  it("미등록 값은 원문 폴백", () => {
    const { changes } = activityDetail("students", "UPDATE", "홍길동", {
      memo: { old: "abc", new: "def" },
    });
    expect(changes).toEqual(["메모 abc→def"]);
  });

  it("uuid diff는 '변경'으로 축약 (id 원문은 정보가 아님)", () => {
    const { changes } = activityDetail("classes", "UPDATE", "중2 A반", {
      teacher_id: { old: "1f6c709b-8265-4b59-9c3b-5748f6a173c0", new: "becaa316-e636-42e9-9d09-08b133e0b094" },
    });
    expect(changes).toEqual(["담당강사 변경"]);
  });

  it("객체→객체 diff는 '변경'으로 축약 ((내용)→(내용) 무의미)", () => {
    const { changes } = activityDetail("invoices", "UPDATE", "홍길동", {
      line_items: { old: [{ a: 1 }], new: [{ a: 2 }] },
    });
    expect(changes).toEqual(["품목 변경"]);
  });

  it("redacted는 원문 없이 '변경'", () => {
    const { changes } = activityDetail("users", "UPDATE", "김강사", {
      hourly_rate: { redacted: true },
    });
    expect(changes).toEqual(["시급 변경"]);
  });

  it("머리말: 도메인 한글 + 「대상」 + 동사 / INSERT는 변경목록 없음", () => {
    const { head, changes } = activityDetail("attendance_records", "INSERT", "홍길동", { status: "present" });
    expect(head).toBe("출결 「홍길동」 생성");
    expect(changes).toEqual([]);
  });

  it("변경 8건 초과는 '외 N건'으로 접는다", () => {
    const changed = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`col_${i}`, { old: i, new: i + 1 }]),
    );
    const { changes } = activityDetail("students", "UPDATE", "홍길동", changed);
    expect(changes).toHaveLength(9);
    expect(changes[8]).toBe("외 2건");
  });
});
