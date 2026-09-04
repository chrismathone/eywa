import { describe, it, expect } from "vitest";
import { KAGE_MAX_DETAIL, kageFailureReason, sanitizeKageDetail } from "./kage-failure.mjs";

/**
 * kage 업로드 실패 사유 — 2026-09-04 원장 지시("스샷 경로도 실패 사유 구분되게 고쳐줘")의 가드.
 *
 * 이 파일이 지키는 것은 둘이다:
 *  ① **네 갈래가 서로 다른 말을 한다** — 하나로 뭉치면 고치기 전과 같아진다.
 *  ② 그 문장이 발송 콘솔의 `humanizeClassnoteError`를 **사람 문장으로 통과**한다 —
 *     통과 못 하면 패턴표가 덮어써서 엉뚱한 안내가 나간다(오진).
 */

/**
 * `humanizeClassnoteError`의 `isHumanKorean`과 **같은 조건**(src/features/report-admin/classnote-error.ts).
 * 🔴 여기 규칙을 느슨하게 고쳐서 통과시키지 말 것 — 저쪽이 진짜 판정자다. 저쪽이 바뀌면 여기도 함께.
 */
function isHumanKorean(text) {
  const hangul = (text.match(/[가-힣]/g) ?? []).length;
  if (hangul < 4) return false;
  if (/\bat\s+\S+:\d+|Error:|net::|https?:\/\//.test(text)) return false;
  return hangul / text.length >= 0.15;
}

const KINDS = [
  { kind: "empty", must: /0바이트|캡처/ },
  { kind: "no_input", must: /첨부 칸/ },
  { kind: "rejected", status: 413, must: /거부|HTTP 413/ },
  { kind: "timeout", waitedMs: 12000, must: /12초|응답하지 않/ },
];

describe("kage 업로드 실패 사유", () => {
  it("🔴 네 갈래가 서로 다른 말을 한다 — 뭉치면 고치기 전과 같다", () => {
    const said = KINDS.map((k) => kageFailureReason({ subject: "보고서 이미지", ...k }));
    expect(new Set(said).size).toBe(KINDS.length);
    for (const [i, k] of KINDS.entries()) expect(said[i], k.kind).toMatch(k.must);
  });

  it("무엇을 올리다 실패했는지부터 말한다", () => {
    expect(kageFailureReason({ subject: "보고서 이미지", kind: "timeout", waitedMs: 12000 })).toContain(
      "보고서 이미지 업로드 실패",
    );
    expect(kageFailureReason({ subject: "첨부 파일", kind: "timeout", waitedMs: 12000 })).toContain(
      "첨부 파일 업로드 실패",
    );
  });

  it("대기 시간은 상수 이름이 아니라 **실제 값**을 적는다([[#121]])", () => {
    expect(kageFailureReason({ kind: "timeout", waitedMs: 12000 })).toContain("12초");
    expect(kageFailureReason({ kind: "timeout", waitedMs: 30000 })).toContain("30초");
  });

  it("모르는 갈래도 문장이 된다(빈 문자열·undefined 노출 금지)", () => {
    const r = kageFailureReason({ kind: "무언가" });
    expect(r).toContain("원인을 알 수 없습니다");
    expect(r).not.toMatch(/undefined|null/);
  });
});

describe("🔴 발송 콘솔이 이 문장을 '사람 문장'으로 통과시켜야 한다", () => {
  it("네 갈래 전부 통과 — 기술 원문을 붙여도 통과", () => {
    const nasty =
      'TypeError: locator.setInputFiles: Timeout exceeded at page.mjs:120:9 net::ERR_ABORTED https://kids-kage.kakao.com/upload';
    for (const k of KINDS) {
      const plain = kageFailureReason({ subject: "보고서 이미지", ...k });
      const withDetail = kageFailureReason({ subject: "보고서 이미지", ...k, detail: nasty });
      expect(isHumanKorean(plain), `${k.kind} plain`).toBe(true);
      expect(isHumanKorean(withDetail), `${k.kind} +원문`).toBe(true);
    }
  });

  it("🔴 패턴표가 낚아채는 어구를 쓰지 않는다 — 통과에 실패해도 오진으로 번지지 않게", () => {
    // '찾지 못' → 보드(학생 알림장) 안내, '로그인/인증' → 로그인 실패 안내로 덮어써진다.
    for (const k of KINDS) {
      const r = kageFailureReason({ subject: "보고서 이미지", ...k });
      expect(r, k.kind).not.toMatch(/찾지 못|로그인|인증|비밀번호/);
    }
  });
});

describe("sanitizeKageDetail — 기술 신호를 걷어내고 짧게", () => {
  it("URL·스택 프레임·Error 접두·net:: 을 지운다", () => {
    const out = sanitizeKageDetail("TypeError: boom at foo.mjs:12:3 net::ERR_X https://a.b/c/d");
    expect(out).toBe("boom");
  });

  it("길면 자른다(한글 비율이 떨어져 오진나는 것을 막는 상한)", () => {
    const out = sanitizeKageDetail("가".repeat(200));
    expect(out.length).toBeLessThanOrEqual(KAGE_MAX_DETAIL);
    expect(out.endsWith("…")).toBe(true);
  });

  it("빈 값·null은 빈 문자열(사유 끝에 빈 괄호가 붙지 않게)", () => {
    expect(sanitizeKageDetail(null)).toBe("");
    expect(sanitizeKageDetail("   ")).toBe("");
    expect(kageFailureReason({ kind: "timeout", waitedMs: 12000, detail: null })).not.toContain("[");
  });
});
