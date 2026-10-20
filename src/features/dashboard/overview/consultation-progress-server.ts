import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import type { CalendarEvent } from "@/features/calendar/types";
import { reportError } from "@/lib/observability/report-error";
import { homonymFamilies, type AdminDeps, type ConsultationRow } from "./admissions-links-server";
import { consultationBasesInTitles, matchAdmissionsConsultation } from "./admissions-consultation-link";
import { admissionsEventKind } from "./display";
import {
  chipOf,
  progressOf,
  summarizeProgress,
  type ConsultProgress,
  type ConsultProgressData,
  type ProgressEnrollment,
} from "./consultation-progress";

/**
 * 연결 원생들의 **미종료** 수강(시작일 · 반 과목) — 콜&상담 칸반의 배정 판정(`loadRowBadges`)과 같은 조건
 * (`end_date IS NULL OR end_date >= 오늘`)에 시작일을 더해 받는다(반 배정과 첫 수업을 가르려고).
 * id가 수십~수백이라 청크로(B3), 오류는 던진다(0으로 위장하지 않는다).
 */
async function progressEnrollments(studentIds: readonly string[], today: string, deps?: AdminDeps): Promise<ProgressEnrollment[]> {
  if (!studentIds.length) return [];
  const db = deps?.db ?? (await createClient());
  type Row = { student_id: string; start_date: string | null; class: { subject?: string | null } | { subject?: string | null }[] | null };
  const rows = await fetchInChunks<Row>([...studentIds], (chunk) => {
    const q = db
      .from("enrollments")
      .select("student_id, start_date, class:class_id ( subject )")
      .in("student_id", chunk)
      .or(`end_date.is.null,end_date.gte.${today}`);
    return deps ? q.eq("tenant_id", deps.tenantId) : q;
  });
  return rows.map((row) => {
    const klass = Array.isArray(row.class) ? row.class[0] : row.class;
    return { studentId: row.student_id, subject: klass?.subject ?? null, startDate: row.start_date };
  });
}

/**
 * 레벨테스트 일정 → 그 일정이 가리키는 콜&상담(운영실 일정 카드와 **같은 매처**·같은 60일 창·같은 동명이인 규칙).
 * 동명이인 조회가 실패하면 null(모름) — 일정 카드가 상담 연결을 끄는 것과 같은 판단이다(모르는 채 붙이면 다른 아이의 입테가 된다).
 */
async function levelTestDatesByConsultation(
  events: readonly CalendarEvent[],
  consultations: readonly ConsultationRow[],
  notNames: readonly string[],
  since: string,
  deps?: AdminDeps,
): Promise<Map<string, string[]> | null> {
  const levelTests = events.filter((event) => admissionsEventKind(event) === "levelTest");
  const byConsultation = new Map<string, string[]>();
  if (!levelTests.length) return byConsultation;
  const bases = consultationBasesInTitles(levelTests, consultations, notNames);
  let families: Awaited<ReturnType<typeof homonymFamilies>> = new Map();
  if (bases.length) {
    try {
      families = await homonymFamilies(bases, deps);
    } catch (error) {
      reportError(error, { scope: "dashboard.consult-progress-homonyms" });
      return null;
    }
  }
  for (const event of levelTests) {
    const hit = matchAdmissionsConsultation(event, consultations, notNames, { since, families });
    if (hit) byConsultation.set(hit.id, [...(byConsultation.get(hit.id) ?? []), event.startDate]);
  }
  return byConsultation;
}

/**
 * 운영실 '상담 진행' — 상담(60일, 일정 카드와 같은 조회 결과를 받는다) × 연결 원생 수강 × 레벨테스트 일정.
 * @param events 레벨테스트를 찾을 일정(상담 창 첫날 ~ 한 달 뒤). null = 캘린더를 못 읽음 → 입테 단계는 '모름'.
 */
export async function consultProgress(
  consultations: readonly ConsultationRow[],
  events: readonly CalendarEvent[] | null,
  notNames: readonly string[],
  since: string,
  today: string,
): Promise<ConsultProgressData> {
  const { list, levelTestKnown } = await consultProgressList(consultations, events, notNames, since, today);
  return consultProgressData(list, levelTestKnown, today);
}

/** 상담마다 지금 단계(조회 포함) — 운영실은 이것을 한 번 만들어 학원 전체·과목별 값으로 나눠 센다(`consultProgressData`). */
export async function consultProgressList(
  consultations: readonly ConsultationRow[],
  events: readonly CalendarEvent[] | null,
  notNames: readonly string[],
  since: string,
  today: string,
  /** cron(관리 키) 경로 — 매일 기록(`ops-daily.ts`)이 운영실과 같은 판정을 지점별로 돌린다. */
  deps?: AdminDeps,
): Promise<{ list: ConsultProgress[]; levelTestKnown: boolean }> {
  const studentIds = [...new Set(consultations.flatMap((c) => (c.studentId ? [c.studentId] : [])))];
  // 수강 조회와 입테 연결은 서로 독립이라 함께(B4).
  const [enrollments, levelTests] = await Promise.all([
    progressEnrollments(studentIds, today, deps),
    events ? levelTestDatesByConsultation(events, consultations, notNames, since, deps) : Promise.resolve(null),
  ]);
  const list = consultations.map((c) =>
    progressOf(
      { id: c.id, name: c.name, outcome: c.outcome, consultedOn: c.consultedOn, subject: c.subject, studentId: c.studentId },
      enrollments,
      levelTests ? (levelTests.get(c.id) ?? []) : null,
      today,
    ),
  );
  return { list, levelTestKnown: levelTests !== null };
}

/** 단계별 인원·멈춘 상담·칩 — 순수(조회 없음). */
export function consultProgressData(list: readonly ConsultProgress[], levelTestKnown: boolean, today: string): ConsultProgressData {
  return {
    summary: summarizeProgress(list, today, levelTestKnown),
    chips: Object.fromEntries(list.map((p) => [p.id, chipOf(p, today)])),
  };
}
