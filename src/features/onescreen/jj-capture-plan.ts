/**
 * 영어 보고서 저장 때 **인재원 자료를 받아 묶을지**와 못 묶었을 때 강사에게 알릴 문장 — 순수 모듈(Vitest로 잠금).
 *
 * 🔑 받는 조건은 둘 다다: 영어(템플릿 과목) + 글에 그림 자리 줄이 있다. 수학 저장은 인재원을 부르지 않는다(느려지지 않게).
 * 🔴 못 받아도 저장은 **성공**이다 — 글은 그대로 남고 카드는 그림 자리를 비운다. 대신 사실을 말한다
 *    (말없이 넘기면 강사는 그림이 들어간 줄 알고 보낸다).
 * ⚠️ 문장은 서버가 돌려주는 한국어다(서버 거절 문구와 같은 층) — 화면은 그대로 토스트한다.
 */
import { TEMPLATE_SUBJECT } from "@/features/report-templates/defaults";
import { stripImageSlots, usedImageSlots } from "@/features/report-templates/image-slots";

export function shouldCaptureJj(subject: string | null | undefined, notes: string | null | undefined): boolean {
  return subject === TEMPLATE_SUBJECT && usedImageSlots(notes).length > 0;
}

/**
 * 영어 글이 **그림 자리 줄뿐**인가(글자 0) — 발송 큐에 올리지 않는다. 워커의 '빈 글' 검사는 자리 줄을 글자로 세서
 * 통과시키는데, 카드는 자리만 그리거나(자료 없으면) "작성된 보고 내용이 없습니다"를 학부모에게 보낸다(적대 리뷰 2026-09-11).
 * 자리 줄이 없는 빈 글은 이 판정 밖이다(종전 경로 그대로).
 */
export function isSlotOnlyEnglishNotes(subject: string | null | undefined, notes: string | null | undefined): boolean {
  return shouldCaptureJj(subject, notes) && !stripImageSlots(notes).trim();
}

export type JjCaptureOutcome = "unlinked" | "fetch_failed" | "not_ready" | "save_failed";

const TEXT: Record<JjCaptureOutcome, string> = {
  unlinked:
    "인재원과 연결되지 않은 학생이라 그림(시험 결과지·학습 분석지) 없이 저장했습니다 — 성적관리 › 영어 › JJ실에서 연결할 수 있습니다",
  // 같은 짝의 옛 자료가 있으면 그것으로 그려지므로 "그림 없이"라고 단정하지 않는다(적대 재리뷰).
  fetch_failed:
    "인재원 자료를 새로 받지 못했습니다 — 잠시 후 다시 저장하면 다시 받습니다(그 전까지는 전에 받아 둔 자료로 그리거나 그림 없이 보입니다)",
  not_ready: "그림 저장소가 아직 준비되지 않아(DB 적용 전) 그림 없이 저장했습니다",
  save_failed: "인재원 그림 자료를 보고서에 붙이지 못했습니다 — 다시 저장해 주세요",
};

export function jjCaptureWarning(outcome: JjCaptureOutcome): string {
  return TEXT[outcome];
}
