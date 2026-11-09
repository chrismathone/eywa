import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { kstDateOf, kstToday, shiftMonth } from "@/lib/date-kst";
import { sumRaws } from "../model/calc";
import type { BackfillReport } from "../model/backfill-report";
import { reviewDisplay, type ConsultationIdentity } from "../model/review-display";
import { getContributionGate } from "./access";
import { contributionReady, SETTINGS_TABLE } from "./store";
import { getContributionDirectory, getContributionSnapshot } from "./directory";
import { cachedContributionTotals, cachedEnrolledMonths } from "./snapshot-cache";
import { getFamilyLoyaltyDirectory } from "./family-loyalty";
import deployment from "../../../../vercel.json";
import { hasApprovedParentEventImport } from "./parent-events";

export const getContributionList = cache(async (withEnrolledMonths = true) => {
  const [directory, snapshot, families] = await Promise.all([getContributionDirectory(), getContributionSnapshot(), getFamilyLoyaltyDirectory()]);
  if (!directory || !snapshot) return null;
  const { gate, rows: students, subjects, grades } = directory;
  const ids = students.map((s) => s.id), month = kstToday().slice(0, 7);
  const [totals, monthCounts] = snapshot.ready ? await Promise.all([
    cachedContributionTotals(gate.tenantId, ids, shiftMonth(month, -11), snapshot.refreshedAt),
    withEnrolledMonths ? cachedEnrolledMonths(gate.tenantId, ids, (snapshot.refreshedAt ? kstDateOf(snapshot.refreshedAt)?.slice(0, 7) : null) ?? month, snapshot.refreshedAt) : Promise.resolve([]),
  ]) : [[], []];
  const byStudent = new Map(totals.map((r) => [r.studentId, r]));
  const monthsByStudent = new Map(monthCounts.map((r) => [r.student_id, r.enrolled_months]));
  return { gate, ...snapshot, month, checkedAt: new Date().toISOString(), refreshCron: deployment.crons.find((job) => job.path === "/api/cron/student-contribution")?.schedule ?? null,
    rows: students.map((s) => ({ ...s, family: families.byStudent.get(s.id) ?? families.fallback, enrolledMonths: monthsByStudent.get(s.id) ?? null, total: byStudent.get(s.id) ?? null })), subjects, grades };
});

/** 배점 미리보기에는 학생별 전체 실적을 전송할 필요가 없다. */
export async function getContributionSettingsPreview() {
  const gate = await getContributionGate();
  if (!gate?.canConfigure) return null;
  const [list, parentEventsApproved] = await Promise.all([getContributionList(false), hasApprovedParentEventImport(createAdminClient(), gate.tenantId)]);
  if (!list) return null;
  return { gate, ready: list.ready, config: list.config, revision: list.revision, historyReady: list.historyReady, parentEventsApproved,
    studentCount: list.rows.length, families: list.rows.map(r => r.family), raws: sumRaws(list.rows.flatMap((r) => r.total ? [r.total.raws] : [])) };
}

export async function getContributionReview() {
  const gate = await getContributionGate();
  if (!gate?.canConfigure) return null;
  const db = createAdminClient();
  if (!(await contributionReady(db, gate.tenantId))) return null;
  const { data, error } = await db.from(SETTINGS_TABLE).select("referral_review").eq("tenant_id", gate.tenantId).maybeSingle();
  if (error) throw new Error("소개 확인 목록을 읽지 못했습니다");
  const report = data?.referral_review as (BackfillReport & { checkedAt: string }) | null;
  if (!report) return { gate, report };
  const current = await fetchAllPagedInChunks<ConsultationIdentity>(
    report.rows.map((r) => r.consultationId),
    (chunk, a, b) => db.from("enrollment_consultations").select("id, prospect_name, consultation_date, received_date, created_at, referrer_student_id, referrer_staff_id")
      .eq("tenant_id", gate.tenantId).in("id", chunk).order("id").range(a, b));
  return { gate, report: reviewDisplay(report, current) };
}
