import { requireAccess } from "@/lib/auth/require-access";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { PageHeader } from "@/components/page-header";
import { FaceTabs } from "@/components/face-tabs";
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
import { ParentRepliesFace } from "./_components/parent-replies-face";
import { listParentThreads } from "@/features/classnote-reply/server/reply-queries";
import { ComposeTab } from "./_components/compose-tab";
import { NoticeFace } from "./_components/notice-face";
import { BoardRosterCard } from "./_components/board-roster-card";
import { ReportSection } from "@/app/(shell)/owner/_components/report-section";
import { AiMentSection } from "@/app/(shell)/owner/_components/ai-ment-section";
import { isFeatureLicensed } from "@/lib/license/server";
import { classnoteModuleOn, classnoteReplyMode, classnoteSendOn } from "@/features/owner/classnote-gate";
import { getVideoHomeworkClassOptions } from "@/features/video-homework/server/queries";
import { redirect } from "next/navigation";
import { classnoteReportFaces, isClassnoteReportTab, lessonReportFaces, resolveLessonReportTab } from "@/features/report-admin/lesson-report-faces";

export const dynamic = "force-dynamic";
export const metadata = { title: "수업보고서 — 에이와" };

/**
 * ⚠️ 서버 액션은 **호출된 세그먼트의 maxDuration**을 따른다 — 직접발송 면의 자동작성
 * (`generateReportComment`)이 폴백을 타면 기본값(15초)에서 잘려 멘트가 템플릿으로 떨어진다([[#118]]).
 * 원스크린 세그먼트와 같은 이유·같은 값(실측치는 그쪽 주석).
 */
export const maxDuration = 300;

type Sp = Record<string, string | undefined>;
// 관리 면(영상 제출 현황·ClassNote 발송 큐·작성률·반 구성·목록·공지·직접발송) + 설정 면.
// (미매핑 탭은 2026-07-29 제거 — Edutrix 소등으로 원본이 사라져 매핑 자체가 불가능해졌다.)
/**
 * 수업보고서 — ClassNote 관련 면은 한 상위 탭과 하위 FaceTabs로 묶는다.
 * 보고서 설정·AI 멘트는 각각 메뉴 권한을 따른다. 강사 작성은 /onescreen.
 * 활성 탭만 무거운 조회(서버 렌더).
 */
export default async function LessonReportsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const viewer = await requireAccess(sp.tab === "report" ? "report_settings" : sp.tab === "ai_ment" ? "ai_ment" : "lesson_reports");
  const [canReportSettings, canAiMent, canEditReportSettings, canEditAiMent, canSendReports, canReports] = await Promise.all([
    canAccessTenant(viewer.systemRole, "report_settings"),
    canAccessTenant(viewer.systemRole, "ai_ment"),
    canWriteTenant(viewer.systemRole, "report_settings"),
    canWriteTenant(viewer.systemRole, "ai_ment"),
    canWriteTenant(viewer.systemRole, "lesson_reports"), // 목록 탭 관리자 발송 열 노출(viewer는 열람만)
    canAccessTenant(viewer.systemRole, "lesson_reports"),
  ]);
  if (sp.tab === "video_homework") redirect("/lesson-reports/video-homework");
  // ClassNote 모듈 — 꺼진 학원은 발송 콘솔(큐·반 구성·반 공지·직접 발송·회수)을 세우지 않는다. 침산은 켜져 있어 종전과 같다.
  // 요청 캐시라 아래 면별 조회의 getTenantSettings와 같은 조회를 나눠 쓴다.
  const [tenantSettings, aiOn] = await Promise.all([getTenantSettings(), isFeatureLicensed(viewer.tenantId, "ai_analysis")]);
  const classnoteOn = classnoteModuleOn(tenantSettings);
  // 학부모 글 답글·공감 모드(학원 설정, 기본 끔 — 모듈이 꺼지면 끔). 끔이면 면도 조회도 없다.
  const replyMode = classnoteReplyMode(tenantSettings);
  const faceOptions = { canReportSettings, canAiMent, canSend: canSendReports, classnoteOn, aiOn, replyOn: replyMode !== "off", canReports };
  const tab = resolveLessonReportTab(sp, faceOptions);
  if (tab !== "report" && tab !== "ai_ment" && !canReports) await requireAccess("lesson_reports");

  const faces = lessonReportFaces(faceOptions);
  const classnoteFaces = classnoteReportFaces(faceOptions);
  const inClassnote = isClassnoteReportTab(tab);

  // 큐는 독립 탭에서만 조회·폴링한다. 다른 관리 면의 첫 화면을 차지하지 않는다.
  const queueP = tab === "queue" && classnoteOn ? getClassnoteQueue(3) : Promise.resolve(null);
  const tabP =
    tab === "queue"
      ? Promise.resolve({ rates: null })
      : tab === "writing"
      ? // 범위 = 기본 이번 주, `?rmonth=YYYY-MM`이면 그 달(월간 매트릭스). 파라미터 하나로 같은 쿼리를 재사용.
        getWeeklyWritingRates(/^\d{4}-\d{2}$/.test(sp.rmonth ?? "") ? sp.rmonth : undefined).then((rates) => ({
          rates,
        }))
      : tab === "boards"
          ? getBoardRosterCheck().then((boardRoster) => ({ boardRoster }))
        : tab === "report"
          ? Promise.all([getTenantSettings(), getReportTeacherCandidates(), getVideoHomeworkClassOptions(viewer.tenantId)]).then(([settings, cand, videoClasses]) => ({
              reportSettings: settings.report,
              teachers: cand.bySubject,
              staffNames: cand.staffNames,
              videoClasses,
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
          : tab === "parent_replies"
            ? // 학부모 글·답글(0317a) — 최근 14일 원문 + 답글 상태. 조회 실패는 빈 목록 대신 안내(아래).
              listParentThreads({ mode: replyMode, user: viewer, page: sp.page }).then((parentThreads) => ({ parentThreads }), () => ({ parentThreads: null }))
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
                  showRating: firstPage.showRating ?? false,
                },
              }));

  const [queue, tabData] = await Promise.all([queueP, tabP]);

  return (
    <div className="w-full min-w-0 space-y-3">
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

      <FaceTabs faces={faces} active={inClassnote ? "classnote" : tab} ariaLabel="수업보고서 면" />
      {inClassnote ? <FaceTabs faces={classnoteFaces} active={tab} ariaLabel="클래스노트 기능" level="secondary" /> : null}

      {tab === "queue" ? (
        queue ? <ClassnoteQueueCard view={queue} canSend={canSendReports} /> :
          <p className="text-text-faint text-sm">발송 현황을 불러올 수 없습니다.</p>
      ) : null}

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

      {tab === "parent_replies" && "parentThreads" in tabData ? (
        tabData.parentThreads ? (
          <ParentRepliesFace view={tabData.parentThreads} />
        ) : (
          <p className="text-text-faint text-sm">학부모 글을 불러올 수 없습니다.</p>
        )
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
        <ReportSection initial={tabData.reportSettings} canEdit={canEditReportSettings} teachers={tabData.teachers}
          staffNames={tabData.staffNames} videoClasses={tabData.videoClasses} classnoteOn={classnoteOn} />
      ) : null}

      {tab === "ai_ment" && "aiPrompts" in tabData ? (
        <AiMentSection initial={tabData.aiPrompts} styles={tabData.mentStyles} canEdit={canEditAiMent} />
      ) : null}
    </div>
  );
}
