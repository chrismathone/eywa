/**
 * 사전 상담 브리프(상담지) 표시 — 상담을 **시작하기 전에** 읽는 카드다.
 *
 * ⚠️ 여기 나오는 반·잔여석·금액은 전부 생성 시점 스냅샷(`record.facts`)이다 — 화면이 지금 DB를
 *    다시 읽지 않는다. "그때 이 자료로 상담했다"가 재현돼야 하기 때문(인쇄물 동결과 같은 정책).
 *    오래된 브리프는 '갱신'으로 다시 만든다.
 *
 * 본문은 **기본 접힘**(`PrepBriefCollapse`) — 길어서 등록상담 상세의 나머지(접수 정보·AI 분석·
 * 수강 이력)를 통째로 밀어냈다. 헤더(제목·헤드라인·모델 라벨·생성시각·인쇄/갱신)와 생성 진행바·
 * 실패 안내는 접혀 있어도 항상 보인다.
 *
 * ── `past`(상담 완료 이후 단계) ────────────────────────────────────────────────
 * 원장 2026-09-10: *"사실 브리프는 상담완료 칸반 이후로는 필요없을듯"* → *"지난 브리프로 이름을
 * 바꿔버리던지 처리해버리고 중요한건 배정된 반이니까"*. 그래서 **지우지 않고 격을 내린다**:
 *  · 제목이 `상담 준비 브리프` → **`지난 상담 브리프`**(끝난 상담을 '준비'라 부르면 거짓말이다)
 *  · 브랜드 틴트(눈에 띄는 자리) → 무채색 카드로. 자리도 페이지 맨 아래로 내려간다(page.tsx)
 *  · **'다시 작성'을 감춘다** — 지난 기록을 새로 만들 이유가 없고 AI 호출은 돈이 든다
 *  · **'인쇄'는 남긴다** — 이미 만들어 둔 문서를 여는 것이라 새 호출이 없고, 상담 뒤에 원본을
 *    다시 뽑아야 하는 일(학부모 재문의·인수인계)이 실제로 있다
 * 🔴 데이터(`prep_brief` 스냅샷)는 **한 줄도 지우지 않는다** — 표시·이름·자리만 바뀐다.
 *
 * ── `pinned`(수정 화면, 원장 2026-11-11 *"상담 수정을 눌러도 이름 아래쪽에 '브리프 펼치기'를 두고,
 * 브리프를 보면서 수정(입력)할 수 있게"*) ─────────────────────────────────────────
 * 카드 대신 **펼치기 줄 하나**만 이름 아래에 둔다. 펼치면 머리(제목·헤드라인·생성시각·인쇄/다시 작성)와
 * 본문이 높이 상한 안에서 따로 스크롤되고, 그 판이 수정 화면 맨 위에 붙어(sticky) 폼을 내려가며 입력해도
 * 계속 보인다(`PrepBriefCollapse pinned`). 본문·머리·버튼 판정은 상세 카드와 **같은 코드**다.
 * 브리프가 없는 건은 상세와 똑같은 안내 카드(아래 `!record` 분기)를 그린다 — 페이지 로드가 AI를 부르지 않는다.
 */
import { AlertCircle, ClipboardCheck, Printer } from "@/components/icons/aywa-icon-compat";
import { PrintWindowButton } from "@/components/workspace/print-window";
import { modelDisplayLabel } from "@/lib/ai/model-label";
import type { PrepBriefRecord } from "@/features/enrollment/prep-brief";
import { PrepBriefBody } from "./prep-brief-body";
import { PrepBriefButton } from "./prep-brief-button";
import { PinnedPrintLink, SavedOnlyNote } from "./prep-brief-pinned-parts";
import { PrepBriefCollapse } from "./prep-brief-collapse";
import { PrepBriefProgress } from "./prep-brief-progress";

/** 상담이 끝난 뒤의 제목 — '준비'가 아니라 '지난'. 문구를 두 곳에 적지 않게 상수로. */
const TITLE_NOW = "상담 준비 브리프";
const TITLE_PAST = "지난 상담 브리프";

export function PrepBriefSection({
  consultationId,
  record,
  status,
  errorText,
  canWrite,
  past = false,
  pinned = false,
}: {
  consultationId: string;
  record: PrepBriefRecord | null;
  /** 0153b 생성 상태 — generating이면 진행바, failed면 실패 안내 + 재시도. */
  status: "generating" | "failed" | null;
  errorText: string | null;
  canWrite: boolean;
  /**
   * 칸반 '상담 전'을 지난 건인가(`stageOfCard(card) !== "before"`).
   * 🔴 판정은 호출부가 **board-stages 단일 소스**로 한다 — 여기서 outcome 문자열을 비교하지 말 것.
   */
  past?: boolean;
  /** 수정 화면 — 카드 없이 펼치기 줄만, 펼치면 화면 위에 붙는 판(위 머리 주석 `pinned`). */
  pinned?: boolean;
}) {
  const generating = status === "generating";
  const title = past ? TITLE_PAST : TITLE_NOW;
  // 🔴 '다시 작성'은 상담 전에만. 안 보이는 것을 다시 만들 수는 없어야 하고, 지난 기록을 새 사실로
  //    덮어쓰면 "그때 이 자료로 상담했다"는 스냅샷 성질이 깨진다(AI 호출은 명시 버튼일 때만 — 감춰도
  //    페이지 로드가 호출을 만들지 않으므로 캐싱 규약은 그대로다).
  const showRegenerate = canWrite && !generating && !past;
  const failedLine =
    status === "failed" ? (
      <p className="text-destructive inline-flex items-center gap-1 text-xs">
        <AlertCircle className="size-3" />
        {errorText ?? "브리프 생성에 실패했습니다"} — 다시 시도해 주세요
      </p>
    ) : null;
  const savedOnlyNote = pinned && showRegenerate ? <SavedOnlyNote /> : null;
  // 수정 화면의 실패 = 다시 작성 단추를 실패 안내 곁(접혀도 보이는 자리)에 하나만 — 머리글에도 세우면 펼쳤을 때 둘이 된다.
  const regenerateInNotice = pinned && status === "failed";

  if (!record) {
    return (
      <section className="border-border bg-bg-soft/40 rounded-2xl border border-dashed p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-foreground inline-flex items-center gap-2 text-sm font-bold">
              <ClipboardCheck className="text-primary size-4" />
              {title}
            </h2>
            {generating ? (
              <div className="pt-1">
                <PrepBriefProgress consultationId={consultationId} />
              </div>
            ) : (
              <p className="text-text-dim text-xs break-keep">
                학부모가 접수 폼에 답한 내용과 학원 데이터(개설 반·잔여석·시간·수강료·형제 재원 여부)를 모아
                상담 직전에 읽을 준비 문서를 만듭니다.
              </p>
            )}
            {failedLine}
            {savedOnlyNote}
          </div>
          {showRegenerate ? <PrepBriefButton consultationId={consultationId} exists={false} /> : null}
        </div>
      </section>
    );
  }

  const b = record.brief;
  const modelLabel = record.source === "ai" ? modelDisplayLabel(record.model) : null;
  const generated = new Date(record.generatedAt).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const collapseLabel = past ? TITLE_PAST : "브리프";
  // past = 무채색(격을 내린 자리) / 상담 전 = 브랜드 틴트(지금 읽어야 하는 문서).
  const tone = past ? "border-line bg-bg-soft/40" : "border-primary/20 bg-primary-soft/20";

  const header = (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h2 className="text-foreground inline-flex items-center gap-2 text-sm font-bold">
          <ClipboardCheck className={`size-4 ${past ? "text-text-dim" : "text-primary"}`} />
          {title}
          {record.source === "fallback" ? (
            // 폴백을 AI 결과처럼 보이게 두면 상담사가 "AI가 검토했다"고 오해한다 — 정직하게 구분.
            <span className="border-border text-text-dim rounded-md border px-1.5 py-0.5 text-xs font-medium">
              접수 정보 기반 기본 브리프
            </span>
          ) : modelLabel ? (
            <span className="border-border text-text-dim rounded-md border px-1.5 py-0.5 text-xs font-medium">
              {modelLabel}
            </span>
          ) : null}
        </h2>
        <p className="text-foreground text-lg font-semibold break-keep">{b.headline}</p>
        <p className="text-text-dim text-xs">
          <span className="num">{generated}</span> 기준 학원 데이터로 작성 ·{" "}
          {past ? "상담 전에 만든 문서(기록 보관용)" : "상담 전 확인용"}
        </p>
        {savedOnlyNote}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* 🔴 '인쇄'는 past에서도 남긴다 — **이미 만들어 둔 스냅샷을 여는 것**이라 AI 호출이 없고,
            상담이 끝난 뒤에 원본을 다시 뽑아야 하는 일(학부모 재문의·인수인계)이 실제로 있다.
            반대로 '다시 작성'은 호출이 돈이고 지난 기록을 덮으므로 past에선 감춘다(showRegenerate). */}
        {/* ⚠️ 창 제목은 **문서 이름 그대로**다(카드 제목을 따라가지 않는다) — 인쇄물 자체는 언제나
            '상담 준비 브리프'라는 이름의 동결 스냅샷이라, 창만 '지난…'으로 부르면 열어 본 종이와
            어긋난다(`(print)/enrollment/[id]/prep`의 metadata.title과 같은 문자열). */}
        {/* 수정 화면은 새 탭(PinnedPrintLink 주석 — 창 안 이동이면 입력 중인 폼이 사라진다). */}
        {pinned ? (
          <PinnedPrintLink consultationId={consultationId} />
        ) : (
        <PrintWindowButton
          id={`print/enrollment-prep/${consultationId}`}
          href={`/enrollment/${consultationId}/prep`}
          title={TITLE_NOW}
          variant="outline"
        >
          <Printer className="size-4" />
          인쇄
        </PrintWindowButton>
        )}
        {showRegenerate && !regenerateInNotice ? <PrepBriefButton consultationId={consultationId} exists /> : null}
      </div>
    </header>
  );

  // 재생성 중 — 직전 브리프는 그대로 두고 위에 진행바만 얹는다(실패해도 직전 브리프 보존).
  // 수정 화면에선 접혀 있어도 보이게 펼치기 줄 바로 아래에 둔다(진행바가 새로고침을 맡는다 — 접어 두면 끝나도 안 바뀐다).
  const notice =
    generating || failedLine ? (
      <>
        {generating ? (
          <div className="border-border bg-card rounded-lg border p-3">
            <PrepBriefProgress consultationId={consultationId} />
          </div>
        ) : null}
        {/* 수정 화면은 머리(다시 작성 단추)가 접혀 있을 수 있다 — 실패 안내 곁에 같은 단추를 함께 둔다. */}
        {regenerateInNotice ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {failedLine}
            {showRegenerate ? <PrepBriefButton consultationId={consultationId} exists /> : null}
          </div>
        ) : (
          failedLine
        )}
      </>
    ) : null;

  if (pinned) {
    return (
      <PrepBriefCollapse label={collapseLabel} muted={past} pinned={{ tone, notice }}>
        {header}
        <PrepBriefBody record={record} />
      </PrepBriefCollapse>
    );
  }

  return (
    <section className={`space-y-4 rounded-2xl border p-5 ${tone}`}>
      {header}
      {notice}
      <PrepBriefCollapse label={collapseLabel} muted={past}>
        <PrepBriefBody record={record} />
      </PrepBriefCollapse>
    </section>
  );
}
