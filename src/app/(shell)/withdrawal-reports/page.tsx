import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { getShellView } from "@/lib/auth/view-mode";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { directProcessingReady, listReports, reportViewer, reportStaff, requestStudents, reportSubjectLabels } from "@/features/withdrawal-reports/server/queries";
import { canManageStudentStatusNow } from "@/features/students/server/status-access";
import { listArchives } from "@/features/withdrawal-reports/server/archives";
import { loadRefundSteps } from "@/features/withdrawal-reports/server/refund-steps";
import { loadRefundHolds, loadRefundOutcomes } from "@/features/withdrawal-reports/server/refund-check";
import { loadCancelNotes } from "@/features/withdrawal-reports/server/cancel-notes";
import { cancelsAsDirector } from "@/features/withdrawal-reports/model";
import {
  LIST_PAGE_SIZE,
  buildListItems,
  filterListItems,
  listHref,
  listWindow,
  parseListFilters,
  teacherOptions,
} from "@/features/withdrawal-reports/list-items";
import { ReportList } from "./_components/report-list";
import { ListToolbar } from "./_components/list-toolbar";
import { RequestDialog } from "./_components/request-dialog";
import { foldedReason } from "@/lib/folded-read";

export const metadata = { title: "퇴원보고서 — 에이와" };

type SearchParams = Record<string, string | string[] | undefined>;
/** 같은 이름이 여럿이면 첫 값 — 필터는 한 값씩이다. */
const flat = (sp: SearchParams) =>
  Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;

/**
 * 퇴원보고서 — 웹 보고서와 기존 스프레드시트 기록을 한 목록에(원장 2026-10-14). 필터·쪽은 주소에 싣고 서버가 거른다
 * (퇴원관리와 같은 방식). 강사뷰는 본인에게 매핑된 기록만, 관리자뷰는 관리 범위의 기록을 본다.
 */
export default async function WithdrawalReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAccess("withdrawal_reports");
  const viewer = await reportViewer();
  if (!viewer) notFound();
  const sp = flat(await searchParams);
  // 🔑 독립 조회 — 한 번에(B4). 기존 기록을 못 읽어도 웹 보고서는 보여야 하니 그쪽 실패만 안내로 접는다.
  const [list, staff, students, labels, settings, archives, shell, directReady] = await Promise.all([
    listReports(),
    reportStaff(),
    requestStudents(),
    reportSubjectLabels(),
    getTenantSettings(),
    listArchives().catch((error: unknown) => {
      console.error("[withdrawal-reports] 기존 스프레드시트 기록 조회 실패", error);
      return null;
    }),
    getShellView(),
    // 관리자 바로 처리(0453a) — 적용 전 DB에선 그 선택지만 숨는다(#95). 승인을 건너뛰므로 원생 상태 변경 자격도 있어야 보인다(서버가 다시 본다).
    viewer.request
      ? Promise.all([directProcessingReady(viewer.user.tenantId), canManageStudentStatusNow()]).then(([ready, status]) => ready && status)
      : Promise.resolve(false),
  ]);
  // 원생 화면의 '퇴원보고서'가 `?request=<학생>`으로 연다 — 그 학생을 고른 채 창을 띄운다(퇴원은 퇴원보고서로만, 원장 2026-10-23).
  const requestFor = sp.request && /^[0-9a-f-]{36}$/i.test(sp.request) ? sp.request : null;
  // 설명은 보는 화면의 일로 — 강사뷰(좁은 머리글)는 제목을 접고 이 한 줄만 보여 주는데, 결재 절차 설명이 강사 화면에 그대로 떴다(원장 2026-10-16).
  //   겸직이 강사뷰로 볼 때도 강사 문구(권한이 아니라 셸로 가른다).
  const header = (
    <PageHeader
      title="퇴원보고서"
      description={
        shell !== "teacher"
          ? "관리자가 작성을 요청하고, 강사별로 보고서를 제출합니다. 관리자 승인(보고서에서 환불을 요청했다면 데스크 환불 처리까지)이 끝나면 처리합니다."
          : "작성을 요청받은 퇴원보고서를 작성해 제출합니다."
      }
    />
  );
  if (!list.available) {
    return (
      <div className="min-w-0 space-y-5 p-4 md:p-6">
        {header}
        <p className="bg-muted/30 rounded-lg border p-6 text-sm">퇴원보고서 기능을 준비 중입니다. 잠시 후 다시 확인해 주세요.</p>
      </div>
    );
  }

  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const canSeeArchive = !!viewer.teacherId || viewer.manage;
  // 데스크 환불 단계(원장 2026-11-03) — 못 읽으면 단계 없이(목록은 연다).
  // 원장 환불 결정 대기·결정 요약(승인 진행의 원장 줄) · 요청 취소 기록(상태 칸 말풍선 — 원장 2026-11-06 · s2_0032) — 못 읽으면 없이(목록은 연다).
  const [refunds, holds, outcomes, cancels] = await Promise.all([
    loadRefundSteps(viewer.user.tenantId, list.rows, staff).catch((error: unknown) => {
      console.error("[withdrawal-reports] 데스크 환불 단계 조회 실패", error);
      return undefined;
    }),
    loadRefundHolds(viewer.user.tenantId, list.rows.filter((r) => !["completed", "canceled", "blocked"].includes(r.status)).map((r) => r.group_id)).catch((error: unknown) => {
      console.error("[withdrawal-reports] 환불 결정 대기 조회 실패", error);
      return undefined;
    }),
    loadRefundOutcomes(viewer.user.tenantId, list.rows.filter((r) => r.status !== "canceled").map((r) => r.group_id)).catch((error: unknown) => {
      console.error("[withdrawal-reports] 환불 결정 조회 실패", error);
      return undefined;
    }),
    loadCancelNotes(viewer.user.tenantId, list.rows.filter((r) => r.status === "canceled").map((r) => r.id)).catch((error: unknown) => {
      console.error("[withdrawal-reports] 요청 취소 기록 조회 실패", error);
      return undefined;
    }),
  ]);
  const items = buildListItems({ reports: list.rows, archives: archives ?? [], staff, labelOf: subjectMaps.labelOf, userId: viewer.user.id, writable: viewer.writable, refunds, holds, outcomes, cancels,
    // 원장급은 남이 요청한 보고서도 취소한다 — 재검토 건의 '내 재요청 필요'(상세 화면과 같은 판정) · 환불 결정 대기의 '내 환불 결정 필요'도 이 판정.
    directorLevel: cancelsAsDirector(viewer.user.systemRole, !!viewer.teacherId),
    // 승인 완료 줄의 묶음 형제 상태(형제가 목록에 없어도) — 상태 칸이 '다른 과목 승인 대기'와 '환불·처리만 남음'을 가른다.
    groupStatuses: list.groupStatuses });
  const filters = parseListFilters(sp, canSeeArchive);
  const rangeWindow = listWindow(filters, kstToday());
  const found = filterListItems(items, filters, rangeWindow);
  const totalPages = Math.max(1, Math.ceil(found.length / LIST_PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, Math.floor(Number(sp.page)) || 1));
  const shown = found.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE);
  // '내 승인 필요' 칩 건수 = 칩을 켰을 때 보일 줄 수(상태는 진행 중이라 상태만 걷는다).
  const mineCount = filterListItems(items, { ...filters, status: "all", mine: true }, rangeWindow).length;
  const filterActive =
    filters.status !== "all" || filters.range !== "all" || filters.subject !== "all" || filters.teacher !== "all" || filters.kind !== "all" || filters.mine || !filters.hideCanceled || !!filters.q;
  // 요청 취소 숨기기(원장 2026-11-02) — 숨긴 만큼 '전체 N건'에서도 뺀다(상태를 바꿔도 같은 기준). 상태를 '요청 취소'로 고르면 숨기지 않는다.
  const hiding = filters.hideCanceled && filters.status !== "canceled";
  const total = hiding ? items.filter((i) => i.status !== "canceled").length : items.length;
  const canceledCount = filterListItems(items, { ...filters, status: "canceled" }, rangeWindow).length;
  // 과목 선택지 = 학원설정 단일 소스. 과목 범위가 있는 사람은 그 과목만(목록도 그 범위로만 온다).
  const subjects = viewer.scope ? subjectMaps.options.filter((o) => viewer.scope!.includes(o.value)) : subjectMaps.options;

  return (
    <div className="min-w-0 space-y-5 p-4 md:p-6">
      {header}
      <ListToolbar
        filters={filters}
        custom={"custom" in rangeWindow ? rangeWindow.custom : undefined}
        subjects={subjects}
        teachers={teacherOptions(items, staff)}
        archiveStatus={viewer.manage}
        mine={mineCount > 0 || filters.mine ? { href: listHref(sp, filters.mine ? { mine: null } : { mine: "approve", status: null }), count: mineCount } : null}
        hideCanceled={filters.status === "all" ? { active: hiding, href: listHref(sp, { canceled: hiding ? "show" : null }), count: canceledCount } : null}
        resultText={found.length === total ? `전체 ${total}건` : `${found.length}건 / 전체 ${total}건`}
        resetHref={filterActive ? listHref(sp.embed ? { embed: sp.embed } : {}, {}) : null}
        request={viewer.request ? <RequestDialog key={requestFor ?? "none"} staff={staff} students={students} labels={labels} scope={viewer.scope} initialStudentId={requestFor} directReady={directReady} settingsUnavailable={!!foldedReason(settings)} /> : null}
      />
      {archives === null && canSeeArchive ? (
        <p role="alert" className="text-danger text-sm">
          기존 스프레드시트 기록을 불러오지 못했습니다. 웹에서 작성한 보고서만 표시합니다.
        </p>
      ) : null}
      <ReportList items={shown} />
      {totalPages > 1 ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={found.length}
          hrefForPage={(p) => listHref(sp, { page: p > 1 ? String(p) : null })}
          scroll={false}
        />
      ) : null}
      {list.completedLimited && (
        <p className="text-muted-foreground text-xs">진행 중인 요청은 모두 표시하며, 완료·취소 건은 최근 200건까지 표시합니다.</p>
      )}
    </div>
  );
}
