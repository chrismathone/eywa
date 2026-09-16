/**
 * 휴원 다이얼로그의 "휴원할 수업 선택" → **무슨 일이 벌어지는지**(버튼 라벨·안내문)의 단일 소스.
 *
 * 배경(원장 2026-09-16): *"퇴원이든 휴원이든 … 누르면 수강중인 수업 전부 보여주고 그중에서 선택한
 * 과목만 휴원 및 퇴원처리할 수 있게."* — 퇴원은 2026-08-20에 이미 과목을 고르게 했는데
 * ([`withdraw-selection.ts`](./withdraw-selection.ts)) 휴원은 여전히 **활성 수강을 통째로** 대기로
 * 돌리는 길 하나뿐이었다(영어만 쉬려는데 수학까지 멈춘다).
 *
 * 규칙(퇴원과 같은 결):
 *  · 전부 선택 = 지금과 동일한 **학생 휴원**(students.status='on_hold' + 전 수강 대기).
 *  · 일부만 선택 = **학생 휴원이 아니다.** 고른 수강만 대기로 돌리고 학생은 재원으로 남는다.
 *  · 🔑 **체크를 푼 수업 중 지금 대기인 것은 다시 수강으로 되돌린다** — 선택이 곧 "휴원 중인 수업"이라
 *    되돌릴 문이 같은 화면에 있다. 이게 없으면 부분 휴원을 걸어 놓고 **풀 방법이 없다**(학생 상태가
 *    '재원'이라 '재원 복구' 항목이 메뉴에 안 뜬다).
 *  · 0개 선택 = 되돌릴 게 있으면 **전부 재개**, 그것도 없으면 진행 불가.
 *
 * 🔴 라벨·안내는 **누르기 전에** 결과를 말해야 한다(퇴원 다이얼로그와 같은 이유 — 누른 뒤에 알게 되면
 *    "한 과목만 쉰다고 했는데 둘 다 멈췄다"가 된다).
 */

export type HoldSelectionMode =
  /** 아무것도 안 고름 + 되돌릴 것도 없음 — 진행 불가. */
  | "none"
  /** 일부만 — 그 수강만 대기, 학생은 재원 유지. */
  | "partial"
  /** 전부(또는 활성 수강 0개) — 학생 휴원. */
  | "full"
  /** 0개인데 대기 중인 수강이 있음 — 전부 재개(학생 상태는 안 바뀐다). */
  | "resume";

export type HoldSelectionPlan = {
  mode: HoldSelectionMode;
  /** 제출 버튼 라벨. */
  buttonLabel: string;
  /** 버튼 위 안내문 — 결과를 미리 말한다. */
  notice: string;
};

/**
 * @param total          이 학생의 활성(end_date null) 수강 수.
 * @param selectedLabels 선택된(=휴원할) 수강의 표시명(반 이름). 호출부가 이미 한글 라벨로 만든 값.
 * @param resumeLabels   **지금 대기인데 선택이 풀린** 수강의 표시명 — 저장하면 다시 수강으로 돌아간다.
 */
export function describeHoldSelection(
  total: number,
  selectedLabels: string[],
  resumeLabels: string[] = [],
): HoldSelectionPlan {
  // 활성 수강이 아예 없는 학생 — 고를 것이 없으니 종전과 같은 단순 휴원.
  if (total <= 0) {
    return {
      mode: "full",
      buttonLabel: "휴원 처리",
      notice: "대기로 돌릴 활성 수강이 없습니다. 학생 상태만 '휴원'이 됩니다.",
    };
  }

  const selected = selectedLabels.length;
  const resume = resumeLabels.length;

  if (selected <= 0) {
    if (resume > 0) {
      return {
        mode: "resume",
        buttonLabel: `휴원 해제(${resume}개)`,
        notice: `${resumeLabels.join(", ")}을(를) 다시 수강으로 되돌립니다 — 학생은 재원 그대로입니다.`,
      };
    }
    return {
      mode: "none",
      buttonLabel: "휴원 처리",
      notice: "휴원할 수업을 1개 이상 선택해 주세요.",
    };
  }

  if (selected >= total) {
    return {
      mode: "full",
      buttonLabel: "휴원 처리",
      notice: `활성 수강 ${total}개가 모두 대기로 바뀌고, 학생 상태가 '휴원'이 됩니다.`,
    };
  }

  // 🔴 "학생은 재원으로 남습니다"가 이 문장의 핵심 — 퇴원 다이얼로그와 같은 이유다.
  const resumeNote = resume > 0 ? ` (${resumeLabels.join(", ")}은(는) 수강으로 되돌립니다)` : "";
  return {
    mode: "partial",
    buttonLabel: `휴원(${selected}개)`,
    notice: `${selectedLabels.join(", ")}만 대기로 바꿉니다 — 학생은 재원으로 남습니다${resumeNote}.`,
  };
}
