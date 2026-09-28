import { describe, expect, it } from "vitest";
import {
  buildSlackDigestText,
  buildSlackText,
  checkSlackBotToken,
  describeSlackError,
  escapeMrkdwn,
  maskSlackToken,
  planForwardMessages,
  sanitizeSlackRoutes,
  SLACK_MAX_CHANNEL_ROUTES,
  type ForwardRow,
} from "./format";

const TOKEN = "xoxb-1234567890-0987654321-AbCdEfGhIjKlMnOp";

describe("checkSlackBotToken · maskSlackToken", () => {
  it("봇 토큰(xoxb-)만 받는다", () => {
    expect(checkSlackBotToken(`  ${TOKEN} `)).toEqual({ ok: true, token: TOKEN });
    expect(checkSlackBotToken("").ok).toBe(false);
    expect(checkSlackBotToken("xoxp-1234567890-0987654321-abc").ok).toBe(false); // 사용자 토큰은 거절
    expect(checkSlackBotToken("xoxb-짧음").ok).toBe(false);
  });

  it("끝 4자만 남긴다", () => {
    expect(maskSlackToken(TOKEN)).toBe("xoxb-••••MnOp");
    expect(maskSlackToken(TOKEN)).not.toContain("1234567890");
    expect(maskSlackToken("")).toBe("");
  });
});

describe("sanitizeSlackRoutes", () => {
  it("1:1은 하나만, 채널은 id 모양·중복을 거르고, 알림 종류는 목록에 있는 것만", () => {
    const routes = sanitizeSlackRoutes([
      { kind: "dm", eventTypes: ["approval_requested", "bogus"] },
      { kind: "dm", eventTypes: ["help_question"] },
      { kind: "channel", channelId: "C0123ABCD", channelName: "데스크", eventTypes: ["attendance_absent_desk"] },
      { kind: "channel", channelId: "C0123ABCD", channelName: "중복", eventTypes: [] },
      { kind: "channel", channelId: "not-an-id", channelName: "x", eventTypes: [] },
      { kind: "channel", channelId: "", channelName: "빈칸", eventTypes: [] },
      null,
      "junk",
    ]);
    expect(routes).toEqual([
      { kind: "dm", eventTypes: ["approval_requested"] },
      { kind: "channel", channelId: "C0123ABCD", channelName: "데스크", eventTypes: ["attendance_absent_desk"] },
    ]);
    expect(sanitizeSlackRoutes("nope")).toEqual([]);
  });

  it("채널은 상한까지만", () => {
    const many = Array.from({ length: SLACK_MAX_CHANNEL_ROUTES + 3 }, (_, i) => ({
      kind: "channel",
      channelId: `C${String(i).padStart(8, "0")}`,
      channelName: `c${i}`,
      eventTypes: [],
    }));
    expect(sanitizeSlackRoutes(many)).toHaveLength(SLACK_MAX_CHANNEL_ROUTES);
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

describe("planForwardMessages", () => {
  it("고른 종류만, 같은 알림은 받는 사람을 합쳐 한 통", () => {
    const plan = planForwardMessages(
      [row({}), row({ recipientId: "u2" }), row({ recipientId: "u2" }), row({ type: "help_question" })],
      new Set(["approval_requested"]),
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].recipientIds).toEqual(["u1", "u2"]);
  });

  it("아무것도 안 골랐으면 보내지 않는다", () => {
    expect(planForwardMessages([row({})], new Set())).toEqual([]);
  });
});

describe("buildSlackText", () => {
  it("굵은 머리 + 본문 + 받는 사람 + 앱 주소를 붙인 링크", () => {
    const [m] = planForwardMessages([row({})], new Set(["approval_requested"]));
    expect(buildSlackText(m, "https://www.aywa.co.kr", ["김원장"])).toBe(
      "*[결재 요청] 결재 요청*\n휴가 신청서\n받는 사람: 김원장\n<https://www.aywa.co.kr/approvals/1|aywa에서 열기>",
    );
  });

  it("1:1(이름 없음)·앱 주소 모름이면 그 줄을 뺀다", () => {
    const [m] = planForwardMessages([row({ body: null })], new Set(["approval_requested"]));
    expect(buildSlackText(m, null)).toBe("*[결재 요청] 결재 요청*");
  });

  it("& < > 는 이스케이프해서 슬랙 문법(멘션·링크)으로 새지 않는다", () => {
    expect(escapeMrkdwn("<!channel> A&B >")).toBe("&lt;!channel&gt; A&amp;B &gt;");
    const [m] = planForwardMessages([row({ title: "<!here> 긴급", body: null, link: null })], new Set(["approval_requested"]));
    expect(buildSlackText(m, null)).not.toContain("<!here>");
  });
});

describe("buildSlackDigestText", () => {
  it("열 건까지 펼치고 나머지는 '외 N건'", () => {
    const plan = planForwardMessages(
      Array.from({ length: 13 }, (_, i) => row({ title: `문서 ${i}` })),
      new Set(["approval_requested"]),
    );
    const text = buildSlackDigestText(plan);
    expect(text.split("\n")[0]).toBe("*[aywa] 알림 13건*");
    expect(text).toContain("외 3건");
    expect(text.split("\n")).toHaveLength(12);
  });
});

describe("describeSlackError", () => {
  it("원문 코드를 그대로 내지 않고 한글로", () => {
    expect(describeSlackError("invalid_auth")).toContain("토큰");
    expect(describeSlackError("not_in_channel")).toContain("/invite");
    expect(describeSlackError("missing_scope")).toContain("권한");
    expect(describeSlackError(null)).toContain("연결하지 못했");
    expect(describeSlackError("something_new")).not.toContain("something_new");
  });
});
