import Link from "next/link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { requireAccess } from "@/lib/auth/require-access";
import { DEMO_STUDENT } from "@/features/my-learning/data";
import { findSession } from "@/features/my-learning/history";
import { DailyReportView } from "@/features/my-learning/components/daily-report-view";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";

export const metadata = { title: "데일리 리포트 — 에이와" };

/**
 * 학생 데일리 리포트 — `?date=<M/D>`로 특정 세션. 없으면 최신(6/1).
 * 누적 현황의 최근 기록에서 진입. 읽기 전용.
 */
export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireAccess("my_learning");
  // 과목 색 = 학원설정(운영 enum 하드코딩 금지). 설정과 쿼리 문자열은 서로 기다리지 않는다(B4).
  const [settings, { date }] = await Promise.all([getTenantSettings(), searchParams]);
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const { student, history } = DEMO_STUDENT;
  const session = findSession(history, date ?? null);

  return (
    <div className="mx-auto max-w-[680px] space-y-4">
      <Link
        href="/my-learning"
        className="text-text-dim hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <EyIcon name="arrowLeft" size={14} />
        누적 현황
      </Link>
      <DailyReportView base={student} session={session} subjectMaps={subjectMaps} />
    </div>
  );
}
