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

import { monthDayLabel } from "@/lib/date-kst";
import { classnoteSendWindowLabel } from "@/features/onescreen/classnote-guard";
import { REPEATED_ABSENCES_LINK } from "./presentation";

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

/**
 * 결석 이벤트 신규분 → master용 집계 알림 1건 본문(없으면 null).
 * ⚠️ outstandingDigestBody와 같은 규칙 — **최고 tier를 전원에게 붙이지 않는다**(하한을 말한다).
 */
export function absenceDigestBody(events: readonly AbsenceEvent[]): string | null {
  if (events.length === 0) return null;
  if (events.length === 1) {
    return `${events[0].studentName} 학생 · 최근 14일 결석 ${events[0].absences}회. 출결을 확인해 주세요.`;
  }
  const names = summarizeNames(events.map((event) => event.studentName));
  const tiers = events.map((event) => event.tier);
  const baseTier = Math.min(...tiers);
  const topTier = Math.max(...tiers);
  const base = `${names} 학생 ${events.length}명 · 최근 14일 결석 ${baseTier}회 이상.`;
  if (topTier === baseTier) return base;
  const topCount = tiers.filter((tier) => tier === topTier).length;
  return `${base} (${topTier}회 이상 ${topCount}명)`;
}

/** 한 명은 학생 출결, 여러 명은 현재 반복 결석 명단으로 연결한다. */
export function absenceNotificationLink(events: readonly AbsenceEvent[]): string {
  return events.length === 1
    ? `/students/${events[0].subjectKey}?tab=attendance`
    : REPEATED_ABSENCES_LINK;
}

/**
 * 이벤트를 **담당 강사별**로 그룹핑(subjectKey=학생id 전제). studentTeachers = 학생id→담당 강사id 목록.
 * 한 학생이 여러 반이면 각 담당 강사에게, 강사는 자기 학생 이벤트만 받는다(스코프 격리).
 * ⚠️ studentTeachers는 호출부가 tenant 필터·활성 강사만 남긴 것이어야 한다(admin RLS 우회 방어).
 */
export function groupEventsByTeacher<E extends { subjectKey: string }>(
  events: readonly E[],
  studentTeachers: ReadonlyMap<string, readonly string[]>,
  /**
   * 이벤트에서 학생 id를 뽑는 함수. 기본은 subjectKey(결석·성적 = 학생 단위 dedup).
   * ⚠️ 미발송 보고서처럼 subjectKey가 학생이 아닌 이벤트(=보고서 id)는 반드시 이 추출자를 넘길 것 —
   * 안 넘기면 map이 무매치라 담당 강사에게 조용히 0건 발송된다.
   */
  studentIdOf: (event: E) => string = (event) => event.subjectKey,
): Map<string, E[]> {
  const byTeacher = new Map<string, E[]>();
  for (const event of events) {
    for (const teacherId of studentTeachers.get(studentIdOf(event)) ?? []) {
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

// ─────────── 신규 콜&상담 후속 조치(원장 2026-10-22 *"후속조치일 다와가면 알람 기능"*) ───────────
// '다음 상담'으로 잡은 날 — 하루 전 · 당일 · 지나면(주 1회 재촉). 등록·미등록으로 정하거나 날짜를 옮기면 감지 쿼리에서 빠져 멈춘다.

/**
 * 콜드스타트(그 지점에 이 종류 알림 기록이 0건 — 첫 실행)에 첫 감지분을 **보내지 않고 시드로만 남기는가**(벨 폭탄 방지, 0108a).
 * 🔴 신규 콜&상담 후속 조치는 아니다(2026-10-23 Codex 검토): 빈 실행은 기록을 안 남겨 콜드스타트가 **첫 후보까지** 이어지므로,
 *    그 지점의 **첫 실제 다음 상담 알림이 조용히 빠진다**. 이 종류는 감지 범위가 이미 좁아(도입일 `FOLLOW_UP_ALERT_START` 이후 ·
 *    내일까지 · 아직 정하지 않은 상담) 첫 실행에도 옛 건이 쏟아지지 않는다. 다른 종류는 종전 그대로 시드한다.
 */
export function seedsOnColdStart(eventType: string): boolean {
  return eventType !== "enrollment_followup";
}

export type EnrollmentFollowupStage = "soon" | "due" | "overdue";
export type EnrollmentFollowupInput = {
  consultationId: string;
  prospectName: string;
  followUpDate: string; // YYYY-MM-DD
  consultantId: string | null;
  content: string | null;
};
export type EnrollmentFollowupEvent = {
  subjectKey: string; // consultationId
  bucket: string; // soon=`${date}:soon` · due=`${date}:due` · overdue=`${date}:overdue:${weekKey}`
  prospectName: string;
  followUpDate: string;
  stage: EnrollmentFollowupStage;
  consultantId: string | null;
  content: string | null;
};

/** 후속 조치일 목록 → 알림 후보(내일 = soon · 오늘 = due · 지남 = overdue · 그 뒤는 아직). 날짜를 옮기면 bucket이 바뀌어 새로 울린다. */
export function buildEnrollmentFollowupEvents(
  rows: readonly EnrollmentFollowupInput[],
  todayKst: string,
  overdueWeekKey: string,
): EnrollmentFollowupEvent[] {
  const tomorrow = new Date(Date.parse(`${todayKst}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const events: EnrollmentFollowupEvent[] = [];
  for (const row of rows) {
    const date = row.followUpDate;
    const stage: EnrollmentFollowupStage | null =
      date === tomorrow ? "soon" : date === todayKst ? "due" : date < todayKst ? "overdue" : null;
    if (stage === null) continue;
    events.push({
      subjectKey: row.consultationId,
      bucket: stage === "overdue" ? `${date}:overdue:${overdueWeekKey}` : `${date}:${stage}`,
      prospectName: row.prospectName,
      followUpDate: date,
      stage,
      consultantId: row.consultantId,
      content: row.content,
    });
  }
  return events;
}

export function enrollmentFollowupTitle(stage: EnrollmentFollowupStage): string {
  return stage === "soon" ? "내일 콜&상담 후속 조치" : stage === "due" ? "오늘 콜&상담 후속 조치" : "기한 지난 콜&상담 후속 조치";
}

/** 본문 — 날짜는 '10월 25일'(원문 YYYY-MM-DD를 그대로 내보내지 않는다) · 메모는 앞 40자. */
export function enrollmentFollowupBody(event: EnrollmentFollowupEvent): string {
  const md = `${Number(event.followUpDate.slice(5, 7))}월 ${Number(event.followUpDate.slice(8, 10))}일`;
  const memo = event.content?.trim() ? ` · 메모: ${event.content.trim().slice(0, 40)}${event.content.trim().length > 40 ? "…" : ""}` : "";
  if (event.stage === "overdue") return `${event.prospectName} 다음 상담일(${md})이 지났습니다 — 등록·미등록을 정하거나 날짜를 옮겨 주세요${memo}`;
  return `${event.prospectName} 다음 상담이 ${event.stage === "soon" ? "내일" : "오늘"}(${md})입니다${memo}`;
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

/**
 * 미수 이벤트 → 집계 알림 본문(없으면 null).
 *
 * ⚠️ **최고 tier를 명단 전원에게 붙이지 않는다.** 예전엔 `Math.max(tier)`를 뽑아
 * "{이름들}의 미수금이 {최고tier} 이상입니다"라고 썼는데, 2026-07-20에 실제로
 * "권하윤·장윤진·허다빈 외 256명의 미수금이 100만원 이상입니다"가 발송됐고 259명 중 244명(94%)은
 * 100만원 미만이었다. 전원에게 **참인** 문장만 쓴다 = 최저 tier를 하한으로 말하고, 상위 구간은 건수로 덧붙인다.
 */
export function outstandingDigestBody(events: readonly OutstandingEvent[]): string | null {
  if (events.length === 0) return null;
  if (events.length === 1) {
    return `${events[0].studentName} 학생의 미수금이 ${manwon(events[0].amount)}에 이릅니다.`;
  }
  const names = summarizeNames(events.map((event) => event.studentName));
  const tiers = events.map((event) => event.tier);
  const baseTier = Math.min(...tiers); // 전원에게 참인 하한
  const topTier = Math.max(...tiers);
  const base = `${names} ${events.length}명의 미수금이 ${manwon(baseTier)} 이상입니다.`;
  if (topTier === baseTier) return base;
  const topCount = tiers.filter((tier) => tier === topTier).length;
  return `${base} (${manwon(topTier)} 이상 ${topCount}명)`;
}

// ─────────── 정리(prune) 정책 ───────────
// dedup 이벤트·읽은 알림의 보존 기간. 순수 컷오프 계산(Vitest) — 실 삭제는 server/prune.ts.
export const NOTIFICATION_EVENTS_RETENTION_DAYS = 180;
export const READ_NOTIFICATIONS_RETENTION_DAYS = 90;
/**
 * 안 읽은 채 이 일수를 넘긴 알림은 보관함으로(지우지 않는다 — 0447a `archive_stale_notifications`, 원장 2026-10-23 *"고쳐"*: 안 읽은 알림이 영구
 * 보존이라 85%가 안 읽은 채 쌓여 벨 숫자가 수천이었다). 열린 할 일이 붙은 알림은 그대로. 보관함에서 다시 꺼낼 수 있다.
 */
export const UNREAD_NOTIFICATIONS_ARCHIVE_DAYS = 30;

/** now(ms) → 삭제 컷오프 ISO 2종. 이 시각보다 오래된 행을 삭제한다. */
export function pruneCutoffs(nowMs: number): { eventsBefore: string; readNotificationsBefore: string } {
  const DAY_MS = 86_400_000;
  return {
    eventsBefore: new Date(nowMs - NOTIFICATION_EVENTS_RETENTION_DAYS * DAY_MS).toISOString(),
    readNotificationsBefore: new Date(nowMs - READ_NOTIFICATIONS_RETENTION_DAYS * DAY_MS).toISOString(),
  };
}

// ─────────── 미발송 보고서 이벤트 ───────────
// "강사가 저장만 하고 발송을 안 누른 수업 보고서"(classnote_status IS NULL). 발송 가능 여부 판정은
// **발송 콘솔과 같은 게이트**(isClassnoteAllowed too_old · isClassnoteSubjectEnabled 과목 opt-in ·
// classnoteSendEnabled 스위치 · edutrix_import 제외 · revoked 제외)를 호출부가 통과시킨 행만 넘긴다 —
// 게이트를 따로 구현하면 "보낼 수 없는 보고서"를 재촉하는 거짓 알림이 된다(#77 공용 게이트 정신).
// ⚠️ '학부모 미확인(읽음)' 이벤트를 여기 만들지 않은 이유: aywa DB의 share_link_views가 발송분의 1.5%만
// 잡아(실측) 그것만으론 98%가 거짓 '미확인'이 된다. **단 2026-07-18 조사로 ClassNote 피드가 읽음을
// 노출함이 확인됐다**(read_by_parent.date_read) — 동기화(2~4단계)가 끝나면 정확한 이벤트가 가능하다.
// 설계·주의사항: docs/classnote-read-sync-plan.md.

/** 미발송 재촉 창(일). 이보다 오래된 건 재촉하지 않는다(무한 잔소리 방지 — too_old가 최종 방어). */
export const UNSENT_REPORT_WINDOW_DAYS = 7;

/**
 * '깜빡한 보고서' 강사 알림 최대 횟수 — 원장 2026-11-05 *"앞으로 작성하고 미발송된 '깜빡한 보고서'가 있으면 최대 3일간
 * 선생님에게 알려줄것."* 보고서마다 **하루 한 번, 처음 잡힌 날을 포함해 최대 3번**.
 * 🔴 횟수는 날짜 계산이 아니라 **지난 알림 기록**(`notification_events`의 강사 몫)으로 센다 — 작성일로 세면 4일째부터
 *    보낼 수 있게 된 건(멘트를 늦게 채움·결석 정정)은 0번, 미리 쓴 건은 2번만 울렸다(적대 리뷰 2026-11-05 I1).
 * 작성 당일(작성일 = 오늘)은 울리지 않는다(아직 발송 중일 수 있다). 발송·취소·기한 경과는 게이트가 후보에서 빼므로 그대로 멈춘다.
 */
export const UNSENT_TEACHER_ALERTS_MAX = 3;

/**
 * 원장 1회분 bucket — 받을 직원이 없는 보고서를 원장에게 **한 번만**(하루씩 반복하지 않는다).
 * ⚠️ 2026-11-05 이전에는 강사 1회분도 이 이름이었다 — 그래서 강사 횟수를 셀 때 이 기록도 한 번으로 센다.
 */
export const UNSENT_ONCE_BUCKET = "unsent";

export type UnsentReportInput = {
  reportId: string;
  studentId: string;
  studentName: string;
  subjectLabel: string; // 한글 라벨(raw 과목 키 노출 금지)
  reportDate: string; // YYYY-MM-DD
  /** 작성일 = `lesson_reports.created_at`의 **KST** 날짜(YYYY-MM-DD). 오늘 저장분은 그날 강사에게 울리지 않는다 · 본문 'M/D 저장'. */
  createdDate?: string | null;
  /** 발송 마지막 날(YYYY-MM-DD) — 호출부가 `classnoteRetryDeadline().lastDate`로 넘긴다(7일 규칙을 여기서 다시 세지 않는다). */
  sendDeadline?: string | null;
};

/** 받는 사람 판정 재료(`unsentRecipientOf`). */
export type UnsentRouting = {
  /** 이 보고서를 처음 저장한 계정(`lesson_reports.created_by` — 갱신에도 보존된다(0172a 트리거) · 관리자 직접 작성은 비어 있다(채우지 않는다 — `unsentRecipientOf`)). */
  createdBy: string | null;
  /** 받는 사람 판정용 반 — 정규 = `class_id` · 보강 = `makeup_class_id`(앵커). 게이트의 반 판정(`classId`)과 별개다. */
  anchorClassId: string | null;
};

export type UnsentReportEvent = {
  /** dedup 주체 = 보고서 id(학생이 아님). */
  subjectKey: string;
  /**
   * 같은 event_type `unsent_report`에 bucket 두 가지:
   * - `"unsent"`(`UNSENT_ONCE_BUCKET`) = **원장 1회분** — 받을 직원이 없는 보고서, 보고서당 한 번.
   * - `remind:{KST 오늘}` = **직원(작성자·반 담임) 몫** — 날짜가 키라 같은 날 cron이 여러 번 돌아도 한 번,
   *   보고서당 최대 `UNSENT_TEACHER_ALERTS_MAX`번(`planUnsentAlerts`).
   * ⚠️ 공유링크 재발급·첨부 변경은 `classnote_status`를 null로 되돌린다(onescreen `reissueShareLink`·`attachment-actions`
   * CLASSNOTE_RESET — `classnote_sent_at`까지 지워 이미 나갔었는지 행으로는 모른다). 그래서 직원 본문은 '지금 미발송 상태'라고만
   * 쓴다('저장만 되고'라고 단정하지 않는다). 원장 1회분은 고정 bucket이라 그런 건을 다시 알리지 않는다(종전 그대로).
   */
  bucket: string;
  studentId: string;
  studentName: string;
  subjectLabel: string;
  reportDate: string;
  /** 직원 몫만 — 받는 사람(작성자 또는 반 담임). 원장 1회분엔 없다. */
  recipientId?: string;
  /** 직원 몫만 — 작성일(KST · 본문 'M/D 저장'). */
  createdDate?: string | null;
  /** 직원 몫만 — 발송 마지막 날(YYYY-MM-DD). */
  sendDeadline?: string | null;
};

/** 오래된 것 먼저(먼저 챙길 것) — 같은 날은 보고서 id로 안정 정렬. */
function oldestUnsentFirst(a: UnsentReportInput, b: UnsentReportInput): number {
  return a.reportDate.localeCompare(b.reportDate) || a.reportId.localeCompare(b.reportId);
}

/** 미발송 후보 행 → 이벤트(보고서당 1건). 날짜 오름차순(오래된 것 먼저 = 먼저 챙길 것). */
export function buildUnsentReportEvents(rows: readonly UnsentReportInput[]): UnsentReportEvent[] {
  return [...rows]
    .sort(oldestUnsentFirst)
    .map((row) => ({
      subjectKey: row.reportId,
      bucket: "unsent",
      studentId: row.studentId,
      studentName: row.studentName,
      subjectLabel: row.subjectLabel,
      reportDate: row.reportDate,
    }));
}

/** 미발송 이벤트 → 집계 본문(없으면 null). 한 건이면 학생·날짜, 여러 건이면 이름 집계 + 건수. */
export function unsentReportDigestBody(events: readonly UnsentReportEvent[]): string | null {
  if (events.length === 0) return null;
  if (events.length === 1) {
    const event = events[0];
    return `${event.studentName} 학생 ${event.reportDate} ${event.subjectLabel} 수업 보고서가 저장만 되고 아직 발송되지 않았습니다.`;
  }
  const names = summarizeNames([...new Set(events.map((event) => event.studentName))]);
  return `${names} 학생의 수업 보고서 ${events.length}건이 저장만 되고 아직 발송되지 않았습니다(${events[0].reportDate}~).`;
}

/** 직원 몫 bucket — **KST 오늘 날짜**가 키다(같은 날 cron이 여러 번 돌아도 같은 키 = 하루 한 번). */
export function unsentReminderBucket(todayKst: string): string {
  return `remind:${todayKst}`;
}

/**
 * 미발송 알림을 받는 사람 — 보고서 하나는 **딱 한 곳**(원장 2026-10-29 *"나와 관련있는 알림만"*):
 * ① 작성 계정(`created_by`, 재직) → ② 그 보고서 반(보강은 앵커 반)의 재직 담임 → ③ 없으면 null = 원장.
 * 🔴 학생의 **다른 반 담임**에게는 보내지 않는다 — 그 사람은 이 보고서를 쓰지도 보내지도 않는다(적대 리뷰 2026-11-05 C2:
 *    학생 220명 중 130명이 담임 2명 이상 · 60일간 반 담임이 아닌 사람이 쓴 보고서 206건).
 * `activeStaff` = 재직 계정 id(본 테넌트) · `classTeacher` = 반 → 재직 담임(호출부 `activeClassTeachers`).
 * ⚠️ 관리자 직접 작성(compose)은 created_by가 비어 반 담임에게 간다 — created_by는 보강 귀속(`pickMakeupOwner`)·원스크린
 *    보강 되살리기(`ownsMakeupReport`)·영상 과제 소유 판정에도 쓰여 채우지 않는다(채우면 2026-09-02 사고가 되살아난다 · 2026-11-06 결정).
 */
export function unsentRecipientOf(
  routing: UnsentRouting,
  activeStaff: ReadonlySet<string>,
  classTeacher: ReadonlyMap<string, string>,
): string | null {
  if (routing.createdBy && activeStaff.has(routing.createdBy)) return routing.createdBy;
  if (routing.anchorClassId) return classTeacher.get(routing.anchorClassId) ?? null;
  return null;
}

/** 지난 알림 기록 한 줄(`notification_events`, event_type `unsent_report`). `createdDate` = 기록 시각의 KST 날짜. */
export type UnsentPriorEvent = { subjectKey: string; bucket: string; seeded: boolean; createdDate: string | null };

/**
 * 보고서별 직원 알림 이력 — `sent` = 보낸 직원 몫 수(`remind:*` + 2026-11-05 이전의 강사 1회분 `"unsent"`).
 * 🔴 **시드(콜드스타트 기록)는 상한으로 센다** — 종전 콜드스타트 뜻 그대로, 첫 실행에 잡힌 보고서는 그 뒤로도 직원에게
 *    울리지 않는다(시드를 0으로 세면 기록 0건인 학원의 밀린 건이 다음 날 한꺼번에 울린다 — 적대 리뷰 r2 X3).
 * `today` = 오늘 이미 울렸나(오늘 bucket이 있거나, 오늘 기록된 `"unsent"` — 배포 당일 옛 코드가 아침에 이미 보낸 뒤
 * cron을 손으로 다시 돌려도 두 번 울리지 않게).
 */
export function unsentTeacherAlertHistory(
  prior: readonly UnsentPriorEvent[],
  todayKst: string,
): Map<string, { sent: number; today: boolean }> {
  const todayBucket = unsentReminderBucket(todayKst);
  const out = new Map<string, { sent: number; today: boolean }>();
  for (const row of prior) {
    const once = row.bucket === UNSENT_ONCE_BUCKET;
    if (!once && !row.bucket.startsWith("remind:")) continue;
    const entry = out.get(row.subjectKey) ?? { sent: 0, today: false };
    entry.sent += row.seeded ? UNSENT_TEACHER_ALERTS_MAX : 1;
    if (row.bucket === todayBucket || (once && row.createdDate === todayKst)) entry.today = true;
    out.set(row.subjectKey, entry);
  }
  return out;
}

/**
 * 오늘 기록할 미발송 이벤트 — 게이트(`filterUnsentSendable`)를 지난 행만 넘긴다(새 게이트를 만들지 않는다).
 *  · 받을 직원이 없으면(`unsentRecipientOf` = null) 원장 1회분(`"unsent"`) — 중복은 호출부 upsert가 막는다(종전 그대로).
 *  · 받을 직원이 있으면 `remind:{오늘}` — 작성 당일이 아니고 · 오늘 아직 안 울렸고 · 지금까지 `UNSENT_TEACHER_ALERTS_MAX`번
 *    미만일 때만(시드는 상한으로 센다). 처음 잡힌 날부터 센다(작성일·수업일로 세지 않는다).
 *    단 오늘이 **발송 마지막 날**이면 작성 당일이라도 울린다 — 마지막 날 새벽(cron 07:00 전)에 저장한 건은 내일이면 기한이
 *    지나 한 번도 못 울린다(적대 리뷰 r2 X1).
 * 날짜 오름차순(오래된 것 먼저).
 */
export function planUnsentAlerts(args: {
  rows: readonly (UnsentReportInput & UnsentRouting)[];
  todayKst: string;
  activeStaff: ReadonlySet<string>;
  classTeacher: ReadonlyMap<string, string>;
  prior: readonly UnsentPriorEvent[];
}): UnsentReportEvent[] {
  const history = unsentTeacherAlertHistory(args.prior, args.todayKst);
  const bucket = unsentReminderBucket(args.todayKst);
  const events: UnsentReportEvent[] = [];
  for (const row of [...args.rows].sort(oldestUnsentFirst)) {
    const recipientId = unsentRecipientOf(row, args.activeStaff, args.classTeacher);
    if (recipientId === null) {
      events.push(...buildUnsentReportEvents([row]));
      continue;
    }
    if (row.createdDate === args.todayKst && row.sendDeadline !== args.todayKst) continue;
    const seen = history.get(row.reportId);
    if (seen?.today || (seen?.sent ?? 0) >= UNSENT_TEACHER_ALERTS_MAX) continue;
    events.push({
      subjectKey: row.reportId,
      bucket,
      studentId: row.studentId,
      studentName: row.studentName,
      subjectLabel: row.subjectLabel,
      reportDate: row.reportDate,
      recipientId,
      createdDate: row.createdDate ?? null,
      sendDeadline: row.sendDeadline ?? null,
    });
  }
  return events;
}

/** 새로 기록된 이벤트(`recordNew` 결과) → 원장 1회분 · 받는 사람별 직원 몫. 다른 날 bucket은 버린다(방어). */
export function splitRecordedUnsent(
  recorded: readonly UnsentReportEvent[],
  todayKst: string,
): { master: UnsentReportEvent[]; byRecipient: Map<string, UnsentReportEvent[]> } {
  const bucket = unsentReminderBucket(todayKst);
  const master: UnsentReportEvent[] = [];
  const byRecipient = new Map<string, UnsentReportEvent[]>();
  for (const event of recorded) {
    if (event.bucket === UNSENT_ONCE_BUCKET) master.push(event);
    else if (event.bucket === bucket && event.recipientId) {
      const list = byRecipient.get(event.recipientId) ?? [];
      list.push(event);
      byRecipient.set(event.recipientId, list);
    }
  }
  return { master, byRecipient };
}

/**
 * 발송 시간창 끝 시각(HH:MM) — 시간창이 켜져 있고 **하루 안에서** 끝날 때만(시작 < 끝). 워커가 시간창을 다시 보므로
 * 마지막 날은 이 시각이 진짜 마감이다(침산 08:30~22:30). 무제한·자정을 넘는 창은 null(그날 자정까지 — 날짜 기한이 먼저 닫힌다).
 * 활성 판정은 `classnoteSendWindowLabel`(워커 fail-open 규약 미러) 그대로.
 */
export function unsentSendWindowEnd(start: string, end: string): string | null {
  const label = classnoteSendWindowLabel(start, end);
  if (!label) return null;
  const [from, to] = label.split("~");
  return from && to && from < to ? to : null;
}

/**
 * 직원 몫 본문(없으면 null). 날짜는 전부 'M/D'(`monthDayLabel`) — 수업일 · 저장일 · 마감일이 한 가지 표기.
 * '지금 미발송 상태'라고만 쓴다(재발급·첨부 변경으로 다시 미발송이 된 건이 있어 '저장만 되고'라고 단정하지 않는다).
 * 꼬리 = 발송 마지막 날(여러 건이면 가장 이른 것 · 오늘이면 '오늘') + 시간창 끝 시각 — '오늘 22:30까지만 보낼 수 있습니다'.
 */
export function unsentTeacherDigestBody(
  events: readonly UnsentReportEvent[],
  todayKst: string,
  windowEnd: string | null,
): string | null {
  if (events.length === 0) return null;
  const deadline = events
    .map((event) => event.sendDeadline)
    .filter((date): date is string => !!date)
    .sort()[0];
  const until = deadline
    ? `${deadline === todayKst ? "오늘" : monthDayLabel(deadline)}${windowEnd ? ` ${windowEnd}` : ""}`
    : null;
  if (events.length === 1) {
    const event = events[0];
    const saved = event.createdDate ? `(${monthDayLabel(event.createdDate)} 저장)` : "";
    const head = `${event.studentName} 학생 ${monthDayLabel(event.reportDate)} ${event.subjectLabel} 수업 보고서${saved}가 지금 미발송 상태입니다`;
    return until ? `${head} — ${until}까지만 보낼 수 있습니다.` : `${head}.`;
  }
  const names = summarizeNames([...new Set(events.map((event) => event.studentName))]);
  const oldest = [...events].sort((a, b) => a.reportDate.localeCompare(b.reportDate))[0]!.reportDate;
  const head = `${names} 학생의 수업 보고서 ${events.length}건이 지금 미발송 상태입니다(${monthDayLabel(oldest)}~)`;
  return until ? `${head} — 가장 이른 건은 ${until}까지만 보낼 수 있습니다.` : `${head}.`;
}

// ─────────── 발송 실패 "마감" 이벤트 ───────────
// 실패한 보고서는 **오늘 포함 7일** 안에만 다시 보낼 수 있다(classnoteRetryDeadline). 실패했다는 사실
// 자체는 이미 두 경로가 알린다 — 0143a DB 트리거 + 하루 1회 유실 보정 스윕(failed-notify-sweep.ts).
// 그래서 여기서는 실패를 **다시 알리지 않는다**. 알리는 건 오직 "오늘이 마지막 날"이라는 사실 하나다.
//
// 🔴 왜 필요한가: 2026-08-11 실측 — 실패 16건 중 **11건이 아무도 손대지 않은 채 기한을 넘겨 학부모에게
//    영영 못 나갔다**(#105). 첫 알림은 갔지만 "언제까지"가 벨 어디에도 없어 미뤄지다 조용히 만료됐다.
// ⚠️ **이미 만료된 건은 후보가 아니다** — 되돌릴 수 없는 일을 알리는 건 잔소리다(총량은 발송 콘솔의
//    '기한 넘겨 못 나감' 경고가 맡는다).
// ⚠️ 마지막 날 **하루만** 울린다(D-2·D-1을 더하면 같은 보고서가 벨을 세 번 채운다). 남은 날 표시는
//    화면(발송 콘솔 배지)이 매일 하고 있고, 벨은 마지막 그물이다.
// 🔴 본문을 `{학생} · {MM-DD} — ` 형식으로 쓰지 말 것 — 스윕의 중복키 파서(parseNotifiedKey)가 그 형식을
//    읽어 "이 건은 이미 알렸다"로 오인해 **정작 실패 알림이 안 나간다**.

export type SendDeadlineInput = {
  reportId: string;
  studentId: string;
  studentName: string;
  subjectLabel: string; // 한글 라벨(raw 과목 키 노출 금지)
  reportDate: string; // YYYY-MM-DD
  /** 오늘 포함 남은 날. 0 = 오늘이 마지막 날. classnoteRetryDeadline이 계산해 넘긴다. */
  daysLeft: number;
};

export type SendDeadlineEvent = {
  /** dedup 주체 = 보고서 id(학생이 아님 — groupEventsByTeacher에 studentIdOf 필수). */
  subjectKey: string;
  /**
   * 상태 전이 표현 — 보고서당 딱 한 번. 앵커일(오늘)을 넣으면 매일 재알림이 되고,
   * 실패 여부를 넣으면 상태가 오가며 다시 울린다.
   */
  bucket: "lastday";
  studentId: string;
  studentName: string;
  subjectLabel: string;
  reportDate: string;
};

/**
 * 재발송 마지막 날인 실패 보고서만 이벤트로. 날짜 오름차순.
 * ⚠️ `daysLeft !== 0`은 전부 버린다 — 아직 여유가 있으면 화면 배지가 맡고, 음수면 이미 만료다.
 */
export function buildSendDeadlineEvents(rows: readonly SendDeadlineInput[]): SendDeadlineEvent[] {
  return [...rows]
    .filter((row) => row.daysLeft === 0)
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.reportId.localeCompare(b.reportId))
    .map((row) => ({
      subjectKey: row.reportId,
      bucket: "lastday" as const,
      studentId: row.studentId,
      studentName: row.studentName,
      subjectLabel: row.subjectLabel,
      reportDate: row.reportDate,
    }));
}

/** 담당 강사용 본문 — 건별 1개(무엇을 고쳐야 하는지 학생·날짜가 정확해야 손이 간다). */
export function sendDeadlineBody(event: SendDeadlineEvent): string {
  return `${event.studentName} 학생 ${event.reportDate} ${event.subjectLabel} 수업 보고서가 학부모에게 발송되지 못했습니다 — 오늘까지만 다시 보낼 수 있습니다.`;
}

/** 원장(master)용 집계 본문 — 없으면 null. */
export function sendDeadlineDigestBody(events: readonly SendDeadlineEvent[]): string | null {
  if (events.length === 0) return null;
  if (events.length === 1) return sendDeadlineBody(events[0]);
  const names = summarizeNames([...new Set(events.map((event) => event.studentName))]);
  return `${names} 학생의 수업 보고서 ${events.length}건이 발송되지 못한 채 오늘 재발송 기한이 끝납니다.`;
}

// ─────────── 진도 이상(수학) 이벤트 ───────────
// G2 선알림 — ingest(progress/server/ingest.ts, math 전용)가 남긴 jump_error/overlap_error를 벨로.
// ⚠️ regression은 의도적 제외 — 실측(2026-07-19) 최근 14일 80건/학생 50명(복습 재기록 소음),
// 오류 2종은 같은 기간 한 자릿수(고신호). 배지(roster-signals.ts)와 같은 선정 기준.

export type ProgressAnomalyRow = {
  studentId: string;
  studentName: string;
  eventId: string; // progress_events.id
  eventType: string; // jump_error | overlap_error (그 외는 build에서 제외)
};
export type ProgressAnomalyEvent = {
  subjectKey: string; // studentId — 담당 강사 라우팅(groupEventsByTeacher 기본 추출자와 호환)
  studentId: string; // 딥링크(학생 상세 진도 탭)용 — subjectKey와 같은 값이지만 용도가 달라 별도 필드
  bucket: string; // `pe:${eventId}` — 이벤트 1건 = 전이 1회 = 알림 1회(앵커일 아님, dedup 규약 준수)
  studentName: string;
  label: string; // 한글 라벨(raw enum 노출 금지) — progress-panel과 동일 표현
};

/** 진도 이상 라벨 — 학생 상세 진도 탭(progress-panel.tsx)과 같은 한글 표현으로 통일. */
export const PROGRESS_ANOMALY_LABEL: Record<string, string> = {
  jump_error: "진도 점프",
  overlap_error: "선행·현행 겹침",
};

export function buildProgressAnomalyEvents(rows: readonly ProgressAnomalyRow[]): ProgressAnomalyEvent[] {
  const events: ProgressAnomalyEvent[] = [];
  for (const row of rows) {
    const label = PROGRESS_ANOMALY_LABEL[row.eventType];
    if (!label) continue; // regression 등 미대상 유형 방어(쿼리 필터와 이중)
    events.push({
      subjectKey: row.studentId,
      studentId: row.studentId,
      bucket: `pe:${row.eventId}`,
      studentName: row.studentName,
      label,
    });
  }
  return events;
}

/**
 * 진도 이상 알림은 **학생 1명 = 알림 1건**으로 쪼갠다 — 알림의 link는 1개뿐이라, 여러 명을 한 건으로
 * 묶으면 "누구를 어디서 확인하라"를 링크로 표현할 수 없다(2026-07-27 원장 제보: 3명 묶음 알림 →
 * `/students`(전체 목록)로 보내 클릭해도 아무 정보가 없었음). 실측 볼륨이 14일 한 자릿수라 분할해도
 * 벨 폭탄이 아니다. 순서는 입력 순(안정 정렬) — 같은 배치는 항상 같은 알림 순서.
 */
export function groupProgressAnomalyByStudent(
  events: readonly ProgressAnomalyEvent[],
): { studentId: string; studentName: string; events: ProgressAnomalyEvent[] }[] {
  const byStudent = new Map<string, { studentId: string; studentName: string; events: ProgressAnomalyEvent[] }>();
  for (const event of events) {
    const found = byStudent.get(event.studentId);
    if (found) found.events.push(event);
    else byStudent.set(event.studentId, { studentId: event.studentId, studentName: event.studentName, events: [event] });
  }
  return [...byStudent.values()];
}

/**
 * 진도 이상 본문(학생 1명분) — "수학" 명시(파이프라인이 math 전용, 리뷰 확정: 무표기 시 타과목 오인).
 * 유형 라벨은 괄호로 뺀다 — `${label}이(가)`처럼 조사를 붙이면 "진도 점프이(가)"처럼 어색해진다
 * (받침 유무가 라벨마다 달라 고정 조사로는 못 맞춤). 문장 조사는 "이상이"로 고정.
 */
export function progressAnomalyStudentBody(
  studentName: string,
  events: readonly ProgressAnomalyEvent[],
): string | null {
  if (events.length === 0) return null;
  const labels = [...new Set(events.map((event) => event.label))];
  return `${studentName} 학생 수학 진도 기록에 이상이 감지됐습니다(${labels.join(", ")}) — 진도 탭에서 확인해 주세요.`;
}

/** 진도 이상 알림 딥링크 — 학생 상세 **진도 탭**(이상 감지 내역이 실제로 보이는 유일한 화면). */
export function progressAnomalyLink(studentId: string): string {
  return `/students/${studentId}?tab=progress`;
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
