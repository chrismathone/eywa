import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getRetentionRoster } from "./queries";
import { formatWonShort } from "../format";

export type CampaignStatus = "pending" | "contacted" | "enrolled" | "declined";

export type CampaignCard = {
  targetId: string;
  studentId: string;
  name: string;
  grade: string | null;
  school: string | null;
  teacherName: string | null;
  feeLabel: string;
  status: CampaignStatus;
};

export type CampaignCandidate = {
  studentId: string;
  name: string;
  grade: string | null;
  school: string | null;
  teacherName: string | null;
  feeLabel: string;
  renewalLabel: string; // "낮음" / "보통"
  renewalTone: "risk" | "warn";
};

export type CampaignBoard = {
  candidates: CampaignCandidate[];
  columns: Record<CampaignStatus, CampaignCard[]>;
  stats: {
    pending: number;
    contacted: number;
    enrolled: number;
    declined: number;
    total: number;
    reenrollRate: number | null; // enrolled / (enrolled + declined)
  };
};

/**
 * 재등록 캠페인 보드 — 추적 중인 대상(reenrollment_campaign_targets, 퍼널 상태별) +
 * 재등록 위험(risk.renewal risk/warn) 중 아직 캠페인에 없는 "후보". RLS가 테넌트 격리,
 * teacherId 주면 담당 학생만(앱 레벨). 수강료는 roster(getRetentionRoster)에서.
 */
export async function getCampaignBoard(opts?: { teacherId?: string }): Promise<CampaignBoard> {
  const supabase = await createClient();

  const [{ data: targetRows }, roster] = await Promise.all([
    supabase
      .from("reenrollment_campaign_targets")
      .select(
        `id, student_id, status,
         student:student_id ( name, grade, school, primary_teacher_id,
           teacher:primary_teacher_id ( display_name ) )`,
      )
      .order("created_at", { ascending: true }),
    getRetentionRoster(opts),
  ]);

  const feeById = new Map(roster.map((r) => [r.id, r.monthlyFee]));
  const targetStudentIds = new Set((targetRows ?? []).map((t) => t.student_id));

  const columns: Record<CampaignStatus, CampaignCard[]> = {
    pending: [],
    contacted: [],
    enrolled: [],
    declined: [],
  };

  for (const t of targetRows ?? []) {
    const s = (Array.isArray(t.student) ? t.student[0] : t.student) as
      | {
          name?: string;
          grade?: string | null;
          school?: string | null;
          primary_teacher_id?: string | null;
          teacher?: { display_name?: string } | { display_name?: string }[];
        }
      | undefined;
    if (!s) continue;
    if (opts?.teacherId && s.primary_teacher_id !== opts.teacherId) continue;
    const teacher = (Array.isArray(s.teacher) ? s.teacher[0] : s.teacher) as
      | { display_name?: string }
      | undefined;
    const status = (["pending", "contacted", "enrolled", "declined"].includes(t.status)
      ? t.status
      : "pending") as CampaignStatus;
    columns[status].push({
      targetId: t.id,
      studentId: t.student_id,
      name: s.name ?? "?",
      grade: s.grade ?? null,
      school: s.school ?? null,
      teacherName: teacher?.display_name ?? null,
      feeLabel: formatWonShort(feeById.get(t.student_id) ?? 0),
      status,
    });
  }

  const candidates: CampaignCandidate[] = roster
    .filter(
      (r) =>
        (r.risk.renewal.tone === "risk" || r.risk.renewal.tone === "warn") &&
        !targetStudentIds.has(r.id),
    )
    .map((r) => ({
      studentId: r.id,
      name: r.name,
      grade: r.grade,
      school: r.school,
      teacherName: r.teacherName,
      feeLabel: formatWonShort(r.monthlyFee),
      renewalLabel: r.risk.renewal.label,
      renewalTone: r.risk.renewal.tone as "risk" | "warn",
    }));

  const counts = {
    pending: columns.pending.length,
    contacted: columns.contacted.length,
    enrolled: columns.enrolled.length,
    declined: columns.declined.length,
  };
  const decided = counts.enrolled + counts.declined;
  return {
    candidates,
    columns,
    stats: {
      ...counts,
      total: counts.pending + counts.contacted + counts.enrolled + counts.declined,
      reenrollRate: decided > 0 ? Math.round((counts.enrolled / decided) * 100) : null,
    },
  };
}
