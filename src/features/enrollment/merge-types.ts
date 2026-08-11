// 등록상담 병합 — **타입과 결과 모양**만. 값 판단은 merge-decide.ts, 조립은 merge-plan.ts.
// (한 파일 200줄 규칙: 병합 로직이 커져 policy/types/values/decide/plan 다섯으로 나눴다.)
export type ConsultRow = Record<string, unknown> & { id: string };

/** 자식 데이터 보유(승자 선택 근거 + 이관 대상). */
export type ChildCounts = { ai: number; rec: number; push: number };

export type FieldStatus =
  | "same" // 값이 같거나 승자에만 있다 — 결정할 게 없다
  | "filled" // 승자가 비어 패자 값으로 채운다(무손실)
  | "resolved" // 규칙이 자동 결정했다(가장 이른 시각·더 나아간 상태·동의 OR 등)
  | "conflict" // 양쪽 다 값이 있고 다르다 — **사람이 고른다**
  | "appended"; // 자유 서술 — 이어붙여 둘 다 보존

export type FieldDecision = {
  /** scalar/append는 컬럼명, atomic은 세트명. */
  key: string;
  kind: "scalar" | "append" | "atomic" | "key";
  status: FieldStatus;
  /** 계획이 제안하는 값(atomic/key는 채택한 행의 id). conflict면 승자 값을 제안하되 needsHuman=true. */
  proposed: unknown;
  /** 이 결정으로 버려지는 값 — 전부 감사로그에 보존한다. */
  discarded: unknown[];
  /** 왜 자동으로 정했는지(사람이 검수할 때 읽는 한 줄). */
  reason?: string;
  needsHuman: boolean;
  /**
   * 사람이 고를 항목의 **선택지**(행 id + 그 행의 값 미리보기).
   * 🔴 이게 없으면 화면이 "학부모 연락처를 고르세요"라고만 하고 **무엇과 무엇 중에 고르는지를 못 보여준다**
   *    — 날짜만 보고 전화번호를 고르라는 화면이 된다. 계획이 판단 근거까지 실어 나른다.
   */
  options?: { rowId: string; preview: string }[];
};


export type MergePlan = {
  winnerId: string;
  loserIds: string[];
  decisions: FieldDecision[];
  /** 병합을 막는 사유 — 하나라도 있으면 실행 불가(별건이거나 위험). */
  blockers: string[];
  /** 실행은 되지만 사람이 알아야 하는 것. */
  warnings: string[];
  /** 사람이 골라야 하는 항목 수. 0이면 확인만 하고 누르면 된다. */
  conflictCount: number;
  /** **사람이 고른 뒤 실제로 버려지는** 값의 개수(conflict 항목만). 0이면 화면상 무손실. */
  lossCount: number;
  /** 규칙이 흡수한 값 — 같은 사건의 그림자(늦은 시각·덜 진행된 상태·판독 불가 전화). 손실이 아니다. */
  shadowCount: number;
  /** 기술 키 중 버려지는 개수 — 화면 손실은 아니지만 부활 위험 계상. */
  keyLossCount: number;
};

export type PlanOptions = {
  /** 상담 메모 등 자유 서술을 이어붙일지. false면 승자 것만 남고 나머지는 손실로 계상. */
  appendFreeText?: boolean;
  /** 며칠 이내여야 "같은 상담"으로 볼지. 초과하면 별건(blocker). 기본 7일. */
  maxDayGap?: number;
  /** 자식 데이터(그룹 내 id → 개수). 승자 선택과 경고에 쓴다. */
  children?: Record<string, ChildCounts>;
  /**
   * 남길 상담을 사람이 직접 고른 경우 그 id. 지정하면 자동 선택을 건너뛴다.
   * 🔴 승자가 바뀌면 **모든 결정이 달라진다**(채움/충돌 방향이 뒤집힌다) → 계획을 통째로 다시 만들어야 하고,
   *    그래서 승자는 계획 밖에서 갈아끼울 수 없다. 없는 id면 자동 선택으로 돌아간다(입력을 믿지 않는다).
   */
  forceWinnerId?: string;
};

export type WinnerStrategy = "latest" | "richest" | "outcome" | "composite";
