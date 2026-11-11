/**
 * 등록상담 **상세 화면이 무엇을 어느 자리에 보일지** — 순수 판정(Vitest로 잠근다).
 *
 * 원장 2026-09-10 두 마디에서 나온 규칙이다:
 *  ① *"사실 브리프는 상담완료 칸반 이후로는 필요없을듯"* — 준비물은 상담 **전**에만 준비물이다.
 *  ② *"지난 브리프로 이름을 바꿔버리던지 처리해버리고 중요한건 배정된 반이니까"* — 그래서 **지우지 않고**
 *     격을 내리고(이름·톤·자리), 그 자리는 '배정된 반'이 가져간다.
 *
 * 🔴 판정 재료는 [`stageOfCard`](./board-stages.ts) 하나다 — 화면이 `outcome` 문자열을 직접 비교하면
 *    칸반과 상세가 서로 다른 말을 한다(옛 5칸 시절 각 화면이 자기 조건을 들고 있던 것과 같은 함정).
 * 🔴 `stageOfCard`는 **반 배정(수강 ≥ 1)이 outcome을 이긴다** — outcome이 `pending`이어도 반이 붙어
 *    있으면 '등록 완료'다. 그러니 "배정됐는데 브리프가 위에 남아 있다"가 생기지 않는다.
 */

import { stageOfCard, type StageInput } from "./board-stages";

export type DetailPanels = {
  /**
   * 브리프가 **지난 기록**인가(= '상담 전' 칸을 지났나). true면 제목이 '지난 상담 브리프'가 되고
   * 톤이 무채색으로, 자리는 페이지 맨 아래로 내려가며 '다시 작성'이 사라진다(인쇄는 남는다).
   */
  pastBrief: boolean;
  /**
   * '배정된 반' 카드를 그리는가. '등록 완료' 칸에만 — 그 칸은 두 부류인데 둘 다 이 카드가 답한다
   * (실제로 반이 붙은 건 = 어떤 반인지 / outcome만 `enrolled`인 건 = "아직 배정 없음"이 곧 할 일).
   */
  showAssigned: boolean;
};

export function detailPanelsFor(card: StageInput): DetailPanels {
  const stage = stageOfCard(card);
  return { pastBrief: stage !== "before", showAssigned: stage === "enrolled" };
}

/**
 * 브리프 카드(또는 수정 화면의 펼치기 줄)를 **그리는가** — 상세 화면과 수정 화면이 같은 이 판정을 쓴다.
 * 만들어 둔 것·만드는 중인 것은 어느 칸에서든 남고, 아직 안 만든 건은 '상담 전'에만 권유한다.
 * ⚠️ 지난 건의 **실패 상태만 남은 카드는 안 그린다**(`failed` + 브리프 없음 + past) — 다시 만들 수 없는
 *    문서의 실패 안내와 "만들어 드립니다" 소개문만 남아, 할 수 없는 일을 권하는 꼴이 된다.
 *    생성 중(`generating`)은 곧 결과가 생기므로 그대로 그린다.
 */
export function showBriefCard(input: {
  hasBrief: boolean;
  status: "generating" | "failed" | null;
  /** `detailPanelsFor(...).pastBrief` */
  past: boolean;
}): boolean {
  return input.hasBrief || input.status === "generating" || !input.past;
}

/**
 * '배정된 반' 카드가 그릴 네 갈래.
 *
 * 🔴 **`error`와 `empty`는 절대 뭉치지 않는다**(원장 지시 *"조회 실패와 '배정 없음'을 구분"*).
 *    실패를 "배정된 반이 없습니다"로 적으면 이미 반이 있는 학생을 데스크가 한 번 더 배정한다 —
 *    그래서 실패가 **가장 먼저** 걸린다(학생 연결 여부보다 앞).
 */
export type AssignedPanelState = "error" | "no-student" | "empty" | "list";

export function assignedPanelState(input: {
  /** 조회 성공 여부. false면 rows를 믿을 수 없다. */
  ok: boolean;
  /** 상담에 연결된 학생이 있는가. 없으면 "배정이 없다"가 아니라 "아직 학생이 없다"가 사실이다. */
  hasStudent: boolean;
  /** 성공했을 때의 배정 반 수. */
  count: number;
}): AssignedPanelState {
  if (!input.ok) return "error";
  if (!input.hasStudent) return "no-student";
  return input.count > 0 ? "list" : "empty";
}
