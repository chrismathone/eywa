/**
 * "이 행은 왜 발송이 안 되는가" — 발송 버튼의 **비활성 사유 단일 소스**(순수 함수, Vitest).
 *
 * 🔴 2026-07-30 원장 제보: *"발송란이 비활성화 되었을 때 왜 비활성화 되었는지 선생님들이 알 수 있는
 *    방법이 없다."* 그동안 이유를 아는 곳이 **버튼 title 툴팁뿐**이었는데, 표뷰에서 네이티브 툴팁이
 *    실제로 안 뜨는 사례가 확인됐고(2026-07-21) 진도 미입력은 툴팁조차 없었다. → 버튼 아래에 필요한
 *    것을 **라벨로** 적는다. 이 모듈이 그 라벨과 버튼 disabled·title이 **같은 판정**을 쓰게 만든다
 *    (다르면 "비활성인데 이유 라벨은 없음" 같은 거짓말이 다시 생긴다).
 *
 * ⚠️ 판정 근거는 실제 발송 경로의 게이트와 **1:1로 맞춘다**:
 *    · 발송 완료  = `isAlreadySent` (grid.ts — ClassNote는 게시글 수정이 없어 재발송 금지)
 *    · 결석       = `attendanceRaw === "absent"` (isRowActionable "send")
 *    · 진도 미입력 = `isReportEligible` (빈 보고서 방지)
 *    · 멘트 미작성 = 🔴 **빈 멘트 절대 가드**(2026-07-28 사고) — `sendRow`가 즉시 거절하고 워커도
 *      최종 관문에서 차단한다. 예전엔 버튼이 멀쩡히 눌려서 빨간 토스트로만 알 수 있었다.
 */

/** 발송을 막는 사유. sent·absent는 **상태**(고칠 게 아니라 그런 행), progress·ment는 **필요한 입력**. */
export type SendBlockReason = "sent" | "absent" | "progress" | "ment";

/** 입력이 필요한 사유의 짧은 이름 — 라벨에서 "진도 · 멘트 입력 필요"로 이어 붙인다. */
const NEED_LABEL: Record<"progress" | "ment", string> = {
  progress: "진도",
  ment: "멘트",
};

export type SendGate = {
  /** 발송 가능한가(버튼 활성 조건과 동일). */
  canSend: boolean;
  /** 막는 사유 전부(우선순위 순). 비어 있으면 발송 가능. */
  reasons: SendBlockReason[];
  /** 버튼 아래 라벨 — 발송 가능하면 null. */
  label: string | null;
  /** 버튼 title(툴팁) 상세 — 라벨보다 길게 "왜/어떻게". 발송 가능하면 null. */
  hint: string | null;
};

/**
 * 행의 발송 게이트 판정.
 *
 * ⚠️ sent·absent는 **단독으로** 보고한다 — 발송 완료 행에 "진도·멘트 입력 필요"를 같이 띄우면
 *    아직 손댈 게 남은 것처럼 읽힌다(발송분은 수정 자체가 금지다).
 */
export function evaluateSendGate(args: {
  alreadySent: boolean;
  isAbsent: boolean;
  hasProgress: boolean;
  hasDraft: boolean;
}): SendGate {
  if (args.alreadySent) {
    return {
      canSend: false,
      reasons: ["sent"],
      label: "발송됨 — 재발송 불가",
      hint: "이미 학부모에게 발송된 보고서입니다 — ClassNote는 게시글 수정이 안 됩니다",
    };
  }
  if (args.isAbsent) {
    return {
      canSend: false,
      reasons: ["absent"],
      label: "결석 — 발송 제외",
      hint: "결석 학생 — 발송 제외 (기록 저장은 가능)",
    };
  }
  const needs: ("progress" | "ment")[] = [];
  if (!args.hasProgress) needs.push("progress");
  if (!args.hasDraft) needs.push("ment");
  if (needs.length === 0) return { canSend: true, reasons: [], label: null, hint: null };
  return {
    canSend: false,
    reasons: needs,
    label: `${needs.map((n) => NEED_LABEL[n]).join(" · ")} 입력 필요`,
    hint: [
      needs.includes("progress") ? "오늘 진도를 입력해야 발송할 수 있습니다(보고서 본문의 뼈대)" : "",
      needs.includes("ment")
        ? "학부모 전달 멘트가 비어 있습니다 — '자동작성'을 누르거나 직접 입력하세요(빈 보고서는 발송되지 않습니다)"
        : "",
    ]
      .filter(Boolean)
      .join(" / "),
  };
}
