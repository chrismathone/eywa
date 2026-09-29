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
import { listClassWideNotices } from "@/features/report-admin/server/class-notice-actions";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getStudentsList } from "@/features/students/server/queries";
import { getActivePrompts } from "@/features/onescreen/server/prompt-actions";
import { getMentStyleRows } from "@/features/onescreen/server/ment-style-actions";
import { ClassnoteQueueCard } from "./_components/classnote-queue-card";
import { WritingRateCard } from "./_components/writing-rate-card";
import { ReportList } from "./_components/report-list";
import { RecallFace } from "./_components/recall-face";
import { ComposeTab } from "./_components/compose-tab";
import { NoticeFace } from "./_components/notice-face";
import { BoardRosterCard } from "./_components/board-roster-card";
import { ReportSection } from "@/app/(shell)/owner/_components/report-section";
import { AiMentSection } from "@/app/(shell)/owner/_components/ai-ment-section";
import { isModuleEnabled } from "@/lib/modules";
import { isFeatureLicensed } from "@/lib/license/server";
import { classnoteSendOn } from "@/features/owner/classnote-gate";

export const dynamic = "force-dynamic";
export const metadata = { title: "수업보고서 — 에이와" };

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
// ClassNote 발송 PC에 기대는 면 — ClassNote 모듈이 꺼진 학원(새 학원 기본)에선 세우지 않는다(2026-09-22 방향 B).
const CLASSNOTE_TABS: ReadonlySet<Tab> = new Set<Tab>(["boards", "notice", "compose", "recall"]);

function resolveTab(sp: Sp, canOwner: boolean, canSend: boolean, classnoteOn: boolean, aiOn: boolean): Tab {
  const t = sp.tab;
  if (!classnoteOn && t && CLASSNOTE_TABS.has(t as Tab)) return "writing";
  // AI 라이선스가 꺼진 지점엔 'AI 멘트' 면이 없다(2026-09-30 "꺼지면 흔적 없이").
  if (!aiOn && t === "ai_ment") return "writing";
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
  // ClassNote 모듈 — 꺼진 학원은 발송 콘솔(큐·반 구성·반 공지·직접 발송·회수)을 세우지 않는다. 침산은 켜져 있어 종전과 같다.
  // 요청 캐시라 아래 면별 조회의 getTenantSettings와 같은 조회를 나눠 쓴다.
  const [tenantSettings, aiOn] = await Promise.all([getTenantSettings(), isFeatureLicensed(viewer.tenantId, "ai_analysis")]);
  const classnoteOn = isModuleEnabled(tenantSettings.modules.disabled, "classnote");
  const tab = resolveTab(sp, canOwner, canSendReports, classnoteOn, aiOn);
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
  ].filter((f) => classnoteOn || !CLASSNOTE_TABS.has(f.key as Tab));
  FACES.push(
    ...(canOwner
      ? ([
          { key: "report", label: "보고서 설정", href: "/lesson-reports?tab=report", group: "설정" },
          ...(aiOn ? [{ key: "ai_ment", label: "AI 멘트", href: "/lesson-reports?tab=ai_ment", group: "설정" }] : []),
        ] as Face[])
      : []),
  );

  // 큐는 관리 탭 공통(발송 오버사이트). 설정 탭에선 미표시(부하 0). 나머지는 활성 탭만.
  const queueP = isSettings || !classnoteOn ? Promise.resolve(null) : getClassnoteQueue(3);
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
            ? Promise.all([getNoticeClassOptions(), listClassNotices(), listClassWideNotices()]).then(([cls, notices, wide]) => ({
                noticeClasses: cls.classes ?? [],
                noticeRows: notices.rows ?? [],
                // 반 단체 공지(0304a) — 표가 없거나 실패하면 빈 값(원생 개별 공지 화면은 그대로 산다).
                classWide: { rows: wide.rows ?? [], boardClassIds: wide.boardClassIds ?? [] },
              }))
          : tab === "compose"
            ? Promise.all([getStudentsList({ status: "enrolled" }), getTenantSettings(), getNoticeClassOptions()]).then(
                ([rows, settings, cls]) => ({
                  composeStudents: rows.map((s) => ({ id: s.id, name: s.name, school: s.school, grade: s.grade })),
                  composeClasses: cls.classes ?? [],
                  composeSendEnabled: classnoteSendOn(settings),
                  composeShowDailyTest: settings.report.showDailyTest,
                  composeShowCheckTest: settings.report.showCheckTest,
                  composeShowAttachments: settings.report.showAttachments,
                }),
              )
          : tab === "recall"
            ? // 회수는 **검색해서 찾는** 화면이라 첫 페인트에 목록을 싣지 않는다(전건을 띄우면 오클릭 거리만 는다).
              getReportFilterOptions().then((filterOptions) => ({ recallOptions: filterOptions }))
          : tab === "ai_ment"
            ? // 프롬프트와 강사 말투 목록은 서로 독립 — 직렬 금지(B4).
              Promise.all([getActivePrompts(), getMentStyleRows()]).then(([r, styles]) => ({
                aiPrompts: r.prompts ?? [],
                mentStyles: styles,
              }))
            : // 첫 페인트도 클라 초기 state와 **같은 기본 범위**(이번 달)로 — 안 맞추면 열자마자 목록이 한 번 바뀐다.
              // `?status=` — 알림·발송 큐 카드가 "미발송 N건"에서 이 목록으로 곧장 보낸다(그 N건만 걸러서).
              Promise.all([
                getReportFilterOptions(),
                listReports(defaultReportFilters(kstToday(), sp.status)),
              ]).then(([filterOptions, firstPage]) => ({
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
    <div className="mx-auto w-full max-w-7xl space-y-3">
      {/* 수제 헤더 → PageHeader 수렴(2026-07-19) — 창(embed)에선 컴팩트 1행으로 접힌다(제목은 창 타이틀바). */}
      <PageHeader
        eyebrow={classnoteOn ? "발송 관리" : "보고서 관리"}
        title="수업보고서"
        description={
          classnoteOn
            ? "발송 현황과 보고서 작성률을 확인합니다. 강사 작성은 원스크린에서 진행합니다."
            : "보고서 작성률과 목록을 확인합니다. 강사 작성은 원스크린에서 진행하고, 학부모에게는 보고서 링크를 보냅니다."
        }
      />

      {!isSettings && classnoteOn ? (
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
        <ReportList
          // 🔴 **상태가 바뀌면 새로 마운트한다** — 클라 컴포넌트라 `useState(initial)`는 첫 마운트에만 돌고,
          //    같은 라우트에서 `?status=`만 바뀐 소프트 내비는 인스턴스를 그대로 둔다. key가 없으면 이미 목록
          //    탭을 보던 사람이 "미발송 N건"을 눌러도 **아무 일도 안 일어난 것처럼** 보인다(이번 제보의 원인과
          //    같은 종류의 침묵). 적대적 리뷰 2026-09-09에서 잡았다.
          key={sp.status ?? "all"}
          options={tabData.filterOptions}
          initial={tabData.initialList}
          canSend={canSendReports}
          classnoteOn={classnoteOn}
          todayYmd={kstToday()}
          // 🔴 클라 초기 state가 서버 첫 페인트와 **같은 필터**여야 한다 — 안 맞추면 열자마자 목록이 한 번 바뀐다.
          initialStatus={sp.status}
        />
      ) : null}

      {tab === "recall" && "recallOptions" in tabData ? (
        <RecallFace options={tabData.recallOptions} todayYmd={kstToday()} />
      ) : null}

      {tab === "notice" && "noticeClasses" in tabData && "noticeRows" in tabData ? (
        <NoticeFace
          classes={tabData.noticeClasses}
          initial={tabData.noticeRows}
          canSend={canSendReports}
          classWide={"classWide" in tabData ? tabData.classWide : undefined}
        />
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
        <ReportSection
          initial={tabData.reportSettings}
          teachers={tabData.teachers}
          staffNames={tabData.staffNames}
          classnoteOn={classnoteOn}
        />
      ) : null}

      {tab === "ai_ment" && "aiPrompts" in tabData ? (
        <AiMentSection initial={tabData.aiPrompts} styles={tabData.mentStyles} />
      ) : null}
    </div>
  );
}
