import { requireAccess } from "@/lib/auth/require-access";
import { FaceTabs, type Face } from "@/components/face-tabs";
import { getClassnoteQueue, getReportFilterOptions, getWeeklyWritingRates } from "@/features/report-admin/server/queries";
import { getEdutrixUnmapped } from "@/features/report-admin/server/edutrix-map-queries";
import { listReports } from "@/features/report-admin/server/actions";
import { ClassnoteQueueCard } from "./_components/classnote-queue-card";
import { WritingRateCard } from "./_components/writing-rate-card";
import { ReportList } from "./_components/report-list";
import { EdutrixUnmappedCard } from "./_components/edutrix-unmapped-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "수업보고서 — eywa" };

type Sp = Record<string, string | undefined>;
type Tab = "writing" | "unmapped" | "list";

const FACES: Face[] = [
  { key: "writing", label: "작성률", href: "/lesson-reports?tab=writing" },
  { key: "unmapped", label: "미매핑", href: "/lesson-reports?tab=unmapped" },
  { key: "list", label: "목록", href: "/lesson-reports?tab=list" },
];

function resolveTab(sp: Sp): Tab {
  const t = sp.tab;
  if (t === "unmapped" || t === "list" || t === "writing") return t;
  return "writing";
}

/**
 * 수업보고서(발송 관리) — ClassNote 큐는 상단 고정, 작성률·미매핑·목록은 내부 FaceTabs(스크롤 단축).
 * 활성 탭만 무거운 조회(서버 렌더). 강사 작성은 /onescreen.
 */
export default async function LessonReportsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  await requireAccess("lesson_reports");
  const sp = await searchParams;
  const tab = resolveTab(sp);

  // 큐는 전 탭 공통(발송 오버사이트). 나머지는 활성 탭만.
  const queueP = getClassnoteQueue(3);
  const tabP =
    tab === "writing"
      ? getWeeklyWritingRates().then((rates) => ({ rates }))
      : tab === "unmapped"
        ? getEdutrixUnmapped().then((edutrixMap) => ({ edutrixMap }))
        : Promise.all([getReportFilterOptions(), listReports({ page: 0 })]).then(([filterOptions, firstPage]) => ({
            filterOptions,
            initialList: {
              rows: firstPage.rows ?? [],
              total: firstPage.total ?? 0,
              page: firstPage.page ?? 0,
              pageSize: firstPage.pageSize ?? 30,
            },
          }));

  const [queue, tabData] = await Promise.all([queueP, tabP]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="border-border border-b pb-5">
        <p className="eyebrow">수업보고서</p>
        <h1 className="display text-foreground text-2xl">보고서 발송 관리</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          발송 큐는 위에서 상시 확인. 작성률·Edutrix 미매핑·보고서 목록은 탭으로 나눕니다. 작성은 선생님
          원스크린에서 진행합니다.
        </p>
      </header>

      {queue ? (
        <ClassnoteQueueCard view={queue} />
      ) : (
        <p className="text-text-faint text-sm">발송 현황을 불러올 수 없습니다.</p>
      )}

      <FaceTabs faces={FACES} active={tab} ariaLabel="수업보고서 면" />

      {tab === "writing" ? (
        "rates" in tabData && tabData.rates ? (
          <WritingRateCard view={tabData.rates} />
        ) : (
          <p className="text-text-faint text-sm">작성률을 불러올 수 없습니다.</p>
        )
      ) : null}

      {tab === "unmapped" && "edutrixMap" in tabData ? <EdutrixUnmappedCard view={tabData.edutrixMap} /> : null}

      {tab === "list" && "filterOptions" in tabData && "initialList" in tabData ? (
        <ReportList options={tabData.filterOptions} initial={tabData.initialList} />
      ) : null}
    </div>
  );
}
