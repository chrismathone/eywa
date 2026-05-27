import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Initial } from "@/components/atoms/initial";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import {
  followUpUrgency,
  getStudentConsultations,
  type FollowUpUrgency,
  type StudentConsultationCategory,
} from "@/features/consultations/server/queries";

export const metadata = { title: "학생상담 — eywa" };

const CATEGORY_META: Record<StudentConsultationCategory, { label: string; color: PillColor }> = {
  general: { label: "일반", color: "neutral" },
  academic: { label: "학습", color: "primary" },
  emotional: { label: "정서", color: "rose" },
  career: { label: "진로", color: "blue" },
  social: { label: "교우", color: "gold" },
  other: { label: "기타", color: "neutral" },
};

const URGENCY_META: Record<FollowUpUrgency, { label: string; color: PillColor } | null> = {
  done: { label: "완료", color: "primary" },
  overdue: { label: "지연", color: "danger" },
  today: { label: "오늘", color: "danger" },
  soon: { label: "3일 내", color: "amber" },
  later: { label: "예정", color: "blue" },
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
  const pendingFollowUps = items.filter((i) => !i.followUpDone && i.followUpDate).length;
  const overdueFollowUps = items.filter(
    (i) => followUpUrgency(i.followUpDate, i.followUpDone) === "overdue",
  ).length;

  return (
    <div className="space-y-5">
      {/* Stat strip */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="전체 상담" value={items.length} icon="wave" color="primary" />
        <Stat label="최근 7일" value={lastWeek} icon="pulse" color="blue" />
        <Stat label="진행 중 후속" value={pendingFollowUps} icon="sprout" color="gold" />
        <Stat label="지연 후속" value={overdueFollowUps} icon="falling" color="danger" />
      </section>

      <div className="flex items-center justify-between">
        <div>
          <p className="micro">최근 상담</p>
          <h2 className="text-foreground mt-0.5 text-[17px] font-bold">상담 기록</h2>
        </div>
        <Button render={<Link href="/consultations/new" />}>
          <EyIcon name="plus" size={13} className="mr-1" />
          상담 추가
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={() => <EyIcon name="wave" size={32} />} title="기록된 상담이 없습니다" />
      ) : (
        <ul className="space-y-2.5">
          {items.map((c) => {
            const urgency = URGENCY_META[followUpUrgency(c.followUpDate, c.followUpDone)];
            const cat = c.category ? CATEGORY_META[c.category] : null;
            const isUrgent =
              urgency &&
              (urgency.color === "danger" || urgency.color === "amber");
            return (
              <li
                key={c.id}
                className={`shadow-card overflow-hidden rounded-2xl border p-5 ${
                  isUrgent ? "border-danger/30 bg-danger-soft" : "border-line bg-card"
                }`}
              >
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Initial
                      name={c.studentName}
                      color={isUrgent ? "danger" : "primary"}
                      size="md"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/students/${c.studentId}`}
                          className="text-foreground text-[15px] font-bold hover:underline"
                        >
                          {c.studentName}
                        </Link>
                        {c.studentGrade ? (
                          <span className="text-text-dim text-xs">{c.studentGrade}</span>
                        ) : null}
                        {cat ? <Pill color={cat.color}>{cat.label}</Pill> : null}
                        {urgency ? <Pill color={urgency.color}>{urgency.label}</Pill> : null}
                      </div>
                      <p className="text-text-dim mt-0.5 text-[11px]">
                        {c.subject ? <span>{c.subject} · </span> : null}
                        {c.counselorName ? <span>{c.counselorName} 상담</span> : null}
                      </p>
                    </div>
                  </div>
                  <div className="text-text-dim flex items-center gap-2 text-xs">
                    <span className="num">{relativeTime(c.consultedAt)}</span>
                    <Link
                      href={`/consultations/${c.id}/edit`}
                      className="text-text-faint hover:text-foreground inline-flex items-center"
                      aria-label="수정"
                    >
                      <EyIcon name="check" size={12} className="rotate-45" />
                    </Link>
                  </div>
                </header>

                <p className="text-foreground mt-3 text-[13px] leading-relaxed">{c.summary}</p>

                {c.followUpAction || c.followUpDate ? (
                  <div className="border-line mt-3 flex items-center justify-between gap-2 border-t pt-3">
                    <p className="text-text-dim text-[11px]">
                      <span className="text-gold font-mono mr-2 font-bold tracking-wider uppercase">
                        Follow-up
                      </span>
                      {c.followUpAction ?? "—"}
                      {c.followUpDate ? (
                        <span className="num text-text-faint ml-2">· 기한 {c.followUpDate}</span>
                      ) : null}
                    </p>
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

function Stat({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: Parameters<typeof EyIcon>[0]["name"];
  color: "primary" | "blue" | "gold" | "danger";
}) {
  const ICON_BG = {
    primary: "bg-primary-soft text-primary",
    blue: "bg-blue-soft text-blue",
    gold: "bg-gold-soft text-gold",
    danger: "bg-danger-soft text-danger",
  } as const;
  return (
    <div className="bg-card border-line shadow-card rounded-2xl border p-4">
      <header className="flex items-center justify-between">
        <p className="micro">{label}</p>
        <span className={`flex size-[26px] items-center justify-center rounded-md ${ICON_BG[color]}`}>
          <EyIcon name={icon} size={13} />
        </span>
      </header>
      <p className="tabular text-foreground mt-2 text-[28px] leading-none">{value}</p>
    </div>
  );
}
