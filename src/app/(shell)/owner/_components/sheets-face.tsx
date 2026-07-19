import { getGoogleSheetsStatus } from "@/features/integrations/server/queries";
import { SHEET_EXPORT_SUBJECTS } from "@/features/integrations/sheets-provider";
import { buildSubjectMaps } from "@/features/owner/subjects";
import {
  getMakeeduAutoSyncStatus,
  getMakeeduSyncRuns,
  getUnpushedIntakeConsultations,
  getMakeeduSyncWorkers,
  getMakeeduSyncLock,
} from "@/features/integrations/server/makeedu-sync";
import { getServiceAccountEmail } from "@/features/integrations/google-sheets";
import { SubjectSheetCard } from "./subject-sheet-card";
import { MakeeduSyncCard } from "./makeedu-sync-card";
import { MakeeduWorkerStatus } from "./makeedu-worker-status";
import { MakeeduSyncRunsList } from "./makeedu-sync-runs";
import { MakeeduPushCard } from "@/features/integrations/components/makeedu-push-card";
import { EyIcon } from "@/components/icons/eywa-icons";

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
}: {
  /** 과목 라벨 소스(operations.subjects) — 시트 세팅 카드 제목용(하드코딩 금지). */
  subjects: Parameters<typeof buildSubjectMaps>[0];
  page?: number;
  isEmbed?: boolean;
}) {
  // 서버 렌더 시각 — 워처 온라인/상대시각 판정용(RSC는 요청당 1회 실행이라 안정).
  // eslint-disable-next-line react-hooks/purity -- server component renders once per request
  const nowMs = Date.now();
  // 독립 조회 → 병렬(B4). 시트 상태는 지원 과목(math·english)마다 별도 provider 행.
  const [sheetStatuses, makeeduStatus, runsPage, pushCandidates, workers, syncLock] = await Promise.all([
    Promise.all(SHEET_EXPORT_SUBJECTS.map((s) => getGoogleSheetsStatus(s))),
    getMakeeduAutoSyncStatus(),
    getMakeeduSyncRuns(page, RUNS_PAGE_SIZE),
    getUnpushedIntakeConsultations(),
    getMakeeduSyncWorkers(nowMs),
    getMakeeduSyncLock(),
  ]);
  const subjectMaps = buildSubjectMaps(subjects);
  const saEmail = getServiceAccountEmail();
  const runsTotalPages = Math.max(1, Math.ceil(runsPage.total / RUNS_PAGE_SIZE));
  // 실행 이력 페이저 href — ?tab=sheets(+embed) 보존, page>1일 때만 page 파라미터(1페이지는 생략).
  const runsHref = (p: number) => {
    const params = new URLSearchParams({ tab: "sheets" });
    if (isEmbed) params.set("embed", "1");
    if (p > 1) params.set("page", String(p));
    return `/owner?${params.toString()}`;
  };
  return (
    <div className="w-full space-y-8">
      {/* makeedu 자동 동기화 — 외부 연동 면 상단: 토글/버튼 카드 + 담당 PC 상태(0073a) + 최근 실행 이력(0070a) */}
      <MakeeduSyncCard status={makeeduStatus} initialLock={syncLock} />
      <MakeeduWorkerStatus workers={workers} nowMs={nowMs} />
      <MakeeduSyncRunsList
        runs={runsPage.runs}
        page={page}
        totalPages={runsTotalPages}
        total={runsPage.total}
        hrefForPage={runsHref}
      />
      {/* 역동기화 — QR 접수 상담을 makeedu로 보내기(항상 표시, 후보 0건이면 빈 상태로 발견성 유지) */}
      <MakeeduPushCard candidates={pushCandidates} />

      <div className="space-y-5">
      <header className="border-border border-b pb-3">
        <p className="eyebrow">관리 · 외부 연동</p>
        <h2 className="text-foreground text-lg font-bold">구글 시트 내보내기 (과목별)</h2>
        {/* text-balance(text-wrap: balance) = 짧은 문단의 줄 너비를 균등하게 나눠 마지막 줄이 짧게 남는 고아 방지
            (실측: 같은 폭에서 pretty는 [763,128] 고아, balance는 [447,444] 균등). max-w-3xl 고정폭도 풀어(max-w-5xl)
            넓은 창에선 한 줄로 붙고 좁으면 균등 2줄로 접히게 — 창 폭에 따라 스마트하게. */}
        <p className="text-muted-foreground mt-1 max-w-5xl text-sm text-balance">
          과목마다 <strong>전용 구글 시트</strong>를 등록하고 켜면 그 과목 시간표 화면에 ‘시트 반영’ 버튼이
          생깁니다(원장 전용). 누르면 등록한 시트에 현재 시간표가 <strong>통째로 덮어쓰기</strong>됩니다.
        </p>
        <p className="text-muted-foreground mt-2 flex max-w-5xl items-start gap-1.5 text-sm text-balance">
          <EyIcon name="alert" size={16} className="mt-0.5 shrink-0" />
          <span>전체 덮어쓰기라 <strong>과목마다 서로 다른 시트</strong>를 써야 합니다(수학·영어를 한 시트에 섞지 마세요).</span>
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        {/* 좌 — 최초 1회 설정 안내(서비스계정은 새 시트를 못 만들어 사람이 만든 시트에 공유가 필요) */}
        <section className="border-border bg-card flex flex-col rounded-md border p-5 text-[13px] leading-relaxed">
          <p className="text-foreground font-bold">처음 한 번 설정 (과목마다)</p>
          <ol className="text-text-dim mt-2 list-decimal space-y-1.5 pl-5">
            <li>
              구글 드라이브에서 <strong>빈 구글 시트</strong>를 과목 수만큼 만듭니다(원장 계정 소유).
            </li>
            <li>
              각 시트를 아래 계정에 <strong>‘편집자’로 공유</strong>합니다:
              {saEmail ? (
                <code className="bg-bg-soft border-line mt-1 block w-fit rounded border px-1.5 py-0.5 text-[12px] break-all">
                  {saEmail}
                </code>
              ) : (
                <span className="text-danger ml-1">서비스계정 키 미설정 — 관리자에게 문의</span>
              )}
            </li>
            <li>
              시트 URL의 <code>/d/</code> 뒤 ID를 오른쪽 과목 카드의 <strong>Google Sheets ID</strong>에 등록합니다.
            </li>
            <li>토글을 켜고, 시간표 화면의 ‘시트 반영’ 버튼으로 동기화합니다.</li>
          </ol>
          <p className="text-text-faint mt-auto flex items-start gap-1.5 pt-3 text-[12px] text-balance">
            <EyIcon name="alert" size={14} className="mt-0.5 shrink-0" />
            <span>서비스계정은 저장공간이 없어 시트를 새로 만들 수 없습니다(미리 만든 시트 필요). 동기화는
            그 시트를 <strong>전체 덮어쓰기</strong>하므로 다른 내용과 섞지 말고 과목 전용 시트로 쓰세요.
            </span>
          </p>
        </section>

        {/* 우 — 과목별 시트 카드(토글 + 대상 ID + 상태) */}
        <div className="space-y-4">
          {SHEET_EXPORT_SUBJECTS.map((s, i) => (
            <SubjectSheetCard key={s} subject={s} label={subjectMaps.labelOf(s)} status={sheetStatuses[i]} />
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}
