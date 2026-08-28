import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { PageHeader } from "@/components/page-header";
import { FaceTabs, type Face } from "@/components/face-tabs";
import { getClassnoteQueue, getReportFilterOptions, getWeeklyWritingRates, getReportTeacherCandidates } from "@/features/report-admin/server/queries";
import { getBoardRosterCheck } from "@/features/report-admin/server/board-roster-queries";
import { listReports } from "@/features/report-admin/server/actions";
import { defaultReportFilters } from "@/features/report-admin/report-filters";
import { kstToday } from "@/lib/date-kst";
import { getNoticeClassOptions, listClassNotices } from "@/features/report-admin/server/notice-actions";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getStudentsList } from "@/features/students/server/queries";
import { getActivePrompts } from "@/features/onescreen/server/prompt-actions";
import { ClassnoteQueueCard } from "./_components/classnote-queue-card";
import { WritingRateCard } from "./_components/writing-rate-card";
import { ReportList } from "./_components/report-list";
import { RecallFace } from "./_components/recall-face";
import { ComposeTab } from "./_components/compose-tab";
import { NoticeFace } from "./_components/notice-face";
import { BoardRosterCard } from "./_components/board-roster-card";
import { ReportSection } from "@/app/(shell)/owner/_components/report-section";
import { AiMentSection } from "@/app/(shell)/owner/_components/ai-ment-section";

export const dynamic = "force-dynamic";
export const metadata = { title: "수업보고서 — eywa" };

/**
 * ⚠️ 서버 액션은 **호출된 세그먼트의 maxDuration**을 따른다 — 직접발송 면의 자동작성
 * (`generateReportComment`)이 폴백을 타면 기본값(15초)에서 잘려 멘트가 템플릿으로 떨어진다([[#118]]).
 * 원스크린 세그먼트와 같은 이유·같은 값(실측치는 그쪽 주석).
 */
export const maxDuration = 300;

type Sp = Record<string, string | undefined>;
// 관리 5면(작성률·반 구성·목록·공지·직접발송) + 설정 2면(보고서 표시·AI 멘트, owner 쓰기 권한 있을 때만).
// (미매핑 탭은 2026-07-29 제거 — Edutrix 소등으로 원본이 사라져 매핑 자체가 불가능해졌다.)
type Tab = "writing" | "boards" | "list" | "notice" | "compose" | "recall" | "report" | "ai_ment";

// 설정 2탭(report·ai_ment)은 saveOwnerSection/savePrompt가 owner 쓰기 게이트라 — owner를 못 쓰는
// 계정(위임 안 받은 admin/manager)에겐 폼을 보여주면 '저장 거부'가 된다. canOwner일 때만 탭을 노출.
// 직접 발송(compose)은 lesson_reports 쓰기 권한(canSend) 있을 때만(관리자 발송).
function resolveTab(sp: Sp, canOwner: boolean, canSend: boolean): Tab {
  const t = sp.tab;
  if (t === "list" || t === "writing" || t === "notice" || t === "boards") return t;
  // 회수(recall)는 **되돌릴 수 없는 파괴적 동작**이라 발송과 같은 쓰기 게이트(canSend)로 잠근다.
  // 서버 액션(requestReportRecall)이 최종 게이트 — 탭을 숨기는 건 게이트가 아니다(#77).
  if ((t === "compose" || t === "recall") && canSend) return t;
  if ((t === "report" || t === "ai_ment") && canOwner) return t;
  return "writing";
}

/**
 * 수업보고서(발송 관리) — ClassNote 큐는 관리 탭 상단 고정, 작성률·반 구성·목록은 내부 FaceTabs(스크롤 단축).
 * 보고서 표시·AI 멘트 설정(옛 학원설정 두 탭)은 뒤에 붙여 5탭 — owner 쓰기 권한이 있을 때만. 강사 작성은 /onescreen.
 * 활성 탭만 무거운 조회(서버 렌더).
 */
export default async function LessonReportsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const viewer = await requireAccess("lesson_reports");
  const [canOwner, canSendReports] = await Promise.all([
    canWriteTenant(viewer.systemRole, "owner"),
    canWriteTenant(viewer.systemRole, "lesson_reports"), // 목록 탭 관리자 발송 열 노출(viewer는 열람만)
  ]);
  const sp = await searchParams;
  const tab = resolveTab(sp, canOwner, canSendReports);
  const isSettings = tab === "report" || tab === "ai_ment";

  const FACES: Face[] = [
    { key: "writing", label: "작성률", href: "/lesson-reports?tab=writing", group: "관리" },
    { key: "boards", label: "반 구성", href: "/lesson-reports?tab=boards", group: "관리" },
    { key: "list", label: "목록", href: "/lesson-reports?tab=list", group: "관리" },
    { key: "notice", label: "반 공지", href: "/lesson-reports?tab=notice", group: "관리" },
    ...(canSendReports
      ? ([
          { key: "compose", label: "직접 발송", href: "/lesson-reports?tab=compose", group: "관리" },
          { key: "recall", label: "회수", href: "/lesson-reports?tab=recall", group: "관리" },
        ] as Face[])
      : []),
    ...(canOwner
      ? ([
          { key: "report", label: "보고서 설정", href: "/lesson-reports?tab=report", group: "설정" },
          { key: "ai_ment", label: "AI 멘트", href: "/lesson-reports?tab=ai_ment", group: "설정" },
        ] as Face[])
      : []),
  ];

  // 큐는 관리 탭 공통(발송 오버사이트). 설정 탭에선 미표시(부하 0). 나머지는 활성 탭만.
  const queueP = isSettings ? Promise.resolve(null) : getClassnoteQueue(3);
  const tabP =
    tab === "writing"
      ? // 범위 = 기본 이번 주, `?rmonth=YYYY-MM`이면 그 달(월간 매트릭스). 파라미터 하나로 같은 쿼리를 재사용.
        getWeeklyWritingRates(/^\d{4}-\d{2}$/.test(sp.rmonth ?? "") ? sp.rmonth : undefined).then((rates) => ({
          rates,
        }))
      : tab === "boards"
          ? getBoardRosterCheck().then((boardRoster) => ({ boardRoster }))
        : tab === "report"
          ? Promise.all([getTenantSettings(), getReportTeacherCandidates()]).then(([settings, cand]) => ({
              reportSettings: settings.report,
              teachers: cand.bySubject,
              staffNames: cand.staffNames,
            }))
          : tab === "notice"
            ? Promise.all([getNoticeClassOptions(), listClassNotices()]).then(([cls, notices]) => ({
                noticeClasses: cls.classes ?? [],
                noticeRows: notices.rows ?? [],
              }))
          : tab === "compose"
            ? Promise.all([getStudentsList({ status: "enrolled" }), getTenantSettings(), getNoticeClassOptions()]).then(
                ([rows, settings, cls]) => ({
                  composeStudents: rows.map((s) => ({ id: s.id, name: s.name, school: s.school, grade: s.grade })),
                  composeClasses: cls.classes ?? [],
                  composeSendEnabled: settings.report.classnoteSendEnabled,
                  composeShowDailyTest: settings.report.showDailyTest,
                  composeShowCheckTest: settings.report.showCheckTest,
                  composeShowAttachments: settings.report.showAttachments,
                }),
              )
          : tab === "recall"
            ? // 회수는 **검색해서 찾는** 화면이라 첫 페인트에 목록을 싣지 않는다(전건을 띄우면 오클릭 거리만 는다).
              getReportFilterOptions().then((filterOptions) => ({ recallOptions: filterOptions }))
          : tab === "ai_ment"
            ? getActivePrompts().then((r) => ({ aiPrompts: r.prompts ?? [] }))
            : // 첫 페인트도 클라 초기 state와 **같은 기본 범위**(이번 달)로 — 안 맞추면 열자마자 목록이 한 번 바뀐다.
              Promise.all([getReportFilterOptions(), listReports(defaultReportFilters(kstToday()))]).then(([filterOptions, firstPage]) => ({
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
      {/* 수제 헤더 → PageHeader 수렴(2026-07-19) — 창(embed)에선 컴팩트 1행으로 접힌다(제목은 창 타이틀바). */}
      <PageHeader
        eyebrow="발송 관리"
        title="수업보고서"
        description="발송 큐는 위에서 상시 확인. 작성률·반 구성·보고서 목록은 탭으로 나눕니다. 작성은 선생님 원스크린에서 진행합니다."
      />

      {!isSettings ? (
        queue ? (
          <ClassnoteQueueCard view={queue} />
        ) : (
          <p className="text-text-faint text-sm">발송 현황을 불러올 수 없습니다.</p>
        )
      ) : null}

      <FaceTabs faces={FACES} active={tab} ariaLabel="수업보고서 면" />

      {tab === "writing" ? (
        "rates" in tabData && tabData.rates ? (
          <WritingRateCard view={tabData.rates} />
        ) : (
          <p className="text-text-faint text-sm">작성률을 불러올 수 없습니다.</p>
        )
      ) : null}

      {tab === "boards" && "boardRoster" in tabData ? (
        tabData.boardRoster ? (
          <BoardRosterCard view={tabData.boardRoster} />
        ) : (
          <p className="text-text-faint text-sm">반 구성을 불러올 수 없습니다.</p>
        )
      ) : null}

      {tab === "list" && "filterOptions" in tabData && "initialList" in tabData ? (
        <ReportList options={tabData.filterOptions} initial={tabData.initialList} canSend={canSendReports} todayYmd={kstToday()} />
      ) : null}

      {tab === "recall" && "recallOptions" in tabData ? (
        <RecallFace options={tabData.recallOptions} todayYmd={kstToday()} />
      ) : null}

      {tab === "notice" && "noticeClasses" in tabData && "noticeRows" in tabData ? (
        <NoticeFace classes={tabData.noticeClasses} initial={tabData.noticeRows} canSend={canSendReports} />
      ) : null}

      {tab === "compose" && "composeStudents" in tabData ? (
        <ComposeTab
          students={tabData.composeStudents}
          classes={tabData.composeClasses}
          sendEnabled={tabData.composeSendEnabled}
          showDailyTest={tabData.composeShowDailyTest}
          showCheckTest={tabData.composeShowCheckTest}
          showAttachments={tabData.composeShowAttachments}
        />
      ) : null}

      {tab === "report" && "reportSettings" in tabData ? (
        <ReportSection initial={tabData.reportSettings} teachers={tabData.teachers} staffNames={tabData.staffNames} />
      ) : null}

      {tab === "ai_ment" && "aiPrompts" in tabData ? <AiMentSection initial={tabData.aiPrompts} /> : null}
    </div>
  );
}
