import { describe, expect, it } from "vitest";
import {
  buildConsentSnapshot,
  buildStaffRecordingConsent,
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
    buildConsentSnapshot({ terms: TERMS, agreed, source: "public_intake", at: AT });
  const terms = { privacy: TERMS.privacy, overseas: TERMS.overseas };

  it("학부모 스냅샷이 없으면(전화·방문 신규) 문구만 있으면 통과 — 상담사 확인이 근거", () => {
    expect(canAttachRecording({ terms, parentSnapshot: null })).toBe(true);
    expect(recordingBlockReason({ terms, parentSnapshot: undefined })).toBeNull();
  });

  it("🔴 학부모가 국외이전을 거부했으면 상담사 확인이 있어도 막는다", () => {
    const reason = recordingBlockReason({ terms, parentSnapshot: snap({ privacy: true, sensitive: true }) });
    expect(reason).toBe(
      "학부모가 개인정보 국외 이전에 동의하지 않아 녹음을 첨부할 수 없습니다 — 다시 동의를 받은 뒤 진행하세요",
    );
  });

  it("학부모가 둘 다 동의했으면 통과", () => {
    expect(canAttachRecording({ terms, parentSnapshot: snap({ privacy: true, overseas: true }) })).toBe(true);
  });

  it("🔴 국외이전 문구가 비면 막는다 — 학부모가 동의할 방법 자체가 없다", () => {
    const reason = recordingBlockReason({ terms: { ...terms, overseas: "  " }, parentSnapshot: null });
    expect(reason).toContain("국외 이전 동의 문구가 설정되지 않아");
    expect(recordingBlockReason({ terms: { ...terms, privacy: "" }, parentSnapshot: null })).toContain(
      "개인정보 수집·이용 동의 문구가 설정되지 않아",
    );
  });

  it("민감정보·학칙은 녹음 게이트가 아니다 — 거부해도 녹음은 가능", () => {
    const parentSnapshot = snap({ privacy: true, overseas: true, sensitive: false, service: false });
    expect(canAttachRecording({ terms, parentSnapshot })).toBe(true);
  });

  it("스냅샷이 없으면 개별 항목은 동의 없음 — 모르면 안 받은 것", () => {
    expect(hasConsent(null, "privacy")).toBe(false);
    expect(hasConsent(undefined, "overseas")).toBe(false);
  });
});

describe("상담사 확인은 학부모 동의와 분리된다", () => {
  it("🔴 별도 타입이라 학부모 스냅샷 구조를 만들지 않는다 — 덮어써서 '동의함'으로 위조되던 결함의 근본 차단", () => {
    const entry = buildStaffRecordingConsent({
      terms: { privacy: TERMS.privacy, overseas: TERMS.overseas },
      confirmedBy: "user-1",
      at: AT,
    });
    expect(entry).toEqual({
      version: 1,
      confirmedAt: "2026-08-12T04:30:00.000Z",
      confirmedBy: "user-1",
      termsHash: {
        privacy: termsFingerprint(TERMS.privacy),
        overseas: termsFingerprint(TERMS.overseas),
      },
    });
    // 학부모 동의 판정 함수가 읽는 items가 아예 없다 — 구조적으로 섞일 수 없다.
    expect("items" in entry).toBe(false);
    expect(hasConsent(entry as unknown as ConsentSnapshot, "overseas")).toBe(false);
  });
});
