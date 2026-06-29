import { headers } from "next/headers";
import QRCode from "qrcode";
import { UserPlus } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { MakeeduSyncBadge } from "@/components/makeedu-sync-badge";
import { requireAccess } from "@/lib/auth/require-access";
import { ConsultationTabs } from "../consultations/_components/consultation-tabs";
import {
  getConsultantOptions,
  getEnrollmentConsultations,
  getIntakeTokens,
} from "@/features/enrollment/server/queries";
import { KanbanFilters } from "./_components/kanban-filters";
import { NewEnrollmentTrigger } from "./_components/new-enrollment-trigger";
import { EnrollmentKanban, type KanbanColumn } from "./_components/enrollment-kanban";
import { EnrollmentTable } from "./_components/enrollment-table";
import { IntakeQrButton, type IntakeTokenView } from "./_components/intake-qr-panel";

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
  searchParams: Promise<{
    month?: string;
    consultant?: string;
    q?: string;
    outcome?: string;
    view?: string;
  }>;
}) {
  await requireAccess("enrollment");
  const { month, consultant, q, outcome, view: viewParam } = await searchParams;
  const selectedMonth = month ?? null;
  const selectedConsultant = consultant ?? null;
  const selectedOutcome = outcome ?? null;
  const searchQuery = q?.trim() || null;
  const view: "kanban" | "table" = viewParam === "table" ? "table" : "kanban";

  const [items, consultants, tokens] = await Promise.all([
    getEnrollmentConsultations({
      month: selectedMonth,
      consultantId: selectedConsultant,
      outcome: selectedOutcome,
      q: searchQuery,
    }),
    getConsultantOptions(),
    getIntakeTokens(),
  ]);

  // 공개 접수 토큰 → 현재 origin 기준 공개 URL + QR SVG(서버 생성, 클라 canvas 불요).
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const origin = `${proto}://${host}`;
  const tokenViews: IntakeTokenView[] = await Promise.all(
    tokens.map(async (t) => {
      const url = `${origin}/intake/${t.token}`;
      return {
        id: t.id,
        name: t.name,
        url,
        qrSvg: await QRCode.toString(url, { type: "svg", margin: 1 }),
        isActive: t.isActive,
        usageCount: t.usageCount,
        submissionCount: t.submissionCount,
        expiresAt: t.expiresAt,
      };
    }),
  );

  const aiDone = items.filter((i) => i.outcome === "ai_done").length;
  const enrolled = items.filter((i) => i.outcome === "enrolled").length;
  const conversionRate = items.length > 0 ? ((enrolled / items.length) * 100).toFixed(0) : "0";

  const filterActive = !!selectedMonth || !!selectedConsultant || !!selectedOutcome || !!searchQuery;

  const columns: KanbanColumn[] = COLUMNS.map((col) => ({
    key: col.key,
    label: col.label,
    color: col.color,
    cards: items.filter((i) => col.outcomes.includes(i.outcome)),
  }));

  return (
    <div className="space-y-4">
      <MakeeduSyncBadge domain="prospects" />
      <ConsultationTabs active="enrollment" />
      {/* 상단 헤더 — 통계 + 신규등록 (기존 AI 그래픽 배너 제거, 통계만 유지) */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-text-dim text-[13px]">
          {filterActive
            ? `필터 적용 ${items.length}건 · AI 완료 ${aiDone}건 · 전환율 ${conversionRate}%`
            : `전체 ${items.length}건 · AI 분석 완료 ${aiDone}건 · 등록 전환율 ${conversionRate}%`}
        </p>
        <div className="flex items-center gap-2">
          <IntakeQrButton tokens={tokenViews} />
          <NewEnrollmentTrigger />
        </div>
      </header>

      <KanbanFilters
        selectedMonth={selectedMonth}
        selectedConsultant={selectedConsultant}
        selectedOutcome={selectedOutcome}
        searchQuery={searchQuery}
        view={view}
        consultants={consultants}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={() => <UserPlus size={32} strokeWidth={1.5} />}
          title="진행 중인 상담이 없습니다"
        />
      ) : view === "table" ? (
        <EnrollmentTable rows={items} />
      ) : (
        <EnrollmentKanban columns={columns} />
      )}
    </div>
  );
}
