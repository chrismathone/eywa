/**
 * 퇴원 다이얼로그의 "종료할 수업 선택" → **무슨 일이 벌어지는지**(버튼 라벨·안내문)의 단일 소스.
 *
 * 배경(원장 2026-08-20): *"학생 퇴원 전환시에 자꾸 한과목 퇴원인데 두과목 퇴원처리되서 말싸움이 조금 있다."*
 * 실데이터로도 재원 335명 중 90명(27%)이 두 과목이고, 같은 날 두 과목이 함께 종료된 사례가 14건
 * (그중 12건이 최근 6주), 되돌린 흔적(`student_restore`)이 13건 있었다. 종전 다이얼로그는
 * *"활성 수강 등록은 모두 종료되며…"* 한 줄뿐이라 **어느 반이 닫히는지 누르기 전엔 알 수 없었다.**
 *
 * 규칙(원장 확정):
 *  · 전부 선택 = **학생 퇴원** — 🔴 2026-10-23부터 이 창에서 하지 않는다(원장 *"퇴원 보고서를 써야 퇴원처리가 가능하도록"*).
 *    안내문이 퇴원보고서로 보내고 창은 저장 버튼을 잠근다(서버도 같은 판정으로 거절 — `changeStudentStatus`·`lastCourseViaReport`).
 *  · 일부만 선택 = **학생 퇴원이 아니다.** 고른 수강만 종료하고 학생은 재원으로 남는다.
 *    🔴 단 고른 과목을 끝내면 **그 과목 수강종료**(퇴원관리 '수강종료'에 선다)면 이 창에서 하지 않는다 — 퇴원보고서로(원장 2026-10-26
 *    *"그 과목의 마지막 반을 끝내는건 기존에 있던 것과 일치하게"* · 서버 게이트 `lastCourseViaReport`와 같은 판정을 원생 화면이 미리 돌려 넘긴다).
 *    특강만 다니던 과목처럼 수강종료로 세지 않는 종료 · 예전에 걸린 퇴원 예약이 있는 학생은 그대로 이 창에서 끝낸다.
 *  · 0개 선택 = 진행 불가(무엇을 하겠다는 건지 알 수 없다).
 *
 * 🔴 라벨·안내는 **누르기 전에** 결과를 말해야 한다 — 누른 뒤에 알게 되면 지금과 같은 말싸움이 난다.
 * 🔑 **단위는 과목이다**(원장 2026-09-16 *"과목 선택 가능하게 해달라한것 같은데, 수업 선택이 아니라"*) —
 *    `total`은 수강 **과목** 수, `selectedLabels`는 고른 **과목 라벨**이다([`subject-selection.ts`](./subject-selection.ts)).
 *    반 단위로 세웠더니 수학만 세 반 다니는 학생이 한 과목인데 세 줄로 보였다.
 */
import { SUBJECT_END_VIA_REPORT, WITHDRAWAL_VIA_REPORT } from "@/features/withdrawals/via-report";

export type EndSelectionMode =
  /** 아무것도 안 고름 — 진행 불가. */
  | "none"
  /** 일부만 — 그 수강만 종료, 학생은 재원 유지. */
  | "partial"
  /** 일부지만 그 과목 수강종료가 된다 — 퇴원보고서로(이 창에서는 진행 불가). */
  | "subject"
  /** 전부(또는 활성 수강 0개) — 학생 퇴원 = 퇴원보고서로(이 창에서는 진행 불가). */
  | "full";

export type EndSelectionPlan = {
  mode: EndSelectionMode;
  /** 제출 버튼 라벨. */
  buttonLabel: string;
  /** 버튼 위 안내문 — 결과를 미리 말한다. */
  notice: string;
};

/**
 * @param total   이 학생이 수강 중인 **과목** 수(활성 수강을 과목으로 묶은 수).
 * @param selectedLabels 고른 **과목의 라벨**(학원설정 `labelOf`). 안내문에 그대로 실린다 —
 *                       호출부에서 이미 한글 라벨로 만든 값을 넘길 것(raw enum 금지).
 * @param reportLabels   고른 과목 가운데 **끝내면 과목 수강종료라 퇴원보고서로 가는** 과목의 라벨(원생 화면이 서버 판정으로 계산).
 */
export function describeEndSelection(total: number, selectedLabels: string[], reportLabels: string[] = []): EndSelectionPlan {
  // 활성 수강이 아예 없는 학생 — 고를 것이 없다. 퇴원은 퇴원보고서의 바로 처리로.
  if (total <= 0) {
    return {
      mode: "full",
      buttonLabel: "퇴원보고서로 진행",
      notice: `종료할 수강이 없습니다. ${WITHDRAWAL_VIA_REPORT}`,
    };
  }

  const selected = selectedLabels.length;

  if (selected <= 0) {
    return {
      mode: "none",
      buttonLabel: "퇴원 처리",
      notice: "종료할 과목을 1개 이상 선택해 주세요.",
    };
  }

  if (selected >= total) {
    return {
      mode: "full",
      buttonLabel: "퇴원보고서로 진행",
      notice: `수강 중인 ${total}과목을 모두 끝내면 퇴원입니다. ${WITHDRAWAL_VIA_REPORT}`,
    };
  }

  if (reportLabels.length > 0) {
    return {
      mode: "subject",
      buttonLabel: "퇴원보고서로 진행",
      notice: `${reportLabels.join(", ")} — ${SUBJECT_END_VIA_REPORT}`,
    };
  }

  return {
    mode: "partial",
    buttonLabel: `과목 종료(${selected}과목)`,
    // 🔴 "학생은 재원으로 남습니다"가 이 문장의 핵심 — 데스크가 퇴원으로 오해하면 사고가 반복된다.
    //    (퇴원관리 '수강종료'에 서는 과목 종료는 위에서 퇴원보고서로 보냈다 — 여기 남는 것은 특강 종강·예약 학생의 정리라 그 안내를 붙이지 않는다.)
    notice: `${selectedLabels.join(", ")}만 종료합니다 — 학생은 재원으로 남습니다.`,
  };
}
