import { describe, expect, it } from "vitest";
import {
  buildDigestPayload,
  buildSinglePayload,
  checkJandiWebhookUrl,
  describeJandiFailure,
  maskJandiWebhookUrl,
  planJandiMessages,
  type ForwardRow,
} from "./format";

const URL_OK = "https://wh.jandi.com/connect-api/webhook/12345678/abcdef0123456789abcdef";

describe("checkJandiWebhookUrl", () => {
  it("잔디 인커밍 웹훅 주소만 받는다", () => {
    expect(checkJandiWebhookUrl(`  ${URL_OK}  `)).toEqual({ ok: true, url: URL_OK });
    expect(checkJandiWebhookUrl("").ok).toBe(false);
    expect(checkJandiWebhookUrl("https://example.com/connect-api/webhook/123456789").ok).toBe(false);
    // 같은 접두 뒤에 다른 호스트로 새는 주소·쿼리 문자열은 거절
    expect(checkJandiWebhookUrl(`${URL_OK}?x=1`).ok).toBe(false);
    expect(checkJandiWebhookUrl("http://wh.jandi.com/connect-api/webhook/12345678/abcdef").ok).toBe(false);
  });
});

describe("maskJandiWebhookUrl", () => {
  it("토큰은 끝 4자만 남긴다", () => {
    const masked = maskJandiWebhookUrl(URL_OK);
    expect(masked).not.toContain("abcdef0123456789");
    expect(masked.endsWith("cdef")).toBe(true);
    expect(maskJandiWebhookUrl("")).toBe("");
  });
});

const row = (over: Partial<ForwardRow>): ForwardRow => ({
  type: "approval_requested",
  title: "결재 요청",
  body: "휴가 신청서",
  link: "/approvals/1",
  recipientId: "u1",
  ...over,
});

describe("planJandiMessages", () => {
  it("고른 종류만 남기고, 같은 알림이 여러 사람에게 간 것은 한 통으로 합친다", () => {
    const plan = planJandiMessages(
      [row({}), row({ recipientId: "u2" }), row({ recipientId: "u2" }), row({ type: "help_question" })],
      new Set(["approval_requested"]),
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].recipientIds).toEqual(["u1", "u2"]);
  });

  it("내용이 다르면 따로 보낸다", () => {
    const plan = planJandiMessages([row({}), row({ body: "다른 문서", recipientId: "u2" })], new Set(["approval_requested"]));
    expect(plan).toHaveLength(2);
  });

  it("아무것도 안 골랐으면 보내지 않는다", () => {
    expect(planJandiMessages([row({})], new Set())).toEqual([]);
  });
});

describe("buildSinglePayload", () => {
  it("상대 링크는 앱 주소를 붙여 잔디 링크 문법으로, 받는 사람은 이름으로", () => {
    const [m] = planJandiMessages([row({})], new Set(["approval_requested"]));
    const p = buildSinglePayload(m, ["김원장"], "https://www.aywa.co.kr");
    expect(p.body).toBe("[결재 요청] 결재 요청 · [[aywa에서 열기]](https://www.aywa.co.kr/approvals/1)");
    expect(p.connectInfo).toEqual([
      { title: "내용", description: "휴가 신청서" },
      { title: "받는 사람", description: "김원장" },
    ]);
  });

  it("앱 주소를 모르면 링크를 빼고, 제목의 대괄호가 링크 문법을 깨지 않게 한다", () => {
    const [m] = planJandiMessages([row({ title: "[긴급] 결재", body: null })], new Set(["approval_requested"]));
    const p = buildSinglePayload(m, [], null);
    expect(p.body).toBe("[결재 요청] 긴급  결재");
    expect(p.connectInfo).toEqual([]);
  });

  it("긴 본문은 자른다(잔디 표시 한도 5,000자 안쪽)", () => {
    const [m] = planJandiMessages([row({ body: "가".repeat(3000) })], new Set(["approval_requested"]));
    const p = buildSinglePayload(m, [], null);
    expect(JSON.stringify(p).length).toBeLessThan(5000);
  });
});

describe("buildDigestPayload", () => {
  it("열 건까지만 펼치고 나머지는 '외 N건'", () => {
    const rows = Array.from({ length: 13 }, (_, i) => row({ title: `문서 ${i}` }));
    const plan = planJandiMessages(rows, new Set(["approval_requested"]));
    const p = buildDigestPayload(plan);
    expect(p.body).toBe("[aywa] 알림 13건");
    expect(p.connectInfo).toHaveLength(11);
    expect(p.connectInfo[10].title).toBe("외 3건");
  });
});

describe("describeJandiFailure", () => {
  it("한도·거절·네트워크를 한글로 가른다", () => {
    expect(describeJandiFailure(429)).toContain("한도");
    expect(describeJandiFailure(400)).toContain("거절");
    expect(describeJandiFailure(null)).toContain("연결하지 못했");
    expect(describeJandiFailure(500)).toContain("500");
  });
});
