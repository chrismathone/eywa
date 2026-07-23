import { describe, expect, it } from "vitest";
import { buildRefundPrefill, splitPrefill, type RefundPrefillSource } from "./refund-prefill";

const base: RefundPrefillSource = {
  name: "이정민",
  school: "성광중",
  grade: "중3",
  address: "대구 북구 …",
  enrollments: [],
  payments: [],
};

describe("buildRefundPrefill", () => {
  it("학교·학년은 압축 표기(공백 join 금지)", () => {
    expect(buildRefundPrefill(base).s_schoolGrade).toBe("성광중3");
  });

  it("값이 없는 칸은 키 자체를 안 넣는다 — 빈 문자열로 덮어쓰지 않게", () => {
    const out = buildRefundPrefill({ ...base, school: null, grade: null, address: null });
    expect("s_schoolGrade" in out).toBe(false);
    expect("s_address" in out).toBe(false);
    expect(out.s_name).toBe("이정민");
  });

  it("진행 중 수강이 있으면 그 전부를 수강반으로 — 종료된 건 섞지 않는다", () => {
    const out = buildRefundPrefill({
      ...base,
      enrollments: [
        { className: "중등M 개별 BS4A 월목", teacherName: "이성우", startDate: "2026-05-01", endDate: null },
        { className: "영어 RTT2", teacherName: "김영어", startDate: "2026-03-02", endDate: null },
        { className: "옛날반", teacherName: "박옛날", startDate: "2025-01-02", endDate: "2025-06-30" },
      ],
    });
    expect(out.s_className).toBe("중등M 개별 BS4A 월목\n영어 RTT2");
    expect(out.s_staffTeacher).toBe("이성우 · 김영어");
    expect(out.s_classDate).toBe("2026-03-02 ~ 수강중");
  });

  it("담임선생님은 담당이 정확히 1명일 때만 — 여럿이면 비운다(담임 개념 폐기)", () => {
    const one = buildRefundPrefill({
      ...base,
      enrollments: [{ className: "A", teacherName: "이성우", startDate: "2026-05-01", endDate: null }],
    });
    expect(one.s_homeroomTeacher).toBe("이성우");

    const many = buildRefundPrefill({
      ...base,
      enrollments: [
        { className: "A", teacherName: "이성우", startDate: "2026-05-01", endDate: null },
        { className: "B", teacherName: "김영어", startDate: "2026-05-01", endDate: null },
      ],
    });
    expect("s_homeroomTeacher" in many).toBe(false);
    expect(many.s_staffTeacher).toBe("이성우 · 김영어");
  });

  it("진행 중이 없으면 가장 최근 1건 — 종료일이 수강기간 끝", () => {
    const out = buildRefundPrefill({
      ...base,
      enrollments: [
        { className: "최근반", teacherName: "이성우", startDate: "2026-03-02", endDate: "2026-07-22" },
        { className: "옛날반", teacherName: "박옛날", startDate: "2025-01-02", endDate: "2025-06-30" },
      ],
    });
    expect(out.s_className).toBe("최근반");
    expect(out.s_classDate).toBe("2026-03-02 ~ 2026-07-22");
  });

  it("납부내역은 실제 납부액이 있는 것만 최근 3건", () => {
    const out = buildRefundPrefill({
      ...base,
      payments: [
        { period: "2026-07", amountPaid: 168000 },
        { period: "2026-06", amountPaid: 0 },
        { period: "2026-05", amountPaid: 168000 },
        { period: "2026-04", amountPaid: 150000 },
        { period: "2026-03", amountPaid: 150000 },
      ],
    });
    expect(out.r_paymentDetails).toBe("2026-07 168,000원 납부\n2026-05 168,000원 납부\n2026-04 150,000원 납부");
  });

  it("환불금액·차감·사유·총수업횟수는 절대 만들지 않는다(사람 판단 영역)", () => {
    const out = buildRefundPrefill({
      ...base,
      enrollments: [{ className: "A", teacherName: "이성우", startDate: "2026-05-01", endDate: null }],
      payments: [{ period: "2026-07", amountPaid: 168000 }],
    });
    for (const k of ["r_totalAmount", "r_deductionDetails", "s_reason", "s_totalSessions", "m_account"]) {
      expect(k in out).toBe(false);
    }
  });
});

describe("splitPrefill", () => {
  it("빈 칸만 채우고, 이미 다른 값이 있는 칸은 skipped", () => {
    const { fill, skipped } = splitPrefill(
      { s_name: "이정민", s_address: "대구", s_schoolGrade: "성광중3" },
      { s_name: "", s_address: "직접 쓴 주소", s_schoolGrade: "성광중3" },
    );
    expect(fill).toEqual({ s_name: "이정민" });
    expect(skipped).toEqual(["s_address"]); // 같은 값(schoolGrade)은 알릴 것도 없다
  });
});
