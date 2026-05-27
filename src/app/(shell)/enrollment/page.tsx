import Link from "next/link";
import { Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { getEnrollmentConsultations } from "@/features/enrollment/server/queries";

export const metadata = { title: "신입생 등록상담 — eywa" };

const COLUMNS: {
  key: string;
  label: string;
  outcomes: string[];
  accent: string;
}[] = [
  { key: "queue", label: "대기 · 예약", outcomes: ["pending", "scheduled"], accent: "border-l-chart-3" },
  { key: "consulted", label: "상담 완료", outcomes: ["consulted"], accent: "border-l-chart-1" },
  { key: "ai_done", label: "AI 분석 완료", outcomes: ["ai_done"], accent: "border-l-chart-2" },
  { key: "closed", label: "등록 · 종료", outcomes: ["enrolled", "declined", "no_show"], accent: "border-l-muted-foreground" },
];

const OUTCOME_BADGE: Record<string, { label: string; class: string }> = {
  pending: { label: "대기", class: "text-chart-3 bg-chart-3/10 border-chart-3/20" },
  scheduled: { label: "예약", class: "text-chart-3 bg-chart-3/10 border-chart-3/20" },
  consulted: { label: "상담완료", class: "text-chart-1 bg-chart-1/10 border-chart-1/20" },
  ai_done: { label: "AI 완료", class: "text-chart-2 bg-chart-2/10 border-chart-2/20" },
  enrolled: { label: "등록", class: "text-chart-2 bg-chart-2/10 border-chart-2/20" },
  declined: { label: "거절", class: "text-muted-foreground bg-muted border-border" },
  no_show: { label: "노쇼", class: "text-chart-4 bg-chart-4/10 border-chart-4/20" },
};

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export default async function EnrollmentPage() {
  await requireAccess("enrollment");
  const items = await getEnrollmentConsultations();
  const aiDone = items.filter((i) => i.outcome === "ai_done").length;
  const enrolled = items.filter((i) => i.outcome === "enrolled").length;
  const conversionRate = items.length > 0 ? ((enrolled / items.length) * 100).toFixed(0) : "0";

  return (
    <div className="space-y-6">
      <PageHeader
        title="신입생 등록상담"
        description={`전체 ${items.length}건 · AI 분석 완료 ${aiDone}건 · 등록 전환율 ${conversionRate}%`}
        actions={
          <Button render={<Link href="/enrollment/new" />}>
            <Plus className="size-4" />
            신규 등록
          </Button>
        }
      />

      {items.length === 0 ? (
        <EmptyState icon={UserPlus} title="진행 중인 상담이 없습니다" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const cards = items.filter((i) => col.outcomes.includes(i.outcome));
            return (
              <div
                key={col.key}
                className="bg-card border-border flex min-h-[300px] flex-col rounded-lg border"
              >
                <header className="border-border flex items-baseline justify-between border-b px-4 py-3">
                  <h3 className="text-foreground text-sm font-semibold">{col.label}</h3>
                  <span className="text-muted-foreground num text-xs">{cards.length}건</span>
                </header>
                {cards.length === 0 ? (
                  <div className="text-muted-foreground flex flex-1 items-center justify-center px-4 text-xs">
                    없음
                  </div>
                ) : (
                  <ul className="space-y-2 p-3">
                    {cards.map((c) => {
                      const badge = OUTCOME_BADGE[c.outcome] ?? OUTCOME_BADGE.pending!;
                      return (
                        <li key={c.id}>
                          <Link
                            href={`/enrollment/${c.id}`}
                            className={`group bg-muted/30 hover:bg-muted/60 block rounded-md border-l-2 p-3 transition ${col.accent}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-foreground text-sm font-semibold">
                                  {c.prospectName}
                                </p>
                                <p className="text-muted-foreground text-xs">
                                  {c.prospectGrade ?? "—"}
                                  {c.prospectSchool ? <> · {c.prospectSchool}</> : null}
                                </p>
                              </div>
                              <span
                                className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${badge.class}`}
                              >
                                {badge.label}
                              </span>
                            </div>
                            {c.parentRequest ? (
                              <p className="text-muted-foreground mt-2 line-clamp-2 text-xs leading-snug">
                                {c.parentRequest}
                              </p>
                            ) : null}
                            <div className="text-muted-foreground/80 mt-2 flex items-center justify-between text-[10px]">
                              <span>{c.consultantName ?? "—"}</span>
                              <span className="num">{daysSince(c.consultedAt)}일 전</span>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
