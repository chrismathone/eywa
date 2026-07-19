/**
 * 원스크린 로스터 신호(배지) 판정 — 순수 함수(Vitest).
 * G3 "안 읽은 학부모" + G2 "진도 이상"을 로스터 데이터에서 배지로 파생한다.
 * 규칙이 데이터 실측(2026-07-19)에 근거하므로 바꿀 땐 근거를 함께 갱신할 것.
 */

/** 학생별 학부모 읽음 통계 — 0124a `onescreen_parent_read_stats` RPC 반환 행. */
export type ParentReadStats = {
  /** 최근 5건 중 추적 가능(edutrix_share_token 또는 classnote_sent_at 존재) 행 수 */
  trackableCount: number;
  /** 그중 report_date 4일+ 경과했는데 미읽음 — 갓 보낸 건 제외(읽힘은 실측 3일 내 93%) */
  agedUnreadCount: number;
  /** 그중 읽음 */
  readCount: number;
  /** 이 학생 보고서의 마지막 읽음 시각(전무면 null) */
  lastReadAt: string | null;
};

/**
 * G3 배지: "학부모 미확인 N회" — **읽음 추적이 실증된 학생**(읽음 기록 1회+ 존재)의 최근 추적 가능
 * 보고서가 3건+ 쌓였는데 읽음 0 + 그중 3건+이 나흘 넘게 미읽음일 때만.
 * ⚠️ lastReadAt 실증 조건이 핵심(2026-07-19 실측): 읽음 파이프라인이 갓 켜져(0122a, 폴러 zip 대기)
 * read_at이 희소한 시점에 이 조건 없이는 **155명 오탐 배지 폭탄** — "학부모가 안 읽음"과 "파이프라인이
 * 아직 이 학생을 추적 못 함"을 구분할 수 없다. 조건 추가 시 현재 0명(무오탐), 폴러 가동 후 "읽다가 끊긴"
 * 학부모만 자연 부상. 한 번도 안 읽는 학부모는 v1에선 못 잡음 — 폴러 2~3주 가동 후 이 조건 완화 재검토(백로그).
 * ⚠️ 카피 규칙: "안 읽음" 단정 금지 — 읽음 신호 커버리지가 75%라(ClassNote 밖 열람 등) "미확인"으로 표기.
 * 추적 불가 학생(토큰 없음 = 읽음 신호 원천 부재)은 stats 자체가 0이라 자연 침묵(별도 '확인 불가' 배지는 소음).
 */
export function parentUnreadBadge(stats: ParentReadStats | undefined): { count: number } | null {
  if (!stats) return null;
  if (stats.lastReadAt === null) return null; // 추적 실증 없음 — 파이프라인 공백과 구분 불가(오탐 방지)
  if (stats.trackableCount < 3) return null; // 표본 부족 — 판단 보류
  if (stats.readCount > 0) return null; // 최근 안에 읽음 있음 — 정상
  if (stats.agedUnreadCount < 3) return null; // 확정 미확인이 3건 미만 — 아직 이르다
  return { count: stats.agedUnreadCount };
}

/** 학생별 진도 이상 신호 — roster가 progress_events에서 집계(수학 전용 파이프라인). */
export type ProgressSignal = {
  /** 최근 14일 jump_error/overlap_error 이벤트 수 */
  anomalyCount: number;
};

/**
 * G2 배지: "진도 확인 필요" — 최근 14일 이상(오류) 이벤트가 있을 때만.
 * ⚠️ regression(진도 되돌아감)은 **의도적으로 제외** — 실측(2026-07-19) 최근 14일 80건/학생 50명으로
 * 복습 재기록이 대부분(배지 폭탄 = 소음). 오류 2종(jump/overlap)은 같은 기간 한 자릿수(고신호).
 * 재포함하려면 "연속 2회+ regression" 같은 노이즈 필터를 함께 설계할 것.
 * ⚠️ errored 컨테이너 조건도 **의도적으로 제외**(적대 리뷰 확정) — errored는 해제 경로가 없는 종결
 * 기록(묘비: ingest가 점프 감지 시 닫고 즉시 새 active를 연다)이라 조건에 넣으면 과거 한 번이라도
 * 점프했던 학생 전원이 영구 배지 = 신호 붕괴. 모든 점프/겹침이 이벤트를 남기므로 14일 이벤트 창이
 * 같은 신호의 자연 소멸판. errored를 재도입하려면 archived_at 최근성 bound + 해제 UI를 함께 설계할 것.
 * 수학 전용 데이터(ingest.ts math 필터)라 소비처는 math 행에만 배지를 단다(영어 행 부재 = 정상).
 */
export function progressAnomalyBadge(signal: ProgressSignal | undefined): boolean {
  if (!signal) return false;
  return signal.anomalyCount > 0;
}
