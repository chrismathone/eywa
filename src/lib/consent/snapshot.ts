/**
 * 동의 스냅샷 — "언제 · 어떤 문구에 · 무엇을" 동의했는지를 **그 시점 그대로 얼려 두는** 순수 모듈.
 *
 * 🔴 왜 필요한가(2026-08-12 개인정보 검토에서 발견): 종전에는 동의 기록이
 * `privacy_agreement: true` **불리언 하나**뿐이었다. 동의 시각도, 동의한 문구도, 항목별 구분도 없다.
 * 게다가 문구는 학원설정(`tenant_settings`)에서 **덮어쓰기**되므로, 원장이 문구를 한 번 고치면
 * 그 이전에 동의한 학부모가 **무엇에 동의했는지 재현할 방법이 사라진다.**
 * 개인정보보호법상 **동의를 받았다는 입증 책임은 학원에 있다** — 증명 못 하면 안 받은 것과 같다.
 * 그래서 동의 시점의 **문구 전문까지** 행에 함께 남긴다(문구를 나중에 고쳐도 과거 동의는 그대로).
 *
 * ⚠️ 스냅샷은 **서버에서만** 만든다. 문구는 클라가 보낸 값이 아니라 그 순간의 학원설정에서 읽는다
 *    (클라가 보낸 문구를 믿으면 "동의한 내용"을 위조할 수 있다). 클라에서 오는 건 체크 여부뿐.
 */

/** 동의 항목 — 법이 **각각 별도 동의**를 요구하는 단위. 묶으면 포괄 동의라 셋 다 무효가 될 수 있다. */
export const CONSENT_KEYS = ["privacy", "overseas", "sensitive", "service"] as const;
export type ConsentKey = (typeof CONSENT_KEYS)[number];

/** 화면·감사에서 쓰는 한글 라벨(UI에 raw 키 노출 금지 규약). */
export const CONSENT_LABELS: Record<ConsentKey, string> = {
  privacy: "개인정보 수집·이용",
  overseas: "개인정보 국외 이전",
  sensitive: "민감정보 수집·이용",
  service: "환불·학칙 안내",
};

/** 근거 조문 — 처리방침·보고서·동의 이력 화면이 함께 쓴다. */
export const CONSENT_BASIS: Record<ConsentKey, string> = {
  privacy: "개인정보 보호법 제15조",
  overseas: "개인정보 보호법 제28조의8",
  sensitive: "개인정보 보호법 제23조",
  service: "학원 운영 약관",
};

/** 필수 동의 — 이게 없으면 접수 자체가 성립하지 않는다. 나머지는 거부해도 서비스가 제한되지 않아야 한다. */
export const REQUIRED_CONSENTS: readonly ConsentKey[] = ["privacy"];

/** 녹음을 쓰려면 반드시 있어야 하는 동의 — 없으면 녹음 첨부를 막는다(동의 없는 국외이전 차단). */
export const RECORDING_CONSENTS: readonly ConsentKey[] = ["privacy", "overseas"];

export type ConsentItem = {
  key: ConsentKey;
  label: string;
  agreed: boolean;
  /** 동의 시점에 화면에 실제로 표시된 문구 전문. 비어 있으면 그 블록이 화면에 없었다는 뜻. */
  text: string;
  /** 문구 지문 — 전문 비교 없이 "같은 문구인가"를 빠르게 판정한다. */
  textHash: string;
};

export type ConsentSnapshot = {
  version: 1;
  /** 동의를 받은 시각(ISO, UTC). */
  agreedAt: string;
  /** 어느 화면에서 받았는지 — 공개 QR 접수 / 직원이 상담 화면에서 확인. */
  source: "public_intake" | "staff_form";
  items: ConsentItem[];
};

/** 학원설정에서 읽은 동의 문구 4종. */
export type ConsentTerms = Record<ConsentKey, string>;

/**
 * 문구 지문 — FNV-1a 32bit. **보안용이 아니라 버전 식별용**이라 암호학적 해시가 필요 없고,
 * 의존성 없이 서버·클라 어디서나 같은 값을 낸다(Node crypto를 쓰면 클라 번들이 깨진다).
 * 공백만 다른 문구를 같은 것으로 보지 않도록 원문 그대로 넣는다.
 */
export function termsFingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    // FNV prime 16777619 — 32bit 곱셈 오버플로를 피하려고 시프트 합으로 전개.
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * 동의 스냅샷 생성. `agreed`는 화면에서 온 체크 여부, `terms`는 **그 순간 서버가 읽은** 문구.
 * 문구가 빈 항목은 화면에 아예 없었던 것이므로 `agreed=false`로 고정한다
 * (보이지 않은 문구에 동의했다고 기록하면 그게 곧 허위 증거다).
 */
export function buildConsentSnapshot(args: {
  terms: ConsentTerms;
  agreed: Partial<Record<ConsentKey, boolean>>;
  source: ConsentSnapshot["source"];
  at: Date;
}): ConsentSnapshot {
  return {
    version: 1,
    agreedAt: args.at.toISOString(),
    source: args.source,
    items: CONSENT_KEYS.map((key) => {
      const text = (args.terms[key] ?? "").trim();
      return {
        key,
        label: CONSENT_LABELS[key],
        agreed: text.length > 0 && args.agreed[key] === true,
        text,
        textHash: text ? termsFingerprint(text) : "",
      };
    }),
  };
}

/** 스냅샷에서 특정 항목의 동의 여부. 스냅샷이 없으면(옛 행) false — "모르면 안 받은 것"으로 본다. */
export function hasConsent(snapshot: ConsentSnapshot | null | undefined, key: ConsentKey): boolean {
  return snapshot?.items?.find((i) => i.key === key)?.agreed === true;
}

/**
 * 상담사의 녹음 안내·확인 기록 — **학부모 동의와 다른 사실**이라 타입도 저장 칸도 분리한다.
 * 🔴 이걸 학부모 스냅샷과 같은 칸에 쓰면, 학부모가 거부한 기록을 상담사 확인이 덮어써
 *    "학부모가 동의했다"는 **허위 증거**가 만들어진다(적대 리뷰 2026-08-12에서 실제로 잡힌 결함).
 */
export type StaffRecordingConsent = {
  version: 1;
  confirmedAt: string;
  /** 확인한 상담사 — 나중에 "누가 안내했는가"를 되짚기 위한 것. */
  confirmedBy: string | null;
  /** 확인 시점에 화면이 안내한 문구(수집·이용/국외이전)의 지문 — 어떤 안내를 근거로 확인했는지. */
  termsHash: { privacy: string; overseas: string };
};

export function buildStaffRecordingConsent(args: {
  terms: Pick<ConsentTerms, "privacy" | "overseas">;
  confirmedBy: string | null;
  at: Date;
}): StaffRecordingConsent {
  return {
    version: 1,
    confirmedAt: args.at.toISOString(),
    confirmedBy: args.confirmedBy,
    termsHash: {
      privacy: termsFingerprint((args.terms.privacy ?? "").trim()),
      overseas: termsFingerprint((args.terms.overseas ?? "").trim()),
    },
  };
}

/**
 * 🔴 **녹음을 붙여도 되는가** — 이 커밋의 실질 게이트. 두 조건을 **모두** 본다:
 *
 *  ① 학원이 국외이전 동의 문구를 갖고 있는가(`terms.overseas`가 비면 학부모는 동의할 방법조차 없다).
 *  ② 학부모가 직접 낸 동의가 이미 있다면(QR 접수), 그 기록이 **국외이전을 거부하지 않았는가**.
 *
 * ②가 핵심이다 — 학부모가 "녹음은 원하지 않는다"고 체크를 비웠는데 상담사가 나중에 녹음을 붙이면
 * 그건 명시적 거부를 무시하는 것이다. 스냅샷이 아예 없는 건(전화·방문 신규)은 상담사 확인으로 간다.
 */
export function recordingBlockReason(args: {
  terms: Pick<ConsentTerms, "privacy" | "overseas">;
  /** 학부모가 접수 화면에서 직접 낸 동의(있을 때만). 없으면 상담사 확인 경로. */
  parentSnapshot: ConsentSnapshot | null | undefined;
}): string | null {
  if (!(args.terms.overseas ?? "").trim()) {
    return "국외 이전 동의 문구가 설정되지 않아 녹음을 첨부할 수 없습니다 — 학원설정 › 알림·약관에서 문구를 먼저 등록하세요";
  }
  if (!(args.terms.privacy ?? "").trim()) {
    return "개인정보 수집·이용 동의 문구가 설정되지 않아 녹음을 첨부할 수 없습니다 — 학원설정 › 알림·약관에서 문구를 먼저 등록하세요";
  }
  const snap = args.parentSnapshot;
  if (snap) {
    const refused = RECORDING_CONSENTS.filter((k) => !hasConsent(snap, k));
    if (refused.length > 0) {
      return `학부모가 ${refused.map((k) => CONSENT_LABELS[k]).join(" · ")}에 동의하지 않아 녹음을 첨부할 수 없습니다 — 다시 동의를 받은 뒤 진행하세요`;
    }
  }
  return null;
}

/** 위 판정의 불리언 형태. */
export function canAttachRecording(args: {
  terms: Pick<ConsentTerms, "privacy" | "overseas">;
  parentSnapshot: ConsentSnapshot | null | undefined;
}): boolean {
  return recordingBlockReason(args) === null;
}
