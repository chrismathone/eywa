import { Suspense } from "react";
import { QrCode } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { NewConsultationWatcher } from "./_components/new-consultation-watcher";
import { getConsultationTotalCount } from "@/features/enrollment/server/poll-actions";
import { PhotoCard } from "@/components/atoms/photo-card";
import { MakeeduSyncBadge } from "@/components/makeedu-sync-badge";
import { MakeeduPushCard } from "@/features/integrations/components/makeedu-push-card";
import { getUnpushedIntakeConsultations } from "@/features/integrations/server/makeedu-sync";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import {
  getConsultantOptions,
  getConsultationFilteredCounts,
  getConsultationMinYear,
  getEnrollmentConsultations,
  getEnrollmentConsultationsPage,
} from "@/features/enrollment/server/queries";
import { Pagination } from "@/components/pagination";
import { kstToday } from "@/lib/date-kst";
import { KanbanFilters } from "./_components/kanban-filters";
import { NewEnrollmentTrigger } from "./_components/new-enrollment-trigger";
import { EnrollmentKanban, type KanbanColumn } from "./_components/enrollment-kanban";
import { EnrollmentTable } from "./_components/enrollment-table";
import { IntakeQrSection } from "./_components/intake-qr-section";

export const metadata = { title: "등록상담 — eywa" };

// 전 목록 공통(표·카드) — 변경 시 학생·수납 등 다른 목록과 함께 바꿀 것.
const PAGE_SIZE = 50;

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
    // 🔴 "등록 · 종료"였다 — 원장 지적: "등록"은 수강등록(반 배정), "종료"는 학생의 수강종료/퇴원으로
    // 읽힌다. 실제 뜻은 **상담 파이프라인이 끝난 건**(재원생 등록 결정·거절·노쇼)이고, 그중 반까지
    // 배정된 건은 옆 열로 빠지므로 여기 남는 등록 건은 아직 배정이 없는 것이다.
    key: "closed",
    label: "상담 종료",
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
    page?: string;
  }>;
}) {
  const user = await requireAccess("enrollment");
  const { month, consultant, q, outcome, view: viewParam, page: pageParam } = await searchParams;
  const selectedMonth = month ?? null;
  const selectedConsultant = consultant ?? null;
  const selectedOutcome = outcome ?? null;
  const searchQuery = q?.trim() || null;
  const view: "kanban" | "table" = viewParam === "table" ? "table" : "kanban";
  const page = Math.max(1, Number(pageParam) || 1);
  const filter = {
    month: selectedMonth,
    consultantId: selectedConsultant,
    outcome: selectedOutcome,
    q: searchQuery,
  };

  // makeedu 역동기화 카드 노출 — `integrations` 쓰기 권한(기본 master/admin/manager)일 때만 후보 조회.
  // (권한 판정은 캐시된 매트릭스 재사용 = 추가 쿼리 0. 후보 조회는 권한자에게만 1쿼리, 아래 병렬 B4.)
  const canPushMakeedu = await canWriteTenant(user.systemRole, "integrations");
  // 🔴 뷰마다 **가져오는 양이 다르다**. 목록은 한 페이지(50행)만 — 옛 시트 이관으로 2,251행이 되어
  // 전건 로드는 라운드트립 3회 + 배지 청크 20여 회로 불어난다(B2·B4). 칸반은 열별 집계가 필요해
  // 전건을 유지하되, 그래서 기간 필터 없이 열면 여전히 무겁다(별도 과제).
  const [kanbanItems, tablePage, headerCounts, consultants, minYear, pushCandidates, totalCount] =
    await Promise.all([
      view === "kanban" ? getEnrollmentConsultations(filter) : Promise.resolve(null),
      view === "table" ? getEnrollmentConsultationsPage(filter, page, PAGE_SIZE) : Promise.resolve(null),
      // 헤더 스탯은 페이지가 아니라 **필터 전체** 기준(count만, 행 미수신).
      view === "table" ? getConsultationFilteredCounts(filter) : Promise.resolve(null),
      getConsultantOptions(),
      getConsultationMinYear(),
      canPushMakeedu ? getUnpushedIntakeConsultations() : Promise.resolve([]),
      // 자동 갱신 기준선 — 필터와 무관한 **전체 건수**(head 카운트라 행 미수신). 필터가 걸려 있어도
      // 새 접수가 들어오면 화면을 갱신해야 하므로 필터된 items.length를 기준으로 쓰면 안 된다.
      getConsultationTotalCount(),
    ]);
  const items = kanbanItems ?? [];

  // 상대시간 기준 시각 — 서버·클라 첫 렌더를 같은 기준으로 계산해 하이드레이션 불일치를 없앤다.
  // eslint-disable-next-line react-hooks/purity -- 동적 페이지, 요청당 1회 렌더(intake page 선례)
  const nowMs = Date.now();
  // 월 피커 기준 '이번 달' — KST로 서버에서 확정해 내려보낸다(클라가 자기 시계로 계산하면
  // 자정 근처·해외 접속에서 하이드레이션이 어긋나고 미래 달 비활성화 기준도 흔들린다).
  const todayMonth = kstToday().slice(0, 7);
  const aiDone = items.filter((i) => i.outcome === "ai_done").length;
  // "배정 완료" = 상담 → 수업 배정으로 학생이 생기고 수업이 1개 이상 붙은 진짜 완료(outcome 라벨과 별개).
  const assigned = items.filter((i) => i.assignedClassCount >= 1);
  const assignedIds = new Set(assigned.map((i) => i.id));

  const filterActive = !!selectedMonth || !!selectedConsultant || !!selectedOutcome || !!searchQuery;

  // 필터는 보존하고 page만 갈아끼운다. p===1이면 page= 자체를 안 넣어야 필터 변경 href와 모양이 같아진다
  // (필터·검색·월이동 href는 page를 안 넣으므로 자동으로 1페이지로 리셋된다 — 페이지네이션 표준).
  const pageHref = (p: number): string => {
    const params = new URLSearchParams();
    if (selectedMonth) params.set("month", selectedMonth);
    if (selectedConsultant) params.set("consultant", selectedConsultant);
    if (selectedOutcome) params.set("outcome", selectedOutcome);
    if (searchQuery) params.set("q", searchQuery);
    params.set("view", "table");
    if (p > 1) params.set("page", String(p));
    return `/enrollment?${params.toString()}`;
  };

  const columns: KanbanColumn[] = [
    // outcome 컬럼 — 배정 완료로 옮겨간 카드는 제외(상호배타, 중복 표시 방지).
    ...COLUMNS.map((col) => ({
      key: col.key,
      label: col.label,
      color: col.color,
      cards: items.filter((i) => col.outcomes.includes(i.outcome) && !assignedIds.has(i.id)),
    })),
    // "반 배정 완료" — 옆 열의 "재원생 등록"(상담 결과)과 확실히 갈리게 '반'을 붙인다.
    // 판정도 outcome이 아니라 연결 학생의 상담 과목 수강 여부다(AI 비서 표현과 통일).
    { key: "assigned", label: "반 배정 완료", color: "primary" as const, cards: assigned },
  ];

  return (
    <div className="space-y-5">
      {/* Editorial 문법 ① — eyebrow→헤드라인 + 인라인 스탯 행(시간표 패턴: BigStat 카드 대신 밀도 우선).
          '등록 전환율'(outcome=enrolled 라벨 기반)은 실제 학생 미생성 건까지 세어 과대였음 →
          진짜 완료 지표인 '배정 완료(수업≥1)' 건수 유지(정직). */}
      {/* QR 접수가 들어오면 새로고침 없이 목록이 갱신된다(20초 건수 폴링). 알림 줄은 도착 후에만 렌더. */}
      <NewConsultationWatcher initialCount={totalCount ?? 0} />

      <PageHeader
        eyebrow="등록 상담"
        title="등록상담"
        // 창 컴팩트 라벨 겸용 — 없으면 title 폴백이 창 타이틀바와 중복(적대 리뷰).
        description="접수부터 배정 완료까지 상담 흐름을 관리합니다"
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
              <b className="num text-foreground text-[17px] font-bold">
                {headerCounts ? headerCounts.total : items.length}
              </b>{" "}
              <span className="text-text-dim">{filterActive ? "필터 결과" : "전체"}</span>
            </span>
            <span className="text-[13px]">
              <b className="num text-gold text-[17px] font-bold">
                {headerCounts ? headerCounts.aiDone : aiDone}
              </b>{" "}
              <span className="text-text-dim">AI 분석 완료</span>
            </span>
            {/* '배정 완료'는 연결 학생의 수강까지 봐야 나오는 파생값이라 count 한 방으로 못 센다.
                목록(페이지) 뷰에서 페이지 50행으로 세면 거짓말이 되므로 아예 안 띄운다(#89). */}
            {headerCounts ? null : (
              <span className="text-[13px]">
                <b className="num text-primary text-[17px] font-bold">{assigned.length}</b>{" "}
                <span className="text-text-dim">배정 완료</span>
              </span>
            )}
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
        todayMonth={todayMonth}
        minYear={minYear}
      />

      {/* 역동기화 — makeedu에 아직 없는 QR 접수 상담. 후보가 있을 때만(빈 상태는 owner 연동 면 담당),
          integrations 쓰기 권한자에게만. 처리하면(전송/등록) 사라지는 액션 큐라 보드 위에 노출. */}
      {pushCandidates.length > 0 ? <MakeeduPushCard candidates={pushCandidates} /> : null}

      {/* 빈 상태 판정은 rows.length이 아니라 total === 0 (2페이지가 비어 보이는 것과 진짜 0건은 다르다) */}
      {(view === "table" ? (headerCounts?.total ?? 0) === 0 : items.length === 0) ? (
        <div className="mx-auto max-w-xl py-4">
          <PhotoCard
            src="/photos/enrollment-hero.webp"
            alt=""
            caption="진행 중인 상담이 없습니다"
            sub="QR 공개 접수 또는 신규 등록으로 첫 상담을 시작해 보세요"
            aspect="3/2"
            sizes="(max-width: 768px) 100vw, 576px"
          />
        </div>
      ) : view === "table" && tablePage ? (
        <>
          <EnrollmentTable rows={tablePage.rows} nowMs={nowMs} />
          <Pagination
            page={page}
            totalPages={Math.max(1, Math.ceil(tablePage.total / PAGE_SIZE))}
            total={tablePage.total}
            hrefForPage={pageHref}
          />
        </>
      ) : (
        <EnrollmentKanban columns={columns} nowMs={nowMs} />
      )}
    </div>
  );
}
