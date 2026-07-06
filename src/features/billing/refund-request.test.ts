import { describe, expect, it } from "vitest";
import {
  emptyRefund,
  normalizeRefund,
  parseRefundForm,
  refundTitle,
} from "./refund-request";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseRefundForm", () => {
  it("모든 필드를 name 규약대로 파싱한다", () => {
    const d = parseRefundForm(
      fd({
        a_staff: "김담당",
        a_viceDirector: "이부원장",
        a_director: "박원장",
        s_name: "홍길동",
        s_schoolGrade: "경명중 2",
        s_address: "대구시 북구",
        s_reason: "이사로 인한 퇴원\n잔여 수업 환불",
        s_homeroomTeacher: "김윤하",
        s_className: "MS2B",
        s_staffTeacher: "이유정",
        s_classDate: "2026-06-01 ~ 2026-06-30",
        s_totalSessions: "12회",
        s_requestDate: "2026-07-03",
        r_paymentDetails: "6월 수강료 300,000원 (카드)",
        r_deductionDetails: "수업 4회 차감 100,000원",
        r_totalAmount: "200,000원",
        m_account: "국민 000-000",
        m_internetCard: "",
        m_card: "신한카드 취소",
        res_processedDate: "2026-07-05",
        res_systemProcessed: "완료",
        res_manager: "박소선",
        res_completedDate: "2026-07-07",
      }),
    );
    expect(d.student.name).toBe("홍길동");
    expect(d.student.reason).toBe("이사로 인한 퇴원\n잔여 수업 환불");
    expect(d.refund.method.account).toBe("국민 000-000");
    expect(d.refund.method.internetCard).toBe("");
    expect(d.result.manager).toBe("박소선");
    expect(d.result.completedDate).toBe("2026-07-07");
    // 완료 처리자는 폼에서 안 받는다(서버 스탬프) — parse 결과는 항상 빈 값이어야 위조 불가.
    expect(d.result.completedBy).toBe("");
    expect(d.result.completedByName).toBe("");
    expect(d.approval.director).toBe("박원장");
  });

  it("빈 FormData는 emptyRefund와 동일하다", () => {
    expect(parseRefundForm(new FormData())).toEqual(emptyRefund());
  });

  it("CRLF 줄바꿈을 LF로 정규화하고 양끝 공백을 자른다", () => {
    const d = parseRefundForm(fd({ s_reason: "  줄1\r\n줄2  ", r_paymentDetails: "a\r\nb" }));
    expect(d.student.reason).toBe("줄1\n줄2");
    expect(d.refund.paymentDetails).toBe("a\nb");
  });
});

describe("normalizeRefund", () => {
  it("parse 결과를 round-trip 보존한다", () => {
    const d = parseRefundForm(fd({ s_name: "홍길동", m_card: "신한", res_manager: "박소선" }));
    expect(normalizeRefund(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it("null·비객체·누락 섹션에도 완전한 형태를 돌려준다", () => {
    expect(normalizeRefund(null)).toEqual(emptyRefund());
    expect(normalizeRefund("junk")).toEqual(emptyRefund());
    const partial = normalizeRefund({ student: { name: "홍길동" }, refund: { method: { account: 3 } } });
    expect(partial.student.name).toBe("홍길동");
    expect(partial.student.address).toBe("");
    expect(partial.refund.method.account).toBe(""); // 비문자열은 빈 값으로
    expect(partial.result.manager).toBe("");
  });
});

describe("refundTitle", () => {
  it("학생 이름 포함, 미입력이면 플레이스홀더", () => {
    const d = emptyRefund();
    expect(refundTitle(d)).toBe("환불 요청서 — (이름 미입력)");
    d.student.name = "홍길동";
    expect(refundTitle(d)).toBe("환불 요청서 — 홍길동");
  });
});
