import { EyIcon } from "@/components/icons/eywa-icons";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getConsultantOptions,
  getEnrollmentConsultations,
} from "@/features/enrollment/server/queries";
import { KanbanFilters } from "./_components/kanban-filters";
import { NewEnrollmentTrigger } from "./_components/new-enrollment-trigger";
import { ColumnCards } from "./_components/column-cards";

export const metadata = { title: "신입생 등록상담 — eywa" };

const COLUMNS: {
  key: string;
  label: string;
  outcomes: string[];
  color: "amber" | "blue" | "primary" | "neutral";
  icon: Parameters<typeof EyIcon>[0]["name"];
}[] = [
  { key: "queue", label: "대기 · 예약", outcomes: ["pending", "scheduled"], color: "amber", icon: "sprout" },
  { key: "consulted", label: "상담 완료", outcomes: ["consulted"], color: "blue", icon: "wave" },
  { key: "ai_done", label: "AI 분석 완료", outcomes: ["ai_done"], color: "primary", icon: "sparkle" },
  { key: "closed", label: "등록 · 종료", outcomes: ["enrolled", "declined", "no_show"], color: "neutral", icon: "check" },
];

export default async function EnrollmentPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; consultant?: string }>;
}) {
  await requireAccess("enrollment");
  const { month, consultant } = await searchParams;
  const selectedMonth = month ?? null;
  const selectedConsultant = consultant ?? null;

  const [items, consultants] = await Promise.all([
    getEnrollmentConsultations({
      month: selectedMonth,
      consultantId: selectedConsultant,
    }),
    getConsultantOptions(),
  ]);

  const aiDone = items.filter((i) => i.outcome === "ai_done").length;
  const enrolled = items.filter((i) => i.outcome === "enrolled").length;
  const conversionRate = items.length > 0 ? ((enrolled / items.length) * 100).toFixed(0) : "0";

  const filterActive = !!selectedMonth || !!selectedConsultant;

  return (
    <div className="space-y-4">
      {/* AI 배너 — gradient + sparkle */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-[#2a7a52] p-6 shadow-primary-deep">
        {/* 우상단 동심원 SVG 장식 */}
        <svg
          className="pointer-events-none absolute top-0 right-0 opacity-[0.18]"
          width="200"
          height="200"
          viewBox="0 0 200 200"
          aria-hidden="true"
        >
          {[90, 70, 50, 30].map((r) => (
            <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="#fff" strokeWidth="1" />
          ))}
        </svg>
        <div className="relative flex items-start gap-4">
          <span className="flex size-[52px] shrink-0 items-center justify-center rounded-[4px] bg-white/18 text-white">
            <EyIcon name="sparkle" size={24} />
          </span>
          <div className="min-w-0 flex-1 text-white">
            <p className="font-mono text-[11px] tracking-wider uppercase text-[#e9c876]">
              POWERED BY CLAUDE
            </p>
            <h1 className="mt-1 text-[17px] font-extrabold leading-snug">
              AI가 등록상담을 듣고, 학습 스타일을 정리합니다.
            </h1>
            <p className="mt-2 text-[13px] text-white/85">
              {filterActive
                ? `필터 적용 ${items.length}건 · AI 완료 ${aiDone}건 · 전환율 ${conversionRate}%`
                : `전체 ${items.length}건 · AI 분석 완료 ${aiDone}건 · 등록 전환율 ${conversionRate}%`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-white/15 px-2.5 py-1 font-mono text-[11px] font-bold text-white">
              이번달 {items.length}회
            </span>
            <NewEnrollmentTrigger />
          </div>
        </div>
      </section>

      <KanbanFilters
        selectedMonth={selectedMonth}
        selectedConsultant={selectedConsultant}
        consultants={consultants}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={() => <EyIcon name="sprout" size={32} />}
          title="진행 중인 상담이 없습니다"
        />
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const cards = items.filter((i) => col.outcomes.includes(i.outcome));
            const ICON_BG = {
              primary: "bg-primary-soft text-primary",
              blue: "bg-blue-soft text-blue",
              amber: "bg-amber-soft text-amber",
              neutral: "bg-bg-soft text-text-dim",
            } as const;
            return (
              <div
                key={col.key}
                className="bg-card border-line shadow-card flex min-h-[300px] flex-col rounded-2xl border"
              >
                <header className="border-line flex items-center justify-between border-b px-4 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <span className={`flex size-[26px] items-center justify-center rounded-md ${ICON_BG[col.color]}`}>
                      <EyIcon name={col.icon} size={13} />
                    </span>
                    <h3 className="text-foreground text-[13px] font-bold">{col.label}</h3>
                  </div>
                  <span className="text-text-faint num font-mono text-[11px]">{cards.length}건</span>
                </header>
                {cards.length === 0 ? (
                  <div className="text-text-faint flex flex-1 items-center justify-center px-4 text-xs">
                    없음
                  </div>
                ) : (
                  <ColumnCards cards={cards} color={col.color} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
