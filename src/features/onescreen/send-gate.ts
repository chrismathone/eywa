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
 *    · 미발송 반   = `isReportOptoutRow` (grid.ts — 0174a 반은 발송 자체가 없다, 2026-08-19)
 *    · 결석       = `attendanceRaw === "absent"` (isRowActionable "send")
 *    · 출결 미체크 = `isAttendanceUnchecked` (2026-08-17 — 출결 체크도 발송 필요 입력, 정규 반 행만)
 *    · 진도 미입력 = `isReportEligible` (빈 보고서 방지)
 *    · 멘트 미작성 = 🔴 **빈 멘트 절대 가드**(2026-07-28 사고) — `sendRow`가 즉시 거절하고 워커도
 *      최종 관문에서 차단한다. 예전엔 버튼이 멀쩡히 눌려서 빨간 토스트로만 알 수 있었다.
 */

import {
  DEFAULT_SHEET_LANG,
  sheetT,
  sheetTf,
  type SheetDictKey,
  type SheetLang,
} from "@/features/teacher-view/i18n";
import { reportOptoutNotice, reportOptoutShort } from "@/features/classes/report-optout";

/** 발송을 막는 사유. sent·absent는 **상태**(고칠 게 아니라 그런 행), attendance·progress·ment는 **필요한 입력**. */
export type SendBlockReason =
  | "sent"
  | "absent"
  | "attendance"
  | "progress"
  | "ment"
  /** 수학 보고서 시범(math-report-pilot.ts) — '자동작성' 글 그대로가 아니다. */
  | "autowrite"
  | "recall_pending"
  /** 발송 대기·게시 중(queued/processing) — 워커 결과가 나올 때까지 다시 못 누른다(원장 2026-09-29). */
  | "in_flight"
  | "readonly"
  /** '수업보고서 미발송' 반(0174a) — 발송이 없는 반. 출결만 찍는다(2026-08-19). */
  | "report_optout";

/** 입력이 필요한 사유의 짧은 이름 — 라벨에서 "출결 · 진도 · 멘트 입력 필요"로 이어 붙인다. */
type NeedReason = "attendance" | "progress" | "ment" | "autowrite";
const NEED_KEY: Record<NeedReason, SheetDictKey> = {
  attendance: "os.gate.need.attendance",
  progress: "os.gate.need.progress",
  ment: "os.gate.need.ment",
  autowrite: "os.gate.need.autowrite",
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
  /**
   * 이 행의 반이 '수업보고서 미발송'(0174a)인가 — `isReportOptoutRow`(grid.ts)를 그대로 넣는다.
   * 옵셔널인 이유: 로스터 밖 호출부(데모·보강 행)는 반이 없어 애초에 해당이 없다.
   */
  reportOptout?: boolean;
  isAbsent: boolean;
  hasProgress: boolean;
  hasDraft: boolean;
  /**
   * 출결 미체크(정규 반 행에서 그날 출결 기록 없음) — `isAttendanceUnchecked`(grid.ts)를 그대로 넣는다.
   * 🔴 옵셔널이 아니다 — 옵셔널로 두면 새 소비처가 빼먹었을 때 버튼은 살아 있는데 서버가 거절하는
   *    "눌렀는데 무반응"이 된다(이 모듈이 막으려는 2026-07-30 문제의 재발). 컴파일러가 강제하게 한다.
   */
  attendanceUnchecked: boolean;
  /**
   * 회수 요청됐지만 워커가 아직 옛 글을 안 지웠다 — 지금 보내면 **옛 글 옆에 새 글이 하나 더** 붙고,
   * 새 토큰을 내면 워커가 지울 글을 못 찾아 **고아 게시글**이 된다. 삭제가 끝난 뒤에만 보낸다.
   */
  recallPending?: boolean;
  /**
   * 발송을 눌러 **대기·게시 중**(queued/processing)이다 — 워커가 성공·실패를 적을 때까지 버튼을 잠근다.
   * 원장 2026-09-29 *"발송한번 누르면 실제 워커 발송체크 후에 … 한번 누르면 버튼 동시에 못누르게"* — 9/29 박세욱:
   * 첨부를 넣고 0.3초 만에 다시 눌러 같은 글이 두 번 나갔다. 서버도 같은 경합을 막는다(조건부 적재) — 여기는 화면 게이트.
   * 실패하면 상태가 failed로 바뀌어 다시 풀린다. 저장 버튼은 그대로라 대기 중에도 내용은 고칠 수 있다.
   */
  sendInFlight?: boolean;
  /**
   * '다른 강사 뷰'(열람 전용, 2026-08-19) — 화면 전체가 발송 불가. 게이트 **밖**에서 canSend를 AND로
   * 꺾으면 "비활성인데 사유 라벨 없음"(이 모듈이 죽이려는 2026-07-30 문제)이 재발한다 — 사유도 여기서.
   * 옵셔널인 이유: 원스크린 열람 화면 전용 상태라 다른 소비처는 몰라도 된다(빼먹어도 기존 판정 그대로).
   */
  readonlyView?: boolean;
  /**
   * 수학 보고서 시범(테스트 학생 한정, math-report-pilot.ts) — 멘트가 '자동작성' 글 그대로가 아니다(안 눌렀거나 달라졌다).
   * 서버(`saveAndQueueClassnote`)도 같은 이유로 거절한다. 옵셔널 = 시범 밖 행은 종전 판정 그대로.
   */
  needsAutoWrite?: boolean;
  /**
   * 화면 언어 — 없으면 한국어(기존 호출부는 한 글자도 안 바뀐다).
   * 🔴 **판정에는 안 쓴다**: `canSend`·`reasons`는 언어와 무관하고 글자만 갈린다.
   */
  lang?: SheetLang;
}): SendGate {
  const lang = args.lang ?? DEFAULT_SHEET_LANG;
  const t = (k: SheetDictKey) => sheetT(lang, k);
  if (args.readonlyView) {
    return {
      canSend: false,
      reasons: ["readonly"],
      label: t("os.gate.readonly"),
      hint: t("os.gate.readonlyHint"),
    };
  }
  if (args.recallPending) {
    return {
      canSend: false,
      reasons: ["recall_pending"],
      label: t("os.gate.recall"),
      hint: t("os.gate.recallHint"),
    };
  }
  if (args.sendInFlight) {
    return {
      canSend: false,
      reasons: ["in_flight"],
      label: t("os.gate.inFlight"),
      hint: t("os.gate.inFlightHint"),
    };
  }
  // 🔴 이미 발송된 건이 있으면 그 사실이 먼저다 — "미발송 반"이라고만 하면 이미 나간 글을 못 본다.
  //    (미발송 반이 되기 전에 쓴 옛 보고서가 실제로 있을 수 있다.)
  if (args.alreadySent) {
    return {
      canSend: false,
      reasons: ["sent"],
      label: t("os.gate.sent"),
      hint: t("os.gate.sentHint"),
    };
  }
  if (args.reportOptout) {
    return {
      canSend: false,
      reasons: ["report_optout"],
      label: reportOptoutShort(lang),
      hint: reportOptoutNotice(lang),
    };
  }
  if (args.isAbsent) {
    return {
      canSend: false,
      reasons: ["absent"],
      label: t("os.gate.absent"),
      hint: t("os.gate.absentHint"),
    };
  }
  const needs: NeedReason[] = [];
  // 출결이 행에서 제일 앞 칸이라 사유도 맨 앞 — 체크하는 순서대로 읽힌다.
  if (args.attendanceUnchecked) needs.push("attendance");
  if (!args.hasProgress) needs.push("progress");
  // 시범 대상은 '멘트를 쓰라'가 아니라 '자동작성을 누르라'다(칸이 잠겨 있어 직접 쓸 수 없다).
  if (args.needsAutoWrite) needs.push("autowrite");
  else if (!args.hasDraft) needs.push("ment");
  if (needs.length === 0) return { canSend: true, reasons: [], label: null, hint: null };
  return {
    canSend: false,
    reasons: needs,
    label: sheetTf(lang, "os.gate.needLabel", {
      list: needs.map((n) => t(NEED_KEY[n])).join(" · "),
    }),
    hint: [
      needs.includes("attendance") ? t("os.gate.hint.attendance") : "",
      needs.includes("progress") ? t("os.gate.hint.progress") : "",
      needs.includes("ment") ? t("os.gate.hint.ment") : "",
      needs.includes("autowrite") ? t("os.gate.hint.autowrite") : "",
    ]
      .filter(Boolean)
      .join(" / "),
  };
}
