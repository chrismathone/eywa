/**
 * 등록상담 칸반 **4칸** — 뷰 층의 묶음 단일 소스(순수 함수 + Vitest).
 *
 * 🔴 `outcome` enum([outcome-meta.ts](./outcome-meta.ts))은 **그대로다.** 상세 화면·상태 필터·통계·
 * makeedu 푸시 규칙이 전부 원값을 읽으므로 4칸은 **보여 주는 묶음일 뿐** DB에 새 상태를 만들지 않는다.
 * 그래서 칸 판정·드롭 대표값·카드 표식이 전부 여기 한 곳에서 나온다 — 칸반과 그 필터가 각자 판정하면
 * "같은 상담이 화면마다 다른 칸"이 된다(옛 5칸 시절 `COLUMNS` 배열이 page.tsx 안에 있었다).
 *
 * 옛 5칸(대기·예약 / 상담 완료 / AI 분석 완료 / 상담 종료 / 반 배정 완료) → 새 4칸(원장 2026-09-01):
 *   상담 전 · 상담 완료 · 미등록 · 등록 완료.
 */

/** 칸 식별자. DB에 저장하지 않는다(화면 전용). */
export type BoardStageKey = "before" | "consulted" | "unregistered" | "enrolled";

/** 칸 헤더 색 — 의미색 캐논(진행 amber / 진행중 blue / 종료 neutral / 완료 green). 클래스는 소비처가 맵핑. */
export type BoardStageColor = "amber" | "blue" | "neutral" | "green";

export type BoardStage = {
  key: BoardStageKey;
  label: string;
  color: BoardStageColor;
  /** 이 칸에 묶이는 outcome 원값들. */
  outcomes: string[];
  /**
   * 드롭했을 때 쓸 **대표값**. 칸:outcome이 1:N이라 하나를 골라야 하는데, 원래 값이 이미 이 칸 안에
   * 있으면 그 값을 유지한다(`outcomeForDrop`) — 드래그 한 번에 'AI 완료'·'예약'·'노쇼'라는 사실이
   * 지워지면 안 된다.
   */
  dropOutcome: string;
};

export const BOARD_STAGES: BoardStage[] = [
  // 대기 + 예약. 접수만 됐고 아직 상담을 안 한 건.
  { key: "before", label: "상담 전", color: "amber", outcomes: ["pending", "scheduled"], dropOutcome: "pending" },
  // 상담 완료 + AI 분석 완료. 녹음이 끝나면 분석은 자동으로 이어지므로 두 단계를 한 칸으로 본다.
  { key: "consulted", label: "상담 완료", color: "blue", outcomes: ["consulted", "ai_done"], dropOutcome: "consulted" },
  // 거절 + 노쇼 = "상담은 끝났는데 등록하지 않은 건".
  { key: "unregistered", label: "미등록", color: "neutral", outcomes: ["declined", "no_show"], dropOutcome: "declined" },
  // 재원생 등록. 반 배정까지 끝난 건도 여기 서고 '반 배정 완료' 표식이 붙는다(cardMarkOf).
  { key: "enrolled", label: "등록 완료", color: "green", outcomes: ["enrolled"], dropOutcome: "enrolled" },
];

const STAGE_BY_OUTCOME = new Map<string, BoardStageKey>(
  BOARD_STAGES.flatMap((s) => s.outcomes.map((o) => [o, s.key] as const)),
);

/**
 * outcome 원값 → 칸. 🔴 모르는 값도 **반드시 어딘가에 선다**(카드가 조용히 사라지면 아무도 못 찾는다) —
 * enum 기본값과 같은 '상담 전'으로 떨어뜨린다.
 */
export function stageOfOutcome(outcome: string): BoardStageKey {
  return STAGE_BY_OUTCOME.get(outcome) ?? "before";
}

/** 상태 필터(툴바 드롭다운) 선택지 — 🔴 칸반과 **같은 4단계**여야 한다(원장 2026-09-01). */
export const BOARD_STAGE_OPTIONS: { value: BoardStageKey; label: string }[] = BOARD_STAGES.map(
  (s) => ({ value: s.key, label: s.label }),
);

/** 그 칸에 묶인 outcome 원값들 — 쿼리가 `.in("outcome", …)`으로 쓴다. */
export function outcomesOfStage(key: BoardStageKey): string[] {
  return BOARD_STAGES.find((s) => s.key === key)?.outcomes ?? [];
}

/**
 * URL의 `outcome` 파라미터 → 칸.
 *
 * ⚠️ 파라미터 **이름은 `outcome` 그대로**이고 값만 칸 키가 된다(원장 2026-09-01, 상태 드롭다운 4단계
 * 통일). 이름까지 바꾸면 '전체'가 옛 파라미터를 못 지워 필터가 유령처럼 남는다.
 * 🔑 **옛 링크(`?outcome=ai_done`)는 그 값이 속한 칸으로 넓혀 받는다** — 북마크가 조용히 '전체'로
 *    풀리거나 빈 화면이 되지 않게. 아는 값이 아니면 null(=전체)이다.
 */
export function parseBoardStage(v: string | null | undefined): BoardStageKey | null {
  if (!v) return null;
  if (BOARD_STAGES.some((s) => s.key === v)) return v as BoardStageKey;
  return STAGE_BY_OUTCOME.get(v) ?? null;
}

/** 칸 판정에 필요한 최소 재료(ConsultationListRow가 구조적으로 만족). */
export type StageInput = { outcome: string; assignedClassCount: number };

/**
 * 카드가 설 칸.
 *
 * 🔴 **반 배정(수강 ≥ 1)이 outcome을 이긴다** — 배정은 outcome이 아니라 연결 학생의 수강에서 나오는
 * 파생값이라, 옛 5칸에서도 그 카드는 자기 outcome 칸을 떠나 '반 배정 완료' 열에 섰다. 그 성질을
 * 그대로 옮긴 것이고, 그래서 배정된 카드는 드래그로 못 옮긴다(`dropBlockReason` — outcome만 바꿔도
 * 여기서 다시 '등록 완료'로 튕겨 돌아온다).
 */
export function stageOfCard(card: StageInput): BoardStageKey {
  if (card.assignedClassCount >= 1) return "enrolled";
  return stageOfOutcome(card.outcome);
}

/**
 * 드롭 대표값 — 그 칸으로 옮길 때 저장할 outcome.
 * 원래 값이 이미 그 칸 소속이면 **유지**(예약·AI 완료·노쇼가 드래그로 지워지지 않게), 아니면 대표값.
 */
export function outcomeForDrop(target: BoardStageKey, current: string): string {
  const stage = BOARD_STAGES.find((s) => s.key === target);
  if (!stage) return current;
  return stage.outcomes.includes(current) ? current : stage.dropOutcome;
}

/**
 * 카드에 붙는 표식 — **칸마다 최대 하나**(칸 이름이 이미 단계를 말하므로, 배지는 "그 칸 안에서 특별한
 * 것"만 말한다). 원장 2026-09-01 지시를 그대로 옮긴 규칙:
 *  · 상담 전 = QR 접수 건만 'QR 접수'(그 외엔 아무 라벨도 안 붙인다)
 *  · 상담 완료 = 녹음이 있으면 녹음 표식 **하나만**. 🔴 'AI 완료' 배지는 **없앴다**(원장 2026-09-01) —
 *    텍스트 분석 버튼을 없애 상담 분석 경로가 **녹음 하나**가 됐으므로, 마이크가 곧 "분석되는 건"이다
 *    (두 배지는 같은 사실을 두 번 말하게 된다). 되살리지 말 것.
 *  · 등록 완료 = 반 배정까지 끝난 건만 '반 배정 완료'
 *  · 미등록 = 없음
 */
export type CardMark = "assigned" | "qr" | "audio" | null;

/**
 * 표식 라벨 — outcome이 아니라 **파생 사실**이라 outcome-meta에 없다(그래서 여기, 규칙 옆에 둔다).
 */
export const ASSIGNED_LABEL = "반 배정 완료";
export const QR_INTAKE_LABEL = "QR 접수";

export type MarkInput = StageInput & {
  fromPublicIntake: boolean;
  hasAudio: boolean;
};

export function cardMarkOf(card: MarkInput, stage: BoardStageKey = stageOfCard(card)): CardMark {
  if (card.assignedClassCount >= 1) return "assigned";
  if (stage === "before") return card.fromPublicIntake ? "qr" : null;
  if (stage === "consulted") return card.hasAudio ? "audio" : null;
  return null;
}

/**
 * '등록 완료'(outcome=enrolled)를 이전 단계로 되돌리는 것을 막는 문구.
 * ⚠️ 문구는 **칸 이름**으로 말한다(2026-09-01) — 보드도 상세 '상태 변경'도 4단계라, 옛 outcome 라벨
 *    ('재원생 등록'·'거절')로 안내하면 화면에 없는 이름을 가리키게 된다.
 * ⚠️ [setEnrollmentOutcome](./server/actions.ts)이 **같은 상수**를 던진다 — 드롭(칸반)과 드롭다운
 * (상세 '상태 변경')이 같은 서버 액션을 타므로 안내도 한 문장이어야 한다(한쪽만 고치면 갈린다).
 */
export const ENROLLED_REVERT_BLOCKED =
  "이미 '등록 완료'로 처리된 상담은 '상담 전'·'상담 완료'로 되돌릴 수 없습니다. 취소하려면 '미등록'으로 옮기거나 학생을 퇴원 처리하세요.";

/** '반 배정 완료' 카드를 드래그로 못 옮기는 이유(화면에 그대로 띄운다 — 무반응은 고장으로 읽힌다). */
export const ASSIGNED_DRAG_BLOCKED =
  "'반 배정 완료'는 상담 상태가 아니라 학생의 수강(반) 기록에서 나옵니다 — 드래그로 상태만 바꾸면 카드가 이 칸으로 되돌아옵니다. 상세 화면의 '상태 변경'이나 수강 종료로 처리하세요.";

/**
 * 이 카드를 그 칸으로 **드롭할 수 없는 이유**(null이면 가능). 화면 조건은 게이트가 아니므로
 * 서버(setEnrollmentOutcome)가 같은 판정을 한 번 더 한다 — 여기는 헛수고와 오해를 줄이는 앞단.
 */
export function dropBlockReason(card: StageInput, target: BoardStageKey): string | null {
  if (card.assignedClassCount >= 1) return ASSIGNED_DRAG_BLOCKED;
  // 서버 규칙과 동일: 전환(enrolled)된 건은 '거절'(=미등록 칸) 또는 제자리만 허용.
  if (card.outcome === "enrolled" && target !== "enrolled" && target !== "unregistered") {
    return ENROLLED_REVERT_BLOCKED;
  }
  return null;
}
