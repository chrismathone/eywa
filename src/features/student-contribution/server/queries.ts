import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { kstToday, shiftMonth } from "@/lib/date-kst";
import { sumRaws } from "../model/calc";
import type { BackfillReport } from "../model/backfill-report";
import { getContributionGate } from "./access";
import { contributionReady, SETTINGS_TABLE } from "./store";
import { getContributionDirectory, getContributionSnapshot } from "./directory";
import { cachedContributionTotals } from "./snapshot-cache";

export const getContributionList = cache(async () => {
  const [directory, snapshot] = await Promise.all([getContributionDirectory(), getContributionSnapshot()]);
  if (!directory || !snapshot) return null;
  const { gate, rows: students, subjects, grades } = directory;
  const totals = snapshot.ready ? await cachedContributionTotals(gate.tenantId, students.map((s) => s.id),
    shiftMonth(kstToday().slice(0, 7), -11), snapshot.refreshedAt) : [];
  const byStudent = new Map(totals.map((r) => [r.studentId, r]));
  return { gate, ...snapshot, rows: students.map((s) => ({ ...s, total: byStudent.get(s.id) ?? null })), subjects, grades };
});

/** 배점 미리보기에는 학생별 전체 실적을 전송할 필요가 없다. */
export async function getContributionSettingsPreview() {
  const gate = await getContributionGate();
  if (!gate?.canConfigure) return null;
  const list = await getContributionList();
  if (!list) return null;
  return { gate, ready: list.ready, config: list.config, revision: list.revision, historyReady: list.historyReady,
    studentCount: list.rows.length, raws: sumRaws(list.rows.flatMap((r) => r.total ? [r.total.raws] : [])) };
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
  const current = await fetchAllPagedInChunks<{ id: string; referrer_student_id: string | null; referrer_staff_id: string | null }>(
    report.rows.filter((r) => r.state === "automatic" || r.state === "review").map((r) => r.consultationId),
    (chunk, a, b) => db.from("enrollment_consultations").select("id, referrer_student_id, referrer_staff_id")
      .eq("tenant_id", gate.tenantId).in("id", chunk).order("id").range(a, b));
  const linked = new Set(current.filter((c) => c.referrer_student_id || c.referrer_staff_id).map((c) => c.id));
  const rows = report.rows.map((r) => linked.has(r.consultationId) ? { ...r, state: "linked" as const } : r);
  return { gate, report: { ...report, rows, counts: { ...report.counts,
    automatic: rows.filter((r) => r.state === "automatic").length, review: rows.filter((r) => r.state === "review").length,
    linked: rows.filter((r) => r.state === "linked").length } } };
}
