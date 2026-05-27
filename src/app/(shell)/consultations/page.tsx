import Link from "next/link";
import { MessagesSquare, Pencil, Plus } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import {
  followUpUrgency,
  getStudentConsultations,
  type FollowUpUrgency,
  type StudentConsultationCategory,
} from "@/features/consultations/server/queries";

export const metadata = { title: "학생상담 — eywa" };

const CATEGORY_LABEL: Record<StudentConsultationCategory, string> = {
  general: "일반",
  academic: "학습/성적",
  emotional: "정서/심리",
  career: "진로",
  social: "교우관계",
  other: "기타",
};

const CATEGORY_COLOR: Record<StudentConsultationCategory, string> = {
  general: "text-muted-foreground bg-muted border-border",
  academic: "text-chart-2 bg-chart-2/10 border-chart-2/20",
  emotional: "text-chart-4 bg-chart-4/10 border-chart-4/20",
  career: "text-chart-1 bg-chart-1/10 border-chart-1/20",
  social: "text-chart-3 bg-chart-3/10 border-chart-3/20",
  other: "text-muted-foreground bg-muted border-border",
};

const URGENCY_STYLE: Record<FollowUpUrgency, { label: string; class: string } | null> = {
  done: { label: "완료", class: "text-chart-2 bg-chart-2/10 border-chart-2/20" },
  overdue: { label: "지연", class: "text-chart-4 bg-chart-4/10 border-chart-4/20" },
  today: { label: "오늘", class: "text-chart-4 bg-chart-4/10 border-chart-4/20" },
  soon: { label: "3일 내", class: "text-chart-3 bg-chart-3/10 border-chart-3/20" },
  later: { label: "예정", class: "text-chart-1 bg-chart-1/10 border-chart-1/20" },
  none: null,
};

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
  const pendingFollowUps = items.filter(
    (i) => !i.followUpDone && i.followUpDate,
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="학생상담"
        description={`전체 ${items.length}건 · 최근 7일 ${lastWeek}건 · 진행 중 후속 ${pendingFollowUps}건`}
        actions={
          <Button render={<Link href="/consultations/new" />}>
            <Plus className="size-4" />
            상담 추가
          </Button>
        }
      />

      {items.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="기록된 상담이 없습니다" />
      ) : (
        <ul className="space-y-3">
          {items.map((c) => {
            const urgency = URGENCY_STYLE[followUpUrgency(c.followUpDate, c.followUpDone)];
            const catColor = c.category ? CATEGORY_COLOR[c.category] : null;
            const catLabel = c.category ? CATEGORY_LABEL[c.category] : null;
            return (
              <li key={c.id} className="bg-card border-border rounded-lg border p-5">
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
                    {catLabel && catColor ? (
                      <span
                        className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${catColor}`}
                      >
                        {catLabel}
                      </span>
                    ) : null}
                    {c.subject ? (
                      <span className="text-muted-foreground text-[10px]">· {c.subject}</span>
                    ) : null}
                  </div>
                  <div className="text-muted-foreground flex items-center gap-2 text-xs">
                    {c.counselorName ? <span>{c.counselorName} 상담</span> : null}
                    <span className="text-muted-foreground/40">·</span>
                    <span className="num">{relativeTime(c.consultedAt)}</span>
                    <Link
                      href={`/consultations/${c.id}/edit`}
                      className="text-muted-foreground hover:text-foreground ml-1 inline-flex items-center gap-1"
                    >
                      <Pencil className="size-3" />
                      <span className="sr-only">수정</span>
                    </Link>
                  </div>
                </header>

                <p className="text-foreground mt-3 text-sm leading-relaxed">{c.summary}</p>

                {c.followUpAction || c.followUpDate ? (
                  <div className="border-border mt-3 flex items-center justify-between gap-2 border-t pt-3">
                    <p className="text-muted-foreground text-xs">
                      <span className="text-chart-3 mr-1.5 font-semibold tracking-wide uppercase">
                        Follow-up
                      </span>
                      {c.followUpAction ?? "—"}
                      {c.followUpDate ? (
                        <span className="num text-muted-foreground/80 ml-2">
                          · 기한 {c.followUpDate}
                        </span>
                      ) : null}
                    </p>
                    {urgency ? (
                      <span
                        className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${urgency.class}`}
                      >
                        {urgency.label}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
