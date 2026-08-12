import { describe, expect, it } from "vitest";
import {
  buildConsentSnapshot,
  canAttachRecording,
  CONSENT_KEYS,
  hasConsent,
  recordingBlockReason,
  termsFingerprint,
  type ConsentSnapshot,
  type ConsentTerms,
} from "./snapshot";

const TERMS: ConsentTerms = {
  privacy: "[개인정보 수집·이용 동의]\n1. 수집하는 항목 …",
  overseas: "[개인정보 국외 이전 동의]\n1. 이전받는 자 …",
  sensitive: "[민감정보 수집·이용 동의]\n1. 수집하는 항목 …",
  service: "[환불·학칙 안내]",
};
const AT = new Date("2026-08-12T04:30:00.000Z");

describe("termsFingerprint", () => {
  it("같은 문구는 같은 지문, 다른 문구는 다른 지문", () => {
    expect(termsFingerprint("가나다")).toBe(termsFingerprint("가나다"));
    expect(termsFingerprint("가나다")).not.toBe(termsFingerprint("가나라"));
  });

  it("공백만 달라도 다른 문구로 본다 — 문구 개정을 놓치지 않기 위해", () => {
    expect(termsFingerprint("1. 항목")).not.toBe(termsFingerprint("1.  항목"));
  });

  it("항상 8자리 16진 문자열", () => {
    for (const s of ["", "a", "긴 문구".repeat(200)]) {
      expect(termsFingerprint(s)).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

describe("buildConsentSnapshot", () => {
  it("체크한 항목만 agreed=true, 문구 전문과 지문을 함께 얼린다", () => {
    const snap = buildConsentSnapshot({
      terms: TERMS,
      agreed: { privacy: true, overseas: true },
      source: "public_intake",
      at: AT,
    });
    expect(snap.version).toBe(1);
    expect(snap.agreedAt).toBe("2026-08-12T04:30:00.000Z");
    expect(snap.source).toBe("public_intake");
    expect(snap.items).toHaveLength(CONSENT_KEYS.length);

    const privacy = snap.items.find((i) => i.key === "privacy")!;
    expect(privacy.agreed).toBe(true);
    expect(privacy.text).toBe(TERMS.privacy);
    expect(privacy.textHash).toBe(termsFingerprint(TERMS.privacy));
    expect(privacy.label).toBe("개인정보 수집·이용");

    expect(snap.items.find((i) => i.key === "sensitive")!.agreed).toBe(false);
  });

  it("🔴 화면에 없던(문구가 빈) 항목은 체크가 왔어도 동의로 기록하지 않는다 — 허위 증거 방지", () => {
    const snap = buildConsentSnapshot({
      terms: { ...TERMS, overseas: "   " },
      agreed: { privacy: true, overseas: true },
      source: "staff_form",
      at: AT,
    });
    const overseas = snap.items.find((i) => i.key === "overseas")!;
    expect(overseas.agreed).toBe(false);
    expect(overseas.text).toBe("");
    expect(overseas.textHash).toBe("");
  });

  it("문구를 나중에 고쳐도 스냅샷은 그대로 — 과거 동의가 재현된다", () => {
    const before = buildConsentSnapshot({ terms: TERMS, agreed: { privacy: true }, source: "public_intake", at: AT });
    const after = buildConsentSnapshot({
      terms: { ...TERMS, privacy: "[개정된 문구]" },
      agreed: { privacy: true },
      source: "public_intake",
      at: AT,
    });
    expect(before.items[0].text).toBe(TERMS.privacy);
    expect(before.items[0].textHash).not.toBe(after.items[0].textHash);
  });
});

describe("녹음 첨부 게이트", () => {
  const snap = (agreed: Partial<Record<string, boolean>>): ConsentSnapshot =>
    buildConsentSnapshot({ terms: TERMS, agreed, source: "staff_form", at: AT });

  it("수집·이용 + 국외이전이 둘 다 있어야 녹음 첨부 허용", () => {
    expect(canAttachRecording(snap({ privacy: true, overseas: true }))).toBe(true);
    expect(canAttachRecording(snap({ privacy: true }))).toBe(false);
    expect(canAttachRecording(snap({ overseas: true }))).toBe(false);
  });

  it("🔴 스냅샷이 없으면(옛 행) 동의 없음으로 본다 — 모르면 안 받은 것", () => {
    expect(hasConsent(null, "privacy")).toBe(false);
    expect(hasConsent(undefined, "overseas")).toBe(false);
    expect(canAttachRecording(null)).toBe(false);
  });

  it("막힌 이유는 한글 문장으로 — 빠진 항목만 나열", () => {
    expect(recordingBlockReason(snap({ privacy: true, overseas: true }))).toBeNull();
    expect(recordingBlockReason(snap({ privacy: true }))).toBe(
      "개인정보 국외 이전 동의가 없어 녹음을 첨부할 수 없습니다",
    );
    expect(recordingBlockReason(null)).toBe(
      "개인정보 수집·이용 · 개인정보 국외 이전 동의가 없어 녹음을 첨부할 수 없습니다",
    );
  });

  it("민감정보·학칙은 녹음 게이트가 아니다 — 거부해도 녹음은 가능", () => {
    expect(canAttachRecording(snap({ privacy: true, overseas: true, sensitive: false, service: false }))).toBe(true);
  });
});
