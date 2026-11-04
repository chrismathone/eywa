import { describe, expect, it } from "vitest";
import { emptyRefund } from "@/features/billing/refund-request";
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

  it("퇴원 사유·세부 사유는 그 칸에서만 한글로(영문 키 원문 금지)", () => {
    const { changes } = activityDetail("enrollments", "UPDATE", "홍길동", {
      withdrawal_reason: { old: "other", new: "dissatisfaction" },
      withdrawal_detail: { old: null, new: "teacher_left" },
    });
    expect(changes).toEqual(["퇴원사유 기타→수업·강사", "세부 사유 비움→강사 퇴사"]);
  });

  it("원생 보호자2 칸(s2_0022)은 화면 이름표 그대로 — 영문 칸 이름이 새지 않는다", () => {
    const { changes } = activityDetail("students", "UPDATE", "한별", {
      parent2_name: { old: null, new: "김어머니" },
      parent2_phone: { old: null, new: "010-1234-5678" },
      parent2_relation: { old: "모", new: null },
    });
    expect(changes).toEqual(["보호자2 이름 비움→김어머니", "보호자2 연락처 비움→010-1234-5678", "보호자2 관계 모→비움"]);
    expect(changes.join(" ")).not.toMatch(/parent2/);
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

// 환불요청서 서식 내용(academy_documents.form_data 중첩 jsonb)을 필드별 한글로 펼침(0085a redact 해제분).
// 그 외 폼(이력서 등)은 트리거가 redacted로 남겨 위 "redacted" 경로로 처리된다.
describe("activityDetail — 환불요청서 form_data 필드별 한글 펼침", () => {
  const base = () => {
    const d = emptyRefund();
    d.student.name = "홍길동";
    d.refund.totalAmount = "300000";
    return d;
  };

  it("바뀐 필드만 한글 라벨로 펼친다(안 바뀐 필드 제외, 영문 키 미노출)", () => {
    const before = base();
    const after = base();
    after.refund.totalAmount = "250000";
    after.student.reason = "이사로 인한 퇴원";
    after.refund.method.account = "1002-123-456789";

    const { head, changes } = activityDetail("academy_documents", "UPDATE", "환불 요청서 — 홍길동", {
      form_data: { old: before, new: after },
    });
    expect(head).toBe("문서 「환불 요청서 — 홍길동」 수정");
    expect(changes).toContain("총환불금액 300000→250000");
    expect(changes).toContain("환불사유 비움→이사로 인한 퇴원");
    expect(changes).toContain("환불방식-계좌 비움→1002-123-456789");
    expect(changes.some((c) => c.startsWith("학생명"))).toBe(false); // 안 바뀐 필드 제외
    expect(changes.join(" ")).not.toMatch(/form_data|totalAmount|refund|student|reason/);
  });

  it("완료처리자는 이름(스냅샷)만, 내부 user id(completedBy)는 미노출", () => {
    const before = base();
    const after = base();
    after.result.completedBy = "uuid-내부-식별자";
    after.result.completedByName = "박원장";

    const { changes } = activityDetail("academy_documents", "UPDATE", "환불 요청서 — 홍길동", {
      form_data: { old: before, new: after },
    });
    expect(changes).toContain("완료처리자 비움→박원장");
    expect(changes.join(" ")).not.toContain("uuid-내부-식별자");
  });

  it("정규화 후 실질 차이 없으면 '서식내용 변경' 폴백", () => {
    const d = base();
    const { changes } = activityDetail("academy_documents", "UPDATE", "환불 요청서 — 홍길동", {
      form_data: { old: d, new: { ...d } },
    });
    expect(changes).toEqual(["서식내용 변경"]);
  });
});

describe("activityDetail — 계정 보기 설정(0444a 전에 쌓인 줄)", () => {
  it("ui_prefs는 영문 칸 이름 대신 '화면 보기 설정 변경'", () => {
    const { changes } = activityDetail("users", "UPDATE", "김선생", { ui_prefs: { old: { a: 1 }, new: { a: 2 } } });
    expect(changes).toEqual(["화면 보기 설정 변경"]);
  });
});
