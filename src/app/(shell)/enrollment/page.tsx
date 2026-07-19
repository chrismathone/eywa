import { Suspense } from "react";
import { QrCode, UserPlus } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { MakeeduSyncBadge } from "@/components/makeedu-sync-badge";
import { MakeeduPushCard } from "@/features/integrations/components/makeedu-push-card";
import { getUnpushedIntakeConsultations } from "@/features/integrations/server/makeedu-sync";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import {
  getConsultantOptions,
  getEnrollmentConsultations,
} from "@/features/enrollment/server/queries";
import { KanbanFilters } from "./_components/kanban-filters";
import { NewEnrollmentTrigger } from "./_components/new-enrollment-trigger";
import { EnrollmentKanban, type KanbanColumn } from "./_components/enrollment-kanban";
import { EnrollmentTable } from "./_components/enrollment-table";
import { IntakeQrSection } from "./_components/intake-qr-section";

export const metadata = { title: "등록상담 — eywa" };

// outcome 기반 4컬럼 + 파생 5번째 "배정 완료"(수업≥1). 배정 완료는 outcome이 아니라
// 연결 학생의 미종료 수강 수(assignedClassCount)로 판정하므로 build 단계에서 별도 추가(상호배타).
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
  const user = await requireAccess("enrollment");
  const { month, consultant, q, outcome, view: viewParam } = await searchParams;
  const selectedMonth = month ?? null;
  const selectedConsultant = consultant ?? null;
  const selectedOutcome = outcome ?? null;
  const searchQuery = q?.trim() || null;
  const view: "kanban" | "table" = viewParam === "table" ? "table" : "kanban";

  // makeedu 역동기화 카드 노출 — `integrations` 쓰기 권한(기본 master/admin/manager)일 때만 후보 조회.
  // (권한 판정은 캐시된 매트릭스 재사용 = 추가 쿼리 0. 후보 조회는 권한자에게만 1쿼리, 아래 병렬 B4.)
  const canPushMakeedu = await canWriteTenant(user.systemRole, "integrations");
  const [items, consultants, pushCandidates] = await Promise.all([
    getEnrollmentConsultations({
      month: selectedMonth,
      consultantId: selectedConsultant,
      outcome: selectedOutcome,
      q: searchQuery,
    }),
    getConsultantOptions(),
    canPushMakeedu ? getUnpushedIntakeConsultations() : Promise.resolve([]),
  ]);

  const aiDone = items.filter((i) => i.outcome === "ai_done").length;
  // "배정 완료" = 상담 → 수업 배정으로 학생이 생기고 수업이 1개 이상 붙은 진짜 완료(outcome 라벨과 별개).
  const assigned = items.filter((i) => i.assignedClassCount >= 1);
  const assignedIds = new Set(assigned.map((i) => i.id));

  const filterActive = !!selectedMonth || !!selectedConsultant || !!selectedOutcome || !!searchQuery;

  const columns: KanbanColumn[] = [
    // outcome 컬럼 — 배정 완료로 옮겨간 카드는 제외(상호배타, 중복 표시 방지).
    ...COLUMNS.map((col) => ({
      key: col.key,
      label: col.label,
      color: col.color,
      cards: items.filter((i) => col.outcomes.includes(i.outcome) && !assignedIds.has(i.id)),
    })),
    { key: "assigned", label: "배정 완료", color: "primary" as const, cards: assigned },
  ];

  return (
    <div className="space-y-5">
      {/* Editorial 문법 ① — eyebrow→헤드라인 + 인라인 스탯 행(시간표 패턴: BigStat 카드 대신 밀도 우선).
          '등록 전환율'(outcome=enrolled 라벨 기반)은 실제 학생 미생성 건까지 세어 과대였음 →
          진짜 완료 지표인 '배정 완료(수업≥1)' 건수 유지(정직). */}
      <PageHeader
        eyebrow="등록 상담"
        title="등록상담"
        actions={
          <>
            <Suspense
              fallback={
                <Button variant="outline" size="sm" disabled>
                  <QrCode className="size-4" />
                  공개 접수 QR
                </Button>
              }
            >
              <IntakeQrSection />
            </Suspense>
            <NewEnrollmentTrigger />
          </>
        }
        stats={
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 px-1 whitespace-nowrap">
            <span className="text-[13px]">
              <b className="num text-foreground text-[17px] font-extrabold">{items.length}</b>{" "}
              <span className="text-text-dim">{filterActive ? "필터 결과" : "전체"}</span>
            </span>
            <span className="text-[13px]">
              <b className="num text-gold text-[17px] font-extrabold">{aiDone}</b>{" "}
              <span className="text-text-dim">AI 분석 완료</span>
            </span>
            <span className="text-[13px]">
              <b className="num text-primary text-[17px] font-extrabold">{assigned.length}</b>{" "}
              <span className="text-text-dim">배정 완료</span>
            </span>
          </div>
        }
      />
      <MakeeduSyncBadge domain="prospects" />

      <KanbanFilters
        selectedMonth={selectedMonth}
        selectedConsultant={selectedConsultant}
        selectedOutcome={selectedOutcome}
        searchQuery={searchQuery}
        view={view}
        consultants={consultants}
      />

      {/* 역동기화 — makeedu에 아직 없는 QR 접수 상담. 후보가 있을 때만(빈 상태는 owner 연동 면 담당),
          integrations 쓰기 권한자에게만. 처리하면(전송/등록) 사라지는 액션 큐라 보드 위에 노출. */}
      {pushCandidates.length > 0 ? <MakeeduPushCard candidates={pushCandidates} /> : null}

      {items.length === 0 ? (
        <EmptyState
          image="enrollment"
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
