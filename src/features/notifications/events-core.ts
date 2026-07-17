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
  bucket: string; // `${followUpDate}:${stage}`
  studentName: string;
  followUpDate: string;
  stage: FollowupStage;
  counselorId: string | null;
};

/** 후속조치 목록 → 알림 이벤트 후보(today=due / overdue=overdue만). soon/later/done/none 제외. */
export function buildFollowupEvents(rows: readonly FollowupInput[]): FollowupEvent[] {
  const events: FollowupEvent[] = [];
  for (const row of rows) {
    const stage: FollowupStage | null =
      row.urgency === "today" ? "due" : row.urgency === "overdue" ? "overdue" : null;
    if (stage === null) continue;
    events.push({
      subjectKey: row.consultationId,
      bucket: `${row.followUpDate}:${stage}`,
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
 * 결석 이벤트를 **담당 강사별**로 그룹핑(v2). studentTeachers = 학생id→담당 강사id 목록.
 * 한 학생이 여러 반이면 각 담당 강사에게, 강사는 자기 학생 이벤트만 받는다(스코프 격리).
 * ⚠️ studentTeachers는 호출부가 tenant 필터·활성 강사만 남긴 것이어야 한다(admin RLS 우회 방어).
 */
export function groupAbsenceEventsByTeacher(
  events: readonly AbsenceEvent[],
  studentTeachers: ReadonlyMap<string, readonly string[]>,
): Map<string, AbsenceEvent[]> {
  const byTeacher = new Map<string, AbsenceEvent[]>();
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
