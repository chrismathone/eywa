import { describe, expect, it } from "vitest";
import { checkSlackBotToken, describeSlackError, escapeMrkdwn, maskSlackToken, slackErrorKind } from "./format";

const TOKEN = "xoxb-1234567890-0987654321-AbCdEfGhIjKlMnOp";

describe("봇 토큰", () => {
  it("xoxb-만 받는다", () => {
    expect(checkSlackBotToken(`  ${TOKEN} `)).toEqual({ ok: true, token: TOKEN });
    expect(checkSlackBotToken("").ok).toBe(false);
    expect(checkSlackBotToken("xoxp-1234567890-0987654321-abc").ok).toBe(false);
    expect(checkSlackBotToken("xoxb-짧음").ok).toBe(false);
  });
  it("끝 4자만 보인다", () => {
    expect(maskSlackToken(TOKEN)).toBe("xoxb-••••MnOp");
    expect(maskSlackToken("")).toBe("");
  });
});

describe("mrkdwn 이스케이프", () => {
  it("& < > — 멘션·링크 문법으로 새지 않게", () => {
    expect(escapeMrkdwn("<!channel> A&B >")).toBe("&lt;!channel&gt; A&amp;B &gt;");
  });
});

describe("오류 분류·한글화", () => {
  it("토큰 문제는 중단, 대상 문제는 포기, 한도는 대기, 나머지는 재시도", () => {
    expect(slackErrorKind("invalid_auth")).toBe("auth");
    expect(slackErrorKind("token_revoked")).toBe("auth");
    expect(slackErrorKind("not_in_channel")).toBe("target");
    expect(slackErrorKind("is_archived")).toBe("target");
    expect(slackErrorKind("ratelimited")).toBe("rate");
    expect(slackErrorKind(null)).toBe("retry");
    expect(slackErrorKind("internal_error")).toBe("retry");
  });
  it("원문 코드를 그대로 내지 않는다", () => {
    expect(describeSlackError("invalid_auth")).toContain("토큰");
    expect(describeSlackError("not_in_channel")).toContain("/invite");
    expect(describeSlackError("not_linked")).toContain("연결");
    expect(describeSlackError(null)).toContain("연결하지 못했");
    expect(describeSlackError("something_new")).not.toContain("something_new");
  });
});
