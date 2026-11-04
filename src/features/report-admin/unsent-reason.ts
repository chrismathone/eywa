/**
 * 보고서 목록 '미발송' 칸의 **아직 안 나간 이유** 카드(순수 · Vitest) — 원장 2026-11-04 *"이런 미발송건에 대해서도 이유를 자세히
 * 볼 수 있게 마우스오버 등으로"*. 실제 예: 전유솔 11-03 BS1L — 보고서는 저장됐는데 발송 대기에 오른 적이 없다(상태 없음 · 큐 없음 ·
 * 오류 없음). 그 학생의 그 반 보드 판정이 보류("원아 '전유솔' 보호자 전화 불일치")라 발송이 막혔는데 화면은 '미발송'뿐이었다.
 *
 * 🔴 판정을 새로 만들지 않는다 — 이미 있는 함수와 같은 판정·같은 문장(원장 *"같은 데이터는 같은 원본으로"*):
 *  · 발송 기한 = `classnoteRetryDeadline`(오늘 포함 7일 · 원장 지정 예외 0276a `classnote_deadline_exempt_at`)
 *  · 미발송 반·결석·출결 미체크·진도·멘트·자동작성(새 수학 보고서 — 저장된 작성 방식 `ment_source`)·보강 확인(`makeupUncheckedIds`)
 *    = 발송 게이트 `evaluateSendGate`(원스크린 발송 버튼과 같은 판정·같은 안내 — 서버 발송 겹과도 같은 재료)
 *  · 반 보드 = `classifyBoardMissing` → `boardMissingNotice`(원스크린 발송 막힘 안내 — 서버가 재료를 모아 넘긴다).
 *    반 없는 보강 줄은 원스크린이 보강 반을 바꾸게 한다(`resolveMakeupSendClass` · 바꿀 반이 없으면 '보낼 반이 없어' 막는다) —
 *    두 경우를 덮는 말로 적는다(`UNSENT_MAKEUP_BOARD`). 합침(정규+보강) 줄은 반이 있어 정규 반 보드 문장이다.
 *  · 과목·실제 발송 = `isClassnoteSubjectEnabled` · `classnoteSendOn`(서버가 판정해 넘긴다)
 * ⚠️ 원스크린 게이트 재료 중 **저장되지 않는 것**(사랑의 한마디 · 시험·숙제 사유 · 태도 의견 · 자동작성 뒤 바뀐 값의 사실 서명)은
 *    서버가 볼 수 없다. 그래서 아무것도 안 걸리면 "누르지 않았다"고 단정하지 않는다(`UNSENT_NOT_PRESSED` — 리뷰 2026-11-04).
 * 🔴 보호자 전화 **값**은 싣지 않는다 — 연동 PC의 보류 사유는 일치 여부만 적지만(0302a), 혹시 섞여도 숫자 열을 가린다.
 * 🔴 화면에 원문 영어 코드(`hold`·`board_hold_admin` 등)를 싣지 않는다 — 전부 한글 문장·라벨.
 */
import type { TipCard, TipRow } from "@/components/hover-tip/tip";
import { classnoteRetryDeadline } from "@/features/onescreen/classnote-guard";
import { boardHoldReasonText, boardMissingNotice, type BoardMissingKind } from "@/features/onescreen/send-class";
import { evaluateSendGate } from "@/features/onescreen/send-gate";
import { sheetTf } from "@/features/teacher-view/i18n";

export const UNSENT_TIP_TITLE = "아직 안 나간 이유";
/**
 * 서버가 볼 수 있는 막힘이 하나도 없을 때 — 대개 저장만 하고 발송을 누르지 않은 것이지만, 저장되지 않는 원스크린 작성 조건
 * (사랑의 한마디·사유·태도 의견)에 걸려 버튼이 잠겨 있을 수도 있어 단정하지 않는다.
 */
export const UNSENT_NOT_PRESSED =
  "확인되는 막힘은 없습니다 — 아직 발송을 누르지 않았거나(저장만 된 보고서), 원스크린의 작성 조건(사랑의 한마디·사유·태도 의견)이 남아 발송 버튼이 잠겨 있을 수 있습니다";
/**
 * 반 없는 보강 줄의 보강 반에 반 보드가 없을 때 — 원스크린은 막지 않고 보강 반을 바꾸게 한다(서버 `resolveMakeupSendClass`와 같은 길).
 * 바꿀 후보 반이 없으면 원스크린은 '보낼 반이 없어 발송할 수 없습니다'로 막는다 — 카드는 후보를 읽지 않으므로 그 경우까지 덮게 적는다.
 * 합침(정규+보강) 줄은 반이 있어 정규 반 보드로 판정한다 — 이 문장을 쓰지 않는다.
 */
export const UNSENT_MAKEUP_BOARD =
  "보강 반에 이 학생의 ClassNote 반 보드가 없습니다 — 원스크린에서 반 보드가 있는 반으로 보강 반을 바꿔야 보낼 수 있습니다(그런 반이 없으면 학생의 반을 확인해 주세요)";
/** 기한이 지난 미발송 — 큐 카드 '기한 만료'와 같은 말. */
export const UNSENT_EXPIRED = "발송 기한(보고서 날짜 포함 7일)이 지나 이제는 어떤 경로로도 보낼 수 없습니다";
/** 실제 발송 스위치가 꺼진 학원 — 목록의 '선택 발송' dry-run 안내와 같은 말. */
export const UNSENT_SEND_OFF = "ClassNote 실제 발송이 꺼져 있습니다 — 원장 설정(보고서)에서 'ClassNote 실제 발송'을 켜야 전송됩니다";

/** 목록에서 '미발송'으로 그리는 줄인가 — 발송 이력 없음 + 이관분 아님(목록 StatusCell·'미발송' 필터와 같은 집합). */
export function isUnsentListRow(r: { classnoteStatus: string | null; source: string | null }): boolean {
  return !r.classnoteStatus && r.source !== "edutrix_import";
}

/** 전화번호처럼 보이는 숫자 열을 가린다(방어 — 사유에 값이 섞여 들어와도 화면에 나가지 않게). */
export function maskPhoneLike(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(/(?:\+?82[-\s.]?)?0\d{1,2}[-\s.)]*\d{3,4}[-\s.]*\d{4}/g, "(번호 가림)")
    .replace(/\d{9,}/g, "(번호 가림)");
}

const BOARD_STATE: Record<BoardMissingKind, string> = {
  enrolling: "배정 전",
  class_pending: "연결 없음",
  hold_join: "배정 보류",
  hold_other: "배정 보류",
  left: "반을 떠남",
  unknown: "확인 필요",
};

/** 서버가 모아 넘기는 사실(판정 재료는 전부 기존 함수의 입력 모양). */
export type UnsentReasonFacts = {
  reportDate: string;
  /** KST 오늘. */
  today: string;
  /** 원장이 건마다 지정한 발송 기한 예외(0276a). */
  deadlineExempt: boolean;
  /** 학원 ClassNote 실제 발송 스위치(`classnoteSendOn`). */
  sendOn: boolean;
  /** 발송 허용 과목인가(`isClassnoteSubjectEnabled`) + 그 과목의 한글 이름. */
  subjectOk: boolean;
  subjectLabel: string;
  /** 발송 게이트 재료 — 원스크린 발송 버튼과 같은 입력 중 서버가 볼 수 있는 것. */
  gate: {
    reportOptout: boolean;
    isAbsent: boolean;
    hasProgress: boolean;
    hasMent: boolean;
    attendanceUnchecked: boolean;
    /** 새 수학 보고서인데 저장된 작성 방식이 자동작성(auto·auto_edited)이 아니다 — 서버 발송 겹과 같은 판정. */
    needsAutoWrite: boolean;
    /** 보강이 든 보고서인데 보강 진행 여부를 아직 확인하지 않았다(`makeupUncheckedIds`). */
    needsMakeupCheck: boolean;
  };
  /** 반 보드가 없어 막힌 까닭(반별 발송 대상 수학 보고서이고 그 학생의 살아 있는 반 보드가 없을 때만). `makeup` = 반 없는 보강 줄(합침 줄은 아님). */
  board: { kind: BoardMissingKind; holdReason: string | null; makeup: boolean } | null;
};

function deadlineValue(f: UnsentReasonFacts): string {
  if (f.deadlineExempt) return "원장 지정 — 기한이 지나도 보냅니다";
  const d = classnoteRetryDeadline(f.reportDate, f.today);
  if (d.expired) return "기한 만료";
  if (d.daysLeft === 0) return "오늘까지";
  if (d.daysLeft === 1) return "내일까지";
  const [, m, day] = d.lastDate.split("-");
  return `${Number(m)}/${Number(day)}까지`;
}

/** 카드 한 장 — 있는 이유만 싣는다. 이유가 하나도 없으면 '아직 발송을 누르지 않았다'. */
export function unsentReasonCard(f: UnsentReasonFacts): TipCard {
  const rows: TipRow[] = [["발송 기한", deadlineValue(f)]];
  const lines: string[] = [];
  if (!f.deadlineExempt && classnoteRetryDeadline(f.reportDate, f.today).expired) lines.push(UNSENT_EXPIRED);
  if (!f.sendOn) lines.push(UNSENT_SEND_OFF);
  if (!f.subjectOk) lines.push(sheetTf("ko", "os.c.subjectOff", { subject: f.subjectLabel || "이 과목" }));
  const gate = evaluateSendGate({
    alreadySent: false,
    reportOptout: f.gate.reportOptout,
    isAbsent: f.gate.isAbsent,
    hasProgress: f.gate.hasProgress,
    hasDraft: f.gate.hasMent,
    attendanceUnchecked: f.gate.attendanceUnchecked,
    needsAutoWrite: f.gate.needsAutoWrite,
    needsMakeupCheck: f.gate.needsMakeupCheck,
  });
  if (!gate.canSend && gate.hint) lines.push(...gate.hint.split(" / ").filter(Boolean));
  // 미발송 반은 반 보드 대상이 아니다 — 거기에 '반 보드 없음'을 덧붙이면 거짓 안내다.
  if (f.board && !f.gate.reportOptout) {
    const hold = f.board.holdReason ? maskPhoneLike(f.board.holdReason) : null;
    rows.push(["반 보드", BOARD_STATE[f.board.kind]]);
    if (f.board.kind === "hold_join" || f.board.kind === "hold_other") rows.push(["보류 사유", boardHoldReasonText(hold)]);
    // 반 없는 보강 줄은 '다른 반으로 보내지 않는다'(정규 보고서 규칙)가 아니라 보강 반을 바꾸는 길이다(바꿀 반이 없으면 막힌다).
    lines.push(f.board.makeup ? UNSENT_MAKEUP_BOARD : boardMissingNotice(f.board.kind, false, hold).error);
  }
  if (lines.length === 0) lines.push(UNSENT_NOT_PRESSED);
  return { title: UNSENT_TIP_TITLE, rows, lines: lines.map(maskPhoneLike), wide: true };
}
