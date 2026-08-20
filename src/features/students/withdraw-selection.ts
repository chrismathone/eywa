/**
 * 퇴원 다이얼로그의 "종료할 수업 선택" → **무슨 일이 벌어지는지**(버튼 라벨·안내문)의 단일 소스.
 *
 * 배경(원장 2026-08-20): *"학생 퇴원 전환시에 자꾸 한과목 퇴원인데 두과목 퇴원처리되서 말싸움이 조금 있다."*
 * 실데이터로도 재원 335명 중 90명(27%)이 두 과목이고, 같은 날 두 과목이 함께 종료된 사례가 14건
 * (그중 12건이 최근 6주), 되돌린 흔적(`student_restore`)이 13건 있었다. 종전 다이얼로그는
 * *"활성 수강 등록은 모두 종료되며…"* 한 줄뿐이라 **어느 반이 닫히는지 누르기 전엔 알 수 없었다.**
 *
 * 규칙(원장 확정):
 *  · 전부 선택 = 지금과 동일한 **학생 퇴원**(students.status='withdrawn' + 전 수강 종료 + 퇴원관리 노출).
 *  · 일부만 선택 = **학생 퇴원이 아니다.** 고른 수강만 종료하고 학생은 재원으로 남는다.
 *  · 0개 선택 = 진행 불가(무엇을 하겠다는 건지 알 수 없다).
 *
 * 🔴 라벨·안내는 **누르기 전에** 결과를 말해야 한다 — 누른 뒤에 알게 되면 지금과 같은 말싸움이 난다.
 */

export type EndSelectionMode =
  /** 아무것도 안 고름 — 진행 불가. */
  | "none"
  /** 일부만 — 그 수강만 종료, 학생은 재원 유지. */
  | "partial"
  /** 전부(또는 활성 수강 0개) — 학생 퇴원. */
  | "full";

export type EndSelectionPlan = {
  mode: EndSelectionMode;
  /** 제출 버튼 라벨. */
  buttonLabel: string;
  /** 버튼 위 안내문 — 결과를 미리 말한다. */
  notice: string;
};

/**
 * @param total   이 학생의 활성(end_date null) 수강 수.
 * @param selectedLabels 선택된 수강의 표시명(반 이름). 안내문에 그대로 실린다 —
 *                       호출부에서 이미 한글 라벨로 만든 값을 넘길 것(raw enum 금지).
 */
export function describeEndSelection(total: number, selectedLabels: string[]): EndSelectionPlan {
  // 활성 수강이 아예 없는 학생 — 고를 것이 없으니 종전과 같은 단순 퇴원.
  if (total <= 0) {
    return {
      mode: "full",
      buttonLabel: "퇴원 처리",
      notice: "종료할 활성 수강이 없습니다. 학생만 퇴원 처리되고 퇴원관리 페이지에 노출됩니다.",
    };
  }

  const selected = selectedLabels.length;

  if (selected <= 0) {
    return {
      mode: "none",
      buttonLabel: "퇴원 처리",
      notice: "종료할 수업을 1개 이상 선택해 주세요.",
    };
  }

  if (selected >= total) {
    return {
      mode: "full",
      buttonLabel: "퇴원 처리",
      notice: `활성 수강 ${total}개가 모두 종료되고, 퇴원관리 페이지에 노출됩니다.`,
    };
  }

  return {
    mode: "partial",
    buttonLabel: `수업 종료(${selected}개)`,
    // 🔴 "학생은 재원으로 남습니다"가 이 문장의 핵심 — 데스크가 퇴원으로 오해하면 사고가 반복된다.
    notice: `${selectedLabels.join(", ")}만 종료합니다 — 학생은 재원으로 남습니다(퇴원관리 '수강종료'에서 확인).`,
  };
}
