import Link from "next/link";
import { WindowLink } from "@/components/workspace/window-link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Initial } from "@/components/atoms/initial";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import {
  followUpUrgency,
  getStudentConsultations,
  getStudentOptionsForConsultation,
  type FollowUpUrgency,
  type StudentConsultationCategory,
} from "@/features/consultations/server/queries";
import { getTeacherOptions } from "@/features/students/server/queries";
import { NewConsultationTrigger } from "./_components/new-consultation-trigger";

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

type RangeKey = "all" | "7d" | "30d";
type CategoryKey = "all" | StudentConsultationCategory;
type UrgencyKey = "all" | "overdue" | "today" | "soon" | "later" | "done";

const RANGE_FILTERS: { key: RangeKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "7d", label: "최근 7일" },
  { key: "30d", label: "최근 30일" },
];

const CATEGORY_FILTERS: { key: CategoryKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "academic", label: "학습" },
  { key: "emotional", label: "정서" },
  { key: "career", label: "진로" },
  { key: "social", label: "교우" },
  { key: "general", label: "일반" },
  { key: "other", label: "기타" },
];

const URGENCY_FILTERS: { key: UrgencyKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "overdue", label: "지연" },
  { key: "today", label: "오늘" },
  { key: "soon", label: "3일 내" },
  { key: "later", label: "예정" },
  { key: "done", label: "완료" },
];

function buildHref(p: { range: RangeKey; cat: CategoryKey; urg: UrgencyKey; q: string }): string {
  const sp = new URLSearchParams();
  if (p.range !== "all") sp.set("range", p.range);
  if (p.cat !== "all") sp.set("cat", p.cat);
  if (p.urg !== "all") sp.set("urg", p.urg);
  if (p.q) sp.set("q", p.q);
  const s = sp.toString();
  return s ? `/consultations?${s}` : "/consultations";
}

export default async function ConsultationsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: RangeKey; cat?: CategoryKey; urg?: UrgencyKey; q?: string }>;
}) {
  await requireAccess("consultations");
  const sp = await searchParams;
  const range: RangeKey = (sp.range as RangeKey) ?? "all";
  const cat: CategoryKey = (sp.cat as CategoryKey) ?? "all";
  const urg: UrgencyKey = (sp.urg as UrgencyKey) ?? "all";
  const q = sp.q ?? "";

  const [all, students, counselors] = await Promise.all([
    getStudentConsultations(),
    getStudentOptionsForConsultation(),
    getTeacherOptions(),
  ]);
  let items = all;
  if (q) {
    const term = q.toLowerCase();
    items = items.filter(
      (i) =>
        i.studentName.toLowerCase().includes(term) ||
        i.summary.toLowerCase().includes(term),
    );
  }
  if (range !== "all") {
    // eslint-disable-next-line react-hooks/purity -- server component renders once per request
    const cutoff = Date.now() - (range === "7d" ? 7 : 30) * 86_400_000;
    items = items.filter((i) => new Date(i.consultedAt).getTime() > cutoff);
  }
  if (cat !== "all") items = items.filter((i) => i.category === cat);
  if (urg !== "all") items = items.filter((i) => followUpUrgency(i.followUpDate, i.followUpDone) === urg);

  // eslint-disable-next-line react-hooks/purity -- server component renders once per request
  const cutoff = Date.now() - 7 * 86_400_000;
  const lastWeek = all.filter((i) => new Date(i.consultedAt).getTime() > cutoff).length;
  const pendingFollowUps = all.filter((i) => !i.followUpDone && i.followUpDate).length;
  const overdueFollowUps = all.filter(
    (i) => followUpUrgency(i.followUpDate, i.followUpDone) === "overdue",
  ).length;

  const current = { range, cat, urg, q };

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="전체 상담" value={all.length} icon="wave" color="primary" />
        <Stat label="최근 7일" value={lastWeek} icon="pulse" color="blue" />
        <Stat label="진행 중 후속" value={pendingFollowUps} icon="sprout" color="gold" />
        <Stat label="지연 후속" value={overdueFollowUps} icon="falling" color="danger" />
      </section>

      {/* Filter bar */}
      <div className="bg-card border-line shadow-card space-y-3 rounded-md border px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">기간</span>
            {RANGE_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildHref({ ...current, range: f.key })}
                className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                  range === f.key
                    ? "border-foreground bg-foreground text-background font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <span className="bg-line h-4 w-px" aria-hidden />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">카테고리</span>
            {CATEGORY_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildHref({ ...current, cat: f.key })}
                className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                  cat === f.key
                    ? "border-primary bg-primary text-primary-foreground font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">후속</span>
            {URGENCY_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildHref({ ...current, urg: f.key })}
                className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                  urg === f.key
                    ? "border-foreground bg-foreground text-background font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <form action="/consultations" method="get" className="ml-auto flex items-center gap-2">
            {range !== "all" ? <input type="hidden" name="range" value={range} /> : null}
            {cat !== "all" ? <input type="hidden" name="cat" value={cat} /> : null}
            {urg !== "all" ? <input type="hidden" name="urg" value={urg} /> : null}
            <div className="border-line bg-bg-soft text-text-dim flex items-center gap-2 rounded-sm border px-2.5 py-1.5">
              <EyIcon name="search" size={13} />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="학생명·요약"
                className="text-foreground placeholder:text-text-faint w-32 bg-transparent text-xs focus:outline-none"
              />
            </div>
            <Button type="submit" variant="outline" size="sm">
              검색
            </Button>
          </form>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="micro">
          결과 <span className="text-foreground font-bold">{items.length}</span>건
        </p>
        <div className="flex items-center gap-2">
          <WindowLink
            href="/consultations/stats"
            title="상담 통계"
            className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition"
          >
            <EyIcon name="rings" size={13} />
            통계 보기
          </WindowLink>
          <NewConsultationTrigger students={students} counselors={counselors} />
        </div>
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
                        <WindowLink
                          href={`/students/${c.studentId}`}
                          title={c.studentName}
                          className="text-foreground text-[15px] font-bold hover:underline"
                        >
                          {c.studentName}
                        </WindowLink>
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
                    <WindowLink
                      href={`/consultations/${c.id}/edit`}
                      title="상담 수정"
                      ariaLabel="수정"
                      className="text-text-faint hover:text-foreground inline-flex items-center"
                    >
                      <EyIcon name="check" size={12} className="rotate-45" />
                    </WindowLink>
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
