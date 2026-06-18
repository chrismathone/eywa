import { UserPlus } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getConsultantOptions,
  getEnrollmentConsultations,
} from "@/features/enrollment/server/queries";
import { KanbanFilters } from "./_components/kanban-filters";
import { NewEnrollmentTrigger } from "./_components/new-enrollment-trigger";
import { EnrollmentKanban, type KanbanColumn } from "./_components/enrollment-kanban";

export const metadata = { title: "등록상담 — eywa" };

const COLUMNS: {
  key: string;
  label: string;
  outcomes: string[];
  color: KanbanColumn["color"];
}[] = [
  { key: "queue", label: "대기 · 예약", outcomes: ["pending", "scheduled"], color: "amber" },
  { key: "consulted", label: "상담 완료", outcomes: ["consulted"], color: "blue" },
  { key: "ai_done", label: "AI 분석 완료", outcomes: ["ai_done"], color: "primary" },
  {
    key: "closed",
    label: "등록 · 종료",
    outcomes: ["enrolled", "declined", "no_show"],
    color: "neutral",
  },
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

  const columns: KanbanColumn[] = COLUMNS.map((col) => ({
    key: col.key,
    label: col.label,
    color: col.color,
    cards: items.filter((i) => col.outcomes.includes(i.outcome)),
  }));

  return (
    <div className="space-y-4">
      {/* 상단 헤더 — 통계 + 신규등록 (기존 AI 그래픽 배너 제거, 통계만 유지) */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-text-dim text-[13px]">
          {filterActive
            ? `필터 적용 ${items.length}건 · AI 완료 ${aiDone}건 · 전환율 ${conversionRate}%`
            : `전체 ${items.length}건 · AI 분석 완료 ${aiDone}건 · 등록 전환율 ${conversionRate}%`}
        </p>
        <NewEnrollmentTrigger />
      </header>

      <KanbanFilters
        selectedMonth={selectedMonth}
        selectedConsultant={selectedConsultant}
        consultants={consultants}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={() => <UserPlus size={32} strokeWidth={1.5} />}
          title="진행 중인 상담이 없습니다"
        />
      ) : (
        <EnrollmentKanban columns={columns} />
      )}
    </div>
  );
}
