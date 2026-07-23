import { describe, it, expect } from "vitest";
import { humanizeClassnoteError } from "./classnote-error";

describe("humanizeClassnoteError", () => {
  it("빈 값 → null", () => {
    expect(humanizeClassnoteError(null)).toBeNull();
    expect(humanizeClassnoteError("  ")).toBeNull();
  });

  it("주소/네트워크 계열 — 실측 원문(page.goto ERR_NAME_NOT_RESOLVED)", () => {
    const raw =
      'page.goto: net::ERR_NAME_NOT_RESOLVED at https://eywa-alpha-vercel.app/r/61d1\nCall log:\n  - navigating to "…"';
    expect(humanizeClassnoteError(raw)).toContain("발송 PC가 보고서 주소에 접속하지 못함");
  });

  it("타임아웃 계열", () => {
    expect(humanizeClassnoteError("page.goto: Timeout 120000ms exceeded")).toContain("시간 초과");
  });

  it("로그인 계열", () => {
    expect(humanizeClassnoteError("login failed: invalid credential")).toContain("로그인 실패");
  });

  it("미지의 원문 → 일반 안내(원문 노출 없음)", () => {
    const out = humanizeClassnoteError("some totally unknown internal stack trace");
    expect(out).toContain("발송 실패");
    expect(out).not.toContain("stack");
  });
});

describe("워커가 쓴 한글 안내문은 요약하지 않고 그대로", () => {
  it("첨부 실패 원인 문장을 패턴표가 덮어쓰지 않는다(오진 방지)", () => {
    const raw = "첨부 목록 조회 실패 — 인증 실패(CLASSNOTE_INTERNAL_SECRET 불일치/미설정)";
    // '인증'이라는 단어 때문에 예전엔 "ClassNote 로그인 실패…"로 오진했다.
    expect(humanizeClassnoteError(raw)).toBe(raw);
  });

  it("단계별 실패 문장도 그대로(정보 손실 방지)", () => {
    const raw = '파일 첨부 실패 — 다운로드 실패("워크시트.xlsx": HTTP 403)';
    expect(humanizeClassnoteError(raw)).toBe(raw);
  });

  it("상류 API의 짧은 코드성 한글 '해당 학생 없음'은 조치가 보이게 바꾼다", () => {
    // 한글이라 isHumanKorean을 통과해 그대로 노출됐지만, 강사는 무엇을 해야 할지 알 수 없었다(손민우 07-22).
    const got = humanizeClassnoteError("해당 학생 없음");
    expect(got).toContain("학부모");
    expect(got).toContain("초대");
    expect(got).not.toBe("해당 학생 없음");
  });

  it("기술 원문(영문·스택·URL)은 여전히 한글 요약으로", () => {
    expect(humanizeClassnoteError("page.goto: net::ERR_NAME_NOT_RESOLVED at https://x/y")).toContain(
      "발송 PC가 보고서 주소에 접속하지 못함",
    );
    expect(humanizeClassnoteError("Error: something exploded")).toBe("발송 실패 — 아래 ‘자세히’를 눌러 원문 확인");
  });
});
