import { getGoogleSheetsStatus } from "@/features/integrations/server/queries";
import { SHEET_EXPORT_SUBJECTS } from "@/features/integrations/sheets-provider";
import { buildSubjectMaps } from "@/features/owner/subjects";
import {
  getMakeeduAutoSyncStatus,
  getMakeeduSyncRuns,
  getUnpushedIntakeConsultations,
  getMakeeduSyncLock,
  getMakeeduSyncState,
} from "@/features/integrations/server/makeedu-sync";
import { getServiceAccountEmail } from "@/features/integrations/google-sheets";
import { SubjectSheetCard } from "./subject-sheet-card";
import { MakeeduSyncCard } from "./makeedu-sync-card";
import { MakeeduSyncRunsList } from "./makeedu-sync-runs";
import { MakeeduPushCard } from "@/features/integrations/components/makeedu-push-card";
import { EyIcon } from "@/components/icons/aywa-icons";
import { EmbedLink } from "@/components/embed-link";
import { humanizeMakeeduSyncError } from "@/features/integrations/sync-error";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { canPushToMakeedu } from "@/features/integrations/server/makeedu-push-access";

/**
 * 연동 면 (owner ?tab=sheets) — 구글 시트 내보내기 단일 홈.
 * ① ON/OFF 토글 ② 대상 시트 ID(`notifications.googleSheetId`) ③ 최초 설정 안내(서비스계정 공유).
 *
 * 넓은 창에선 좌(설정 안내) · 우(토글+대상 ID) 2열로 펼쳐 가로 공간을 쓰고, 좁으면 단일 컬럼으로 접힘.
 *
 * ⚠️ 서비스계정은 자체 Drive 용량이 0이라 시트를 새로 만들지 못한다 → 사람이 만든 빈 시트에
 *    서비스계정을 '편집자'로 공유해야 하고, 동기화는 그 시트를 **전체 덮어쓰기**한다.
 */
const RUNS_PAGE_SIZE = 8;

export async function SheetsFace({
  subjects,
  page = 1,
  isEmbed = false,
  makeeduOn = true,
  sheetsOn = true,
  canEdit = true,
}: {
  /** 과목 라벨 소스(operations.subjects) — 시트 세팅 카드 제목용(하드코딩 금지). */
  subjects: Parameters<typeof buildSubjectMaps>[0];
  page?: number;
  isEmbed?: boolean;
  /** makeedu 연동 모듈 — 꺼진 학원(새 학원 기본)은 동기화·역동기화 카드를 세우지 않고 조회도 안 한다(2026-09-22 방향 B). */
  makeeduOn?: boolean;
  /** 구글 시트 시간표 연동 모듈 — 꺼지면 시트 내보내기 절을 세우지 않는다. 침산은 둘 다 켜져 있다. */
  sheetsOn?: boolean;
  /** 연동 설정 쓰기(page.tsx의 fieldset 잠금과 같은 값) — 없으면 토글·시트 ID 저장 단추를 그리지 않는다. */
  canEdit?: boolean;
}) {
  // 독립 조회 → 병렬(B4). 시트 상태는 지원 과목(math·english)마다 별도 provider 행.
  // 꺼진 연동은 조회도 하지 않는다 — 그 학원엔 없는 연동이다.
  if (!makeeduOn && !sheetsOn) {
    return (
      <div className="bg-card shadow-card w-full rounded-2xl p-6">
        <p className="text-foreground text-sm font-bold">이 학원은 makeedu·구글 시트 연동을 쓰지 않습니다</p>
        <p className="text-text-dim mt-1 text-sm">
          makeedu 동기화·구글 시트 시간표 연동은 학원 설정의 &lsquo;기능&rsquo; 면에서 켤 수 있습니다.
        </p>
      </div>
    );
  }
  // 🔴 '지금 동기화'·'makeedu로 보내기'는 연동 설정이 아니라 **makeedu 연동(integrations) 권한**이다 — 서버 액션과 같은 함수
  //    (`triggerMakeeduSyncNow` = canWriteTenant(integrations) · `enqueueConsultationPush` = canPushToMakeedu)로 판정한다.
  //    이 면이 연동 설정으로 잠겼으면(canEdit=false) fieldset이 단추를 잠그므로 비활성으로 남기지 않게 함께 감춘다.
  const viewer = makeeduOn ? await getCurrentUser() : null;
  const [canTriggerSync, canPush] = viewer && canEdit
    ? await Promise.all([canWriteTenant(viewer.systemRole, "integrations"), canPushToMakeedu(viewer.systemRole)])
    : [false, false];
  const [sheetStatuses, makeeduStatus, runsPage, pushCandidates, syncLock, invoiceSync] = await Promise.all([
    sheetsOn ? Promise.all(SHEET_EXPORT_SUBJECTS.map((s) => getGoogleSheetsStatus(s))) : Promise.resolve([]),
    makeeduOn ? getMakeeduAutoSyncStatus() : Promise.resolve(null),
    makeeduOn ? getMakeeduSyncRuns(page, RUNS_PAGE_SIZE) : Promise.resolve({ runs: [], total: 0 }),
    makeeduOn && canPush ? getUnpushedIntakeConsultations() : Promise.resolve([]),
    makeeduOn ? getMakeeduSyncLock() : Promise.resolve({ busyUntil: null, running: false }),
    makeeduOn ? getMakeeduSyncState("invoices") : Promise.resolve(null),
  ]);
  const subjectMaps = buildSubjectMaps(subjects);
  const saEmail = getServiceAccountEmail();
  const runsTotalPages = Math.max(1, Math.ceil(runsPage.total / RUNS_PAGE_SIZE));
  // 실행 이력 페이저 href — ?tab=sheets(+embed) 보존, page>1일 때만 page 파라미터(1페이지는 생략).
  const runsHref = (p: number) => {
    const params = new URLSearchParams({ tab: "sheets", sub: "makeedu" }); // 연동 내부 탭(makeedu) 유지
    if (isEmbed) params.set("embed", "1");
    if (p > 1) params.set("page", String(p));
    return `/owner?${params.toString()}`;
  };
  return (
    <div className="w-full space-y-8">
      {invoiceSync && (invoiceSync.issue || invoiceSync.status !== "ok") ? <section className="space-y-2 rounded-lg border border-amber/40 bg-amber-soft p-4" aria-label="수납 동기화 확인 사항">
        <h2 className="text-base font-bold">수납 동기화 확인 사항</h2>
        <p className="text-text-dim text-xs">{new Date(invoiceSync.syncedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 기준</p>
        <p className="break-words text-sm" title={invoiceSync.issue ?? undefined}>{invoiceSync.status === "ok" ? invoiceSync.issue : humanizeMakeeduSyncError(invoiceSync.issue) || "수납 동기화 실패"}</p>
        {invoiceSync.issue?.includes("미매칭") ? <>
          <p className="text-sm">학생 미매칭은 원생의 이름·학년·중복 등록을 확인해야 합니다. 가져오지 못한 수납은 수납 화면의 ‘마지막 동기화에 없던 청구’ 목록에 표시되지 않습니다.</p>
          <EmbedLink href="/owner?tab=data" className="inline-flex text-sm font-semibold text-primary underline underline-offset-2">데이터 정리에서 중복 원생 확인</EmbedLink>
          <p className="text-text-dim text-xs">미매칭 대상의 상세 내역은 동기화 담당 PC의 .makeedu-tmp/import-invoices-report.json에서 확인할 수 있습니다.</p>
        </> : <p className="text-sm">연동 PC 탭의 담당 PC 상태와 아래 최근 실행 이력을 확인하세요.</p>}
      </section> : null}
      {/* makeedu 자동 동기화 — 외부 연동 면 상단: 토글/버튼 카드 + 담당 PC 상태(0073a) + 최근 실행 이력(0070a) */}
      {makeeduOn && makeeduStatus ? (
        <>
          <MakeeduSyncCard status={makeeduStatus} initialLock={syncLock} canToggle={canEdit} canTrigger={canTriggerSync} />
          <EmbedLink href="/owner?tab=sheets&sub=agent" className="text-primary text-sm font-semibold underline underline-offset-2">연동 PC 관리</EmbedLink>
          <MakeeduSyncRunsList
            runs={runsPage.runs}
            page={page}
            totalPages={runsTotalPages}
            total={runsPage.total}
            hrefForPage={runsHref}
          />
          {/* 역동기화 — QR 접수 상담을 makeedu로 보내기(보낼 권한이 있으면 항상 표시, 후보 0건이면 빈 상태로 발견성 유지).
              보낼 권한이 없으면 카드를 세우지 않는다(등록상담 화면의 'makeedu 보내기'와 같은 함수). */}
          {canPush ? <MakeeduPushCard candidates={pushCandidates} /> : null}
        </>
      ) : null}

      {sheetsOn ? (
      <div className="space-y-5">
      <header className="border-border border-b pb-3">
        <p className="eyebrow">관리 · 외부 연동</p>
        <h2 className="text-foreground text-lg font-bold">구글 시트 내보내기 (과목별)</h2>
        {/* text-balance(text-wrap: balance) = 짧은 문단의 줄 너비를 균등하게 나눠 마지막 줄이 짧게 남는 고아 방지
            (실측: 같은 폭에서 pretty는 [763,128] 고아, balance는 [447,444] 균등). max-w-3xl 고정폭도 풀어(max-w-5xl)
            넓은 창에선 한 줄로 붙고 좁으면 균등 2줄로 접히게 — 창 폭에 따라 스마트하게. */}
        <p className="text-muted-foreground mt-1 max-w-5xl text-sm text-balance">
          과목마다 <strong>전용 구글 시트</strong>를 등록하고 켜면 그 과목 시간표 화면에 ‘시트로 보내기’ 버튼이
          생깁니다(원장 전용). 누르면 등록한 시트에 현재 시간표가 <strong>통째로 덮어쓰기</strong>됩니다.
        </p>
        <p className="text-muted-foreground mt-2 flex max-w-5xl items-start gap-1.5 text-sm text-balance">
          <EyIcon name="alert" size={16} className="mt-0.5 shrink-0" />
          <span>전체 덮어쓰기라 <strong>과목마다 서로 다른 시트</strong>를 써야 합니다(수학·영어를 한 시트에 섞지 마세요).</span>
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        {/* 좌 — 최초 1회 설정 안내(서비스계정은 새 시트를 못 만들어 사람이 만든 시트에 공유가 필요) */}
        <section className="border-border bg-card flex flex-col rounded-2xl border p-5 text-sm leading-relaxed">
          <p className="text-foreground font-bold">처음 한 번 설정 (과목마다)</p>
          <ol className="text-text-dim mt-2 list-decimal space-y-1.5 pl-5">
            <li>
              구글 드라이브에서 <strong>빈 구글 시트</strong>를 과목 수만큼 만듭니다(원장 계정 소유).
            </li>
            <li>
              각 시트를 아래 계정에 <strong>‘편집자’로 공유</strong>합니다:
              {saEmail ? (
                <code className="bg-bg-soft border-line mt-1 block w-fit rounded border px-1.5 py-0.5 text-xs break-all">
                  {saEmail}
                </code>
              ) : (
                <span className="text-danger ml-1">서비스계정 키 미설정 — 관리자에게 문의</span>
              )}
            </li>
            <li>
              시트 URL의 <code>/d/</code> 뒤 ID를 오른쪽 과목 카드의 <strong>Google Sheets ID</strong>에 등록합니다.
            </li>
            <li>토글을 켜고, 시간표 화면의 ‘시트로 보내기’ 버튼으로 동기화합니다.</li>
          </ol>
          <p className="text-text-faint mt-auto flex items-start gap-1.5 pt-3 text-xs text-balance">
            <EyIcon name="alert" size={14} className="mt-0.5 shrink-0" />
            <span>서비스계정은 저장공간이 없어 시트를 새로 만들 수 없습니다(미리 만든 시트 필요). 동기화는
            그 시트를 <strong>전체 덮어쓰기</strong>하므로 다른 내용과 섞지 말고 과목 전용 시트로 쓰세요.
            </span>
          </p>
        </section>

        {/* 우 — 과목별 시트 카드(토글 + 대상 ID + 상태) */}
        <div className="space-y-4">
          {SHEET_EXPORT_SUBJECTS.map((s, i) => (
            <SubjectSheetCard key={s} subject={s} label={subjectMaps.labelOf(s)} status={sheetStatuses[i]} canEdit={canEdit} />
          ))}
        </div>
      </div>
      </div>
      ) : null}
    </div>
  );
}
