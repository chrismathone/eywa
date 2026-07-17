/**
 * Phase 3 이벤트 감지 — 순수 함수만(서버·DB 무관, Vitest). bucket 계산·집계 메시지의 단일 소스.
 *
 * 설계(적대 리뷰 반영):
 * - 결석 = **마일스톤 tier**(3·5·10회) bucket. 3→4는 같은 tier라 재알림 없음, 5 도달 시에만 새 알림
 *   = 만성 결석 1명이 학기당 최대 3건(스팸 방지). tier는 절대 앵커일을 섞지 않는다(앵커가 매일 밀리면
 *   무한 재알림 부활 — 리뷰 지적). ⚠️ 한계: 3회 아래로 회복 후 재발하면 tier 3이 이미 기록돼 재알림 안 됨
 *   (edge를 count로만 근사 — v1 트레이드오프, body는 '현재 N회'로 서술).
 * - 후속조치 = (기한날짜:stage) bucket. stage = due(기한 당일) / overdue(지남 첫 감지). 기한 당일 1회 +
 *   지남 전환 1회 = 후속조치당 최대 2건, 매일 nag 안 함(v1). soon/later는 알림 대상 아님.
 */

/** 결석 마일스톤 tier(낮→높). 이 값 이상이면 그 tier 도달. */
export const ABSENCE_TIERS = [3, 5, 10] as const;

/** absences(현재 14일 결석 수) → 도달한 최고 마일스톤 tier. 미달이면 null. */
export function absenceTier(absences: number): number | null {
  let reached: number | null = null;
  for (const tier of ABSENCE_TIERS) {
    if (absences >= tier) reached = tier;
  }
  return reached;
}

export type AbsenceInput = { studentId: string; studentName: string; absences: number };
export type AbsenceEvent = {
  subjectKey: string; // studentId
  bucket: string; // tier 문자열 '3'|'5'|'10'
  studentName: string;
  absences: number;
  tier: number;
};

/** 결석 로스터 → 마일스톤 이벤트 후보(tier 도달자만). dedup은 호출부 upsert가 담당. */
export function buildAbsenceEvents(rows: readonly AbsenceInput[]): AbsenceEvent[] {
  const events: AbsenceEvent[] = [];
  for (const row of rows) {
    const tier = absenceTier(row.absences);
    if (tier === null) continue;
    events.push({
      subjectKey: row.studentId,
      bucket: String(tier),
      studentName: row.studentName,
      absences: row.absences,
      tier,
    });
  }
  return events;
}

export type FollowupStage = "due" | "overdue";
export type FollowupInput = {
  consultationId: string;
  studentName: string;
  followUpDate: string; // YYYY-MM-DD
  counselorId: string | null;
  urgency: string; // followUpUrgency 결과
};
export type FollowupEvent = {
  subjectKey: string; // consultationId
  bucket: string; // due=`${date}:due`(1회) / overdue=`${date}:overdue:${weekKey}`(주 1회 재알림)
  studentName: string;
  followUpDate: string;
  stage: FollowupStage;
  counselorId: string | null;
};

/**
 * KST 기준 이번 주 월요일(YYYY-MM-DD) — overdue 주간 재알림 bucket 성분.
 * 같은 주 내 어느 날 cron이 돌아도 동일 키 → 주 1회만, 다음 주 월요일부터 새 키 → 재알림.
 */
export function weekKey(todayKst: string): string {
  const ts = Date.parse(`${todayKst}T00:00:00Z`);
  const dow = new Date(ts).getUTCDay(); // 0=일 … 6=토
  const toMonday = dow === 0 ? -6 : 1 - dow;
  return new Date(ts + toMonday * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 후속조치 목록 → 알림 이벤트 후보(today=due / overdue=overdue만). soon/later/done/none 제외.
 * - due: bucket=`${followUpDate}:due` — 기한 당일 1회.
 * - overdue: bucket=`${followUpDate}:overdue:${weekKey}` — **미처리 방치 시 주 1회 재촉**(리뷰 지적:
 *   기한 지난 채 아무도 안 하면 다시는 안 울리던 갭 해소). 처리(follow_up_done)되면 후보에서 빠져 멈춘다.
 */
export function buildFollowupEvents(rows: readonly FollowupInput[], overdueWeekKey: string): FollowupEvent[] {
  const events: FollowupEvent[] = [];
  for (const row of rows) {
    const stage: FollowupStage | null =
      row.urgency === "today" ? "due" : row.urgency === "overdue" ? "overdue" : null;
    if (stage === null) continue;
    events.push({
      subjectKey: row.consultationId,
      bucket: stage === "overdue" ? `${row.followUpDate}:overdue:${overdueWeekKey}` : `${row.followUpDate}:due`,
      studentName: row.studentName,
      followUpDate: row.followUpDate,
      stage,
      counselorId: row.counselorId,
    });
  }
  return events;
}

/** "김보민 외 2명" — 결석 집계 알림 본문용 이름 요약. */
export function summarizeNames(names: readonly string[], max = 3): string {
  const head = names.slice(0, max).join("·");
  return names.length > max ? `${head} 외 ${names.length - max}명` : head;
}

/** 결석 이벤트 신규분 → master용 집계 알림 1건 본문(없으면 null). */
export function absenceDigestBody(events: readonly AbsenceEvent[]): string | null {
  if (events.length === 0) return null;
  const names = summarizeNames(events.map((event) => event.studentName));
  const topTier = Math.max(...events.map((event) => event.tier));
  return events.length === 1
    ? `${events[0].studentName} 학생이 최근 14일 ${events[0].absences}회 결석으로 반복 결석 위험입니다.`
    : `${names}이 반복 결석 위험 단계(최근 14일 ${topTier}회 이상)에 도달했습니다.`;
}

/**
 * 이벤트를 **담당 강사별**로 그룹핑(subjectKey=학생id 전제). studentTeachers = 학생id→담당 강사id 목록.
 * 한 학생이 여러 반이면 각 담당 강사에게, 강사는 자기 학생 이벤트만 받는다(스코프 격리).
 * ⚠️ studentTeachers는 호출부가 tenant 필터·활성 강사만 남긴 것이어야 한다(admin RLS 우회 방어).
 */
export function groupEventsByTeacher<E extends { subjectKey: string }>(
  events: readonly E[],
  studentTeachers: ReadonlyMap<string, readonly string[]>,
): Map<string, E[]> {
  const byTeacher = new Map<string, E[]>();
  for (const event of events) {
    for (const teacherId of studentTeachers.get(event.subjectKey) ?? []) {
      const list = byTeacher.get(teacherId) ?? [];
      list.push(event);
      byTeacher.set(teacherId, list);
    }
  }
  return byTeacher;
}

/** 후속조치 이벤트 → 개별 알림 본문(stage별 문구 분기 — 아침 cron엔 due가 아직 안 지남). */
export function followupBody(event: FollowupEvent): string {
  return event.stage === "due"
    ? `${event.studentName} 학생 상담 후속조치가 오늘(${event.followUpDate}) 마감 예정입니다.`
    : `${event.studentName} 학생 상담 후속조치가 기한(${event.followUpDate})을 지났습니다.`;
}

// ─────────── 성적 급락 이벤트 ───────────
// retention risk.ts와 동일 임계(≥15점 하락 = 심각). **같은 과목 내** 최신 vs 직전 점수(%) 비교.
// (retention roster는 과목을 섞어 비교하는 한계가 있으나, 이벤트는 과목별로 정확히 판정한다.)
// ⚠️ injaewon은 현재 성적 0건 — 학원이 성적 입력 시작 전까지 이 이벤트는 발화하지 않는다(거짓 알림 0).

/** 성적 급락 판정 임계(점, %p). retention의 심각 tier(+30) 재사용 — 이벤트는 저빈도를 위해 이 값만. */
export const GRADE_DROP_MIN = 15;

export type GradeRow = {
  studentId: string;
  studentName: string;
  subject: string;
  subjectLabel: string; // 한글 라벨(서버에서 buildSubjectMaps 경유 — raw 키 노출 금지)
  gradeId: string;
  takenOn: string; // YYYY-MM-DD
  pct: number | null; // score/max*100. null=계산 불가(제외)
};
export type GradeDropEvent = {
  subjectKey: string; // studentId
  bucket: string; // `${subject}:${latestGradeId}` — 새 점수가 들어올 때만 새 bucket(1회 알림)
  studentName: string;
  subjectLabel: string;
  drop: number; // 하락폭(점)
  latestPct: number;
};

/**
 * 성적 급락 이벤트 후보 — (학생, 과목)별 최신 vs 직전 점수(%) 비교, 하락 ≥ minDrop만.
 * bucket에 최신 gradeId를 넣어 "새 점수가 들어와 급락했을 때 1회"만 알린다(dedup은 호출부).
 */
export function buildGradeDropEvents(rows: readonly GradeRow[], minDrop = GRADE_DROP_MIN): GradeDropEvent[] {
  const byStudentSubject = new Map<string, GradeRow[]>();
  for (const row of rows) {
    if (row.pct === null) continue;
    const key = `${row.studentId}::${row.subject}`;
    (byStudentSubject.get(key) ?? byStudentSubject.set(key, []).get(key)!).push(row);
  }
  const events: GradeDropEvent[] = [];
  for (const group of byStudentSubject.values()) {
    if (group.length < 2) continue; // 직전 점수 없으면 비교 불가
    // 최신순 정렬(takenOn desc, 동일자면 gradeId로 안정). [0]=최신, [1]=직전.
    const sorted = [...group].sort((a, b) =>
      a.takenOn === b.takenOn ? (a.gradeId < b.gradeId ? 1 : -1) : a.takenOn < b.takenOn ? 1 : -1,
    );
    const latest = sorted[0];
    const prev = sorted[1];
    const drop = Math.round((prev.pct as number) - (latest.pct as number));
    if (drop < minDrop) continue;
    events.push({
      subjectKey: latest.studentId,
      bucket: `${latest.subject}:${latest.gradeId}`,
      studentName: latest.studentName,
      subjectLabel: latest.subjectLabel,
      drop,
      latestPct: Math.round(latest.pct as number),
    });
  }
  return events;
}

// ─────────── 미수 임계 이벤트 ───────────
// 학생별 총 미수(unpaid/partial 합)가 금액 tier를 넘으면 1회 알림. 결석과 동일 마일스톤 방식이라
// 지불로 줄었다가 다시 오르면 상위 tier에서만 재알림(스팸 방지). tier는 원(₩) 고정값(학원별 등록금
// 차이로 의미가 다를 수 있어 향후 tenant_settings화 여지 — v1은 고정).

/** 미수 금액 마일스톤(원). ~1개월/1.5~2개월/3개월+ 감각. */
export const OUTSTANDING_TIERS = [300_000, 500_000, 1_000_000] as const;

/** 미수 금액 → 도달한 최고 tier(원). 미달이면 null. */
export function outstandingTier(amount: number): number | null {
  let reached: number | null = null;
  for (const tier of OUTSTANDING_TIERS) {
    if (amount >= tier) reached = tier;
  }
  return reached;
}

export type OutstandingInput = { studentId: string; studentName: string; amount: number };
export type OutstandingEvent = {
  subjectKey: string; // studentId
  bucket: string; // tier 문자열 '300000'|'500000'|'1000000'
  studentName: string;
  amount: number;
  tier: number;
};

/** 미수 명단 → 마일스톤 이벤트 후보(tier 도달자만). dedup은 호출부 upsert. */
export function buildOutstandingEvents(rows: readonly OutstandingInput[]): OutstandingEvent[] {
  const events: OutstandingEvent[] = [];
  for (const row of rows) {
    const tier = outstandingTier(row.amount);
    if (tier === null) continue;
    events.push({ subjectKey: row.studentId, bucket: String(tier), studentName: row.studentName, amount: row.amount, tier });
  }
  return events;
}

/** 원 → "62만원" 압축(만원 단위, 만원 미만은 원). 알림 본문용. */
function manwon(amount: number): string {
  if (amount >= 10_000) {
    const man = Math.floor(amount / 10_000);
    const rest = amount % 10_000;
    return rest === 0 ? `${man}만원` : `${man}만 ${rest.toLocaleString("en-US")}원`;
  }
  return `${amount.toLocaleString("en-US")}원`;
}

/** 미수 이벤트 → 집계 알림 본문(없으면 null). */
export function outstandingDigestBody(events: readonly OutstandingEvent[]): string | null {
  if (events.length === 0) return null;
  if (events.length === 1) {
    return `${events[0].studentName} 학생의 미수금이 ${manwon(events[0].amount)}에 이릅니다.`;
  }
  const names = summarizeNames(events.map((event) => event.studentName));
  const topTier = Math.max(...events.map((event) => event.tier));
  return `${names}의 미수금이 ${manwon(topTier)} 이상입니다.`;
}

// ─────────── 정리(prune) 정책 ───────────
// dedup 이벤트·읽은 알림의 보존 기간. 순수 컷오프 계산(Vitest) — 실 삭제는 server/prune.ts.
export const NOTIFICATION_EVENTS_RETENTION_DAYS = 180;
export const READ_NOTIFICATIONS_RETENTION_DAYS = 90;

/** now(ms) → 삭제 컷오프 ISO 2종. 이 시각보다 오래된 행을 삭제한다. */
export function pruneCutoffs(nowMs: number): { eventsBefore: string; readNotificationsBefore: string } {
  const DAY_MS = 86_400_000;
  return {
    eventsBefore: new Date(nowMs - NOTIFICATION_EVENTS_RETENTION_DAYS * DAY_MS).toISOString(),
    readNotificationsBefore: new Date(nowMs - READ_NOTIFICATIONS_RETENTION_DAYS * DAY_MS).toISOString(),
  };
}

/** 성적 급락 개별/집계 본문. 한 명이면 과목·하락폭, 여러 명이면 이름 집계. */
export function gradeDropDigestBody(events: readonly GradeDropEvent[]): string | null {
  if (events.length === 0) return null;
  if (events.length === 1) {
    const event = events[0];
    return `${event.studentName} 학생 ${event.subjectLabel} 성적이 ${event.drop}점 하락했습니다(현재 ${event.latestPct}점).`;
  }
  return `${summarizeNames(events.map((event) => event.studentName))} 학생의 성적이 크게 하락했습니다(${GRADE_DROP_MIN}점 이상).`;
}
