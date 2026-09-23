import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

// The production sync scripts are CommonJS workers.
const require_ = createRequire(import.meta.url);
const { makeCounselorMatcher, registrantFromSummary, singleCounselorSubject } = require_("./consultation-counselor.cjs");

const users = [
  { id: "song", display_name: "송지혜", english_name: "Song" },
  { id: "lee", display_name: "이지은", english_name: "Amy" },
  { id: "another", display_name: "이유정", english_name: null },
];

describe("Makeedu consultation counselor matching", () => {
  const match = makeCounselorMatcher(users);

  it("matches a Korean name followed by a different English alias", () => {
    expect(match("송지혜 Jennifer")?.id).toBe("song");
    expect(match("송지혜 (Jennifer)")?.id).toBe("song");
  });

  it("matches existing parenthesized and plain names", () => {
    expect(match("이지은(Amy)")?.id).toBe("lee");
    expect(match("이유정")?.id).toBe("another");
    expect(match("Amy")?.id).toBe("lee");
  });

  it("refuses ambiguous Korean names", () => {
    const ambiguous = makeCounselorMatcher([...users, { id: "duplicate", display_name: "송지혜", english_name: null }]);
    expect(ambiguous("송지혜 Jennifer")).toBeNull();
    expect(match("다른사람 Amy")).toBeNull();
  });

  it("reads the registrant line from imported consultation details", () => {
    expect(registrantFromSummary("제목\n\n상담 기록 항목:\n2026년 09월 22일\n송지혜 Jennifer\n상담 내용: ..."))
      .toBe("송지혜 Jennifer");
    expect(registrantFromSummary("상담 기록 항목:\n\u200b2026년 07월 13일\n이다교\n상담 내용: ..."))
      .toBe("이다교");
    expect(registrantFromSummary("제목\n본문만 있음")).toBeNull();
  });

  it("fills a subject only for a single configured staff subject", () => {
    expect(singleCounselorSubject({ subjects: ["english"] }, { english: "영어" })).toBe("영어");
    expect(singleCounselorSubject({ subjects: ["english", "math"] }, { english: "영어" })).toBeNull();
  });
});
