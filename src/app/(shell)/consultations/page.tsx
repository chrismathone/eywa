import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { getStudentConsultations } from "@/features/consultations/server/queries";

export const metadata = { title: "학생상담 — eywa" };

function relativeTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "오늘";
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

export default async function ConsultationsPage() {
  await requireAccess("consultations");
  const items = await getStudentConsultations();

  // eslint-disable-next-line react-hooks/purity -- server component renders once per request
  const cutoff = Date.now() - 7 * 86_400_000;
  const lastWeek = items.filter((i) => new Date(i.consultedAt).getTime() > cutoff).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="학생상담"
        description={`전체 ${items.length}건 · 최근 7일 ${lastWeek}건. 재원생 면담 기록과 후속 액션.`}
      />

      {items.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="기록된 상담이 없습니다" />
      ) : (
        <ul className="space-y-3">
          {items.map((c) => (
            <li
              key={c.id}
              className="bg-card border-border rounded-lg border p-5"
            >
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <Link
                    href={`/students/${c.studentId}`}
                    className="text-foreground text-base font-semibold hover:underline"
                  >
                    {c.studentName}
                  </Link>
                  {c.studentGrade ? (
                    <span className="text-muted-foreground text-xs">{c.studentGrade}</span>
                  ) : null}
                </div>
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  {c.counselorName ? <span>{c.counselorName} 상담</span> : null}
                  <span className="text-muted-foreground/40">·</span>
                  <span className="num">{relativeTime(c.consultedAt)}</span>
                </div>
              </header>

              <p className="text-foreground mt-3 text-sm leading-relaxed">{c.summary}</p>

              {c.followUpAction ? (
                <p className="text-muted-foreground border-border mt-3 border-t pt-3 text-xs">
                  <span className="text-chart-3 mr-1.5 font-semibold tracking-wide uppercase">
                    Follow-up
                  </span>
                  {c.followUpAction}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
