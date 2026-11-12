import Link from "next/link";
import { isFeatureLicensed } from "@/lib/license/server";
import { notFound, redirect } from "next/navigation";
import {
  AlertCircle, ClipboardCheck, ClipboardList, ExternalLink, Loader2, Mic, Pencil, Printer, Sparkles,
  type LucideIcon,
} from "@/components/icons/aywa-icon-compat";
import { Suspense, type ReactNode } from "react";
import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { PrintWindowButton } from "@/components/workspace/print-window";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant, readonlyViewErasedScope } from "@/lib/auth/perm-matrix";
import { readsAllNewcomers } from "@/features/newcomers/server/scope";
import { BackLink } from "@/components/back-link";
import { JourneyPanel, JourneyPanelSkeleton } from "@/features/enrollment/journey/panel";
import { formatCreatedAt } from "@/lib/utils";
import {
  findMergeSuccessor,
  getEnrollmentConsultationById,
  getSiblingConsultations,
  type AiAnalysisDetail,
  type ConsultationProcessingStatus,
} from "@/features/enrollment/server/queries";
import { WindowLink } from "@/components/workspace/window-link";
import { COMMON_FIELDS, ENGLISH_GROUPS, GENDER_OPTIONS, SUBJECT_TABS } from "@/features/enrollment/form-config";
import { outcomeBadge } from "@/features/enrollment/outcome-meta";
import { Pill } from "@/components/atoms/pill";
import { boardStatusOf } from "@/features/enrollment/board-stages";
import { getTenantSettings } from "@/features/owner/server/queries";
import { loadConsultationReferrer } from "@/features/enrollment/server/referrer-queries";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isModuleEnabled } from "@/lib/modules";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getClassesList } from "@/features/classes/server/queries";
import { TranscriptSection } from "@/components/transcript-section";
import { RecordingsSection } from "./recordings-section";
import { MergeButton } from "./merge-button";
import { ConsultationReportEditor } from "./consultation-report-editor";
import { ConsultationContentActions } from "./consultation-content-actions";
import { ConsultationStatusWatcher } from "./status-watcher";
import { ConvertToStudentDialog } from "./_components/convert-dialog";
import { ConsultationManageButtons, ConsultationDeleteButton } from "./_components/consultation-manage";
import { ChecklistView } from "../_components/checklist-view";
import { PrepBriefSection } from "./prep-brief-section";
import { AssignedClassesSection } from "./assigned-classes-section";
import { detailPanelsFor, showBriefCard } from "@/features/enrollment/detail-panels";
import { getAssignedClasses } from "@/features/enrollment/server/assigned-classes";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { canViewClassDetail } from "@/features/classes/server/class-scope";
import { makeeduCounselUrl } from "@/features/enrollment/makeedu-link";

export const metadata = { title: "신입생 상담 상세 — 에이와" };

/**
 * ⚠️ 서버 액션은 **호출된 세그먼트의 maxDuration**을 따른다. 사전 브리프 생성은 `after()` 백그라운드로
 * DeepSeek v4-pro(추론형, 실측 ~70초)를 부르는데, 기본값(15초)이면 플랫폼이 중간에 죽여 상태가
 * 'generating'에 그대로 남는다 = 진행바 무한. 전사 웹훅(300)·크론(120) 선례와 같은 방식으로 올린다.
 */
export const maxDuration = 300;

// outcome 배지 = [outcomeBadge](src/features/enrollment/outcome-meta.ts) 단일 소스.
// ⚠️ 여기 있던 로컬 맵은 chart 슬롯을 직접 참조해 목록과 색이 갈렸다(AI 완료가 목록=보라·상세=초록,
//    대기와 예약이 상세에선 같은 색이라 두 단계가 붙어 보였다).

const PROCESSING_BADGE: Record<
  ConsultationProcessingStatus,
  { label: string; class: string; spin?: boolean } | null
> = {
  idle: null,
  uploaded: { label: "분석 대기", class: "text-chart-3 bg-chart-3/10 border-chart-3/20" },
  transcribing: { label: "전사 중", class: "text-chart-3 bg-chart-3/10 border-chart-3/20", spin: true },
  analyzing: { label: "AI 분석 중", class: "text-chart-3 bg-chart-3/10 border-chart-3/20", spin: true },
  // 완료는 outcome 배지(AI 완료/등록 등)가 이미 알려주므로 중복 배지 숨김(진행 중·실패만 표시).
  completed: null,
  failed: { label: "실패", class: "text-chart-4 bg-chart-4/10 border-chart-4/20" },
};

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}분 ${r}초`;
}

export default async function EnrollmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAccess("enrollment");
  const { id } = await params;
  const [consult, allClasses, settings, siblings, canWrite, canRequestTextbook, referrer, canReadCare, aiOn] = await Promise.all([
    getEnrollmentConsultationById(id),
    getClassesList({ active: "active" }),
    getTenantSettings(),
    getSiblingConsultations(id), // 같은 학생의 다른 등록상담(반복 접수) — 없으면 빈 배열
    // 읽기 권한이면 쓰기 단추(수정·상태 변경·수업 배정·삭제·AI 요약·다시 분석·섹션 수정·브리프·병합)를 그리지 않는다 —
    // 서버 액션 게이트와 **같은 함수·같은 키**(원장 2026-11-05 · write-lock.ts).
    canWriteTenant(user.systemRole, "enrollment"),
    // 수학 반 배정 직후 '교재 신청서' 경로를 그릴지(원장 2026-09-09) — 못 여는 사람에게 그리면
    // 눌러도 권한 화면으로 튕기는 죽은 버튼이 된다. 진짜 게이트는 교재 화면의 requireAccess다([[#77]]).
    canWriteTenant(user.systemRole, "textbook_requests"),
    // 소개한 사람(0362a) — 기본 조회와 따로·실패해도 되게(#95).
    createClient().then((db) => loadConsultationReferrer(db as unknown as SupabaseClient, id)),
    // 상담 약속·인계(2026-11-05 AX 이식) 입구 — 약속 전체를 보는 신규생 관리 권한('전체' · '읽기' — 담당 범위 계정에게는 세우지 않는다 · 판정 한 곳 = scope.ts).
    readsAllNewcomers(),
    // 브리프 카드는 AI 라이선스가 켜진 지점만(꺼지면 흔적 없이 · 검수 2026-11-11).
    isFeatureLicensed(user.tenantId, "ai_analysis"),
  ]);
  if (!consult) {
    // 🔴 병합으로 사라진 상담이면 **404 대신 남은 쪽으로 보낸다**(원장 2026-09-01 제보) — 병합
    // 다이얼로그는 자기 창만 옮기므로, 그 상담을 열어 둔 다른 창·뒤로가기·복원된 창은 지워진 id를
    // 그대로 들고 있다가 빈 404를 만난다.
    const successor = await findMergeSuccessor(id);
    if (successor) redirect(`/enrollment/${successor}`);
    notFound();
  }

  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const f = consult.fields;

  // 사전 체크리스트 오른쪽 단 — 응답이 있거나 QR 접수 건이면 자리를 만든다(없으면 '없음'을 명시).
  // 수기 등록 건은 애초에 해당 없음이라 단 자체를 안 만든다(빈 칸 = 노이즈, 왼쪽이 전폭 사용).
  const showChecklistPane = !!f.intakeChecklist || consult.fromPublicIntake;

  // 녹음 분석이 추출한 상담 내용 — 이미 값이 있어 자동입력에서 버려진 경우, 읽기전용으로 되살려 보여준다
  // (수정에서 반영). 저장값과 동일하면 숨김.
  const aiSuggestedParentRequest = consult.aiFormSuggestions?.parentRequest?.trim() || null;
  // 저장값이 제안을 이미 포함(교체/추가 후 저장)하면 숨김 — includes가 정확일치·부분포함 둘 다 커버.
  const showParentRequestSuggestion =
    !!aiSuggestedParentRequest && !(consult.parentRequest ?? "").includes(aiSuggestedParentRequest);
  const genderLabel = f.gender ? (GENDER_OPTIONS.find((g) => g.value === f.gender)?.label ?? f.gender) : null;
  const addr = [f.address, f.addressDetail].filter(Boolean).join(" ") || null;
  const subjectLabel = f.subject ? subjectMaps.labelOf(f.subject) : null;
  const consultationDateLabel =
    f.consultationDate ?? new Date(consult.consultedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });

  /**
   * 브리프·배정 카드의 자리 판정 — **순수 함수 단일 소스**([detail-panels](src/features/enrollment/detail-panels.ts)),
   * 재료는 칸반과 같은 `stageOfCard`뿐이다(화면에서 `outcome` 문자열을 직접 비교하지 않는다).
   * ⚠️ 배정 조회는 '등록 완료' 칸일 때만 돈다 — 나머지 상담에 왕복을 더하지 않는다(B4·B7).
   */
  const { pastBrief, showAssigned } = detailPanelsFor({
    outcome: consult.outcome,
    assignedClassCount: consult.assignedClassCount,
  });
  // 반 상세를 못 여는 사람에겐 링크를 안 건다(죽은 링크 금지) — 상담사(counselor)는 등록상담 full이지만
  // 수업목록이 `none`이라 실제로 이 경우다. scoped(강사)는 반마다 담당 여부를 본다(chokepoint 재사용).
  const [assigned, classLevel] = showAssigned
    ? await Promise.all([
        getAssignedClasses(consult.studentId, f.subject),
        accessLevelTenant(user.systemRole, "classes"),
      ])
    : ([null, "none"] as const);
  const canOpenClass =
    classLevel === "none"
      ? false
      : (classLevel !== "scoped" && !(classLevel === "readonly" && (await readonlyViewErasedScope("classes")))) ||
        // scoped는 반마다 다르다(읽기 강사뷰가 X의 담당 범위를 지운 경우도 — 반 상세 게이트와 같은 판정) — 한 반이라도 못 열면 전부 텍스트로(부분 링크는 더 헷갈린다).
        (assigned?.ok
          ? (await Promise.all(assigned.rows.map((c) => canViewClassDetail(c.classId)))).every(Boolean)
          : false);

  /**
   * 브리프 카드 — **한 벌만 만들고 자리만 바꾼다**(위/아래에 각각 쓰면 props가 갈린다).
   * 그릴지는 수정 화면과 같은 판정(`showBriefCard` — 지난 건의 실패만 남은 카드는 안 그린다).
   */
  const briefNode =
    showBriefCard({ hasBrief: !!consult.prepBrief, status: consult.prepBriefStatus, past: pastBrief, aiOn }) ? (
      <PrepBriefSection
        consultationId={id}
        record={consult.prepBrief}
        status={consult.prepBriefStatus}
        errorText={consult.prepBriefError}
        stalled={consult.prepBriefStalled}
        jobAt={consult.prepBriefJobAt}
        canWrite={canWrite}
        past={pastBrief}
      />
    ) : null;

  const badge = boardStatusOf(consult);
  const procBadge = PROCESSING_BADGE[consult.processingStatus];
  const isProcessing =
    consult.processingStatus === "uploaded" ||
    consult.processingStatus === "transcribing" ||
    consult.processingStatus === "analyzing";

  return (
    <div className="space-y-6">
      <ConsultationStatusWatcher
        consultationId={consult.id}
        initialStatus={consult.processingStatus}
      />

      <BackLink href="/enrollment" label="신규 콜&상담으로" />

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <p className="eyebrow">신규 콜&상담</p>
          <div className="flex items-baseline gap-3">
            <h1 className="font-bold tracking-tight text-foreground text-3xl">{consult.prospectName}</h1>
            <Pill color={badge.color}>{badge.label}</Pill>
            {procBadge ? (
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium ${procBadge.class}`}
              >
                {procBadge.spin ? <Loader2 className="size-3 animate-spin" /> : null}
                {procBadge.label}
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
            <span>{consult.prospectGrade ?? "—"}</span>
            {consult.prospectSchool ? <span>· {consult.prospectSchool}</span> : null}
            {consult.hasAudio && consult.audioDurationSec ? (
              <span className="inline-flex items-center gap-1">
                · <Mic className="size-3" />
                <span className="num">{formatDuration(consult.audioDurationSec)}</span>
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canReadCare ? <Button variant="outline" render={<WindowLink href={consult.studentId ? `/students/${consult.studentId}/care` : `/enrollment/${id}/care`} title="상담 약속·인계" />}>상담 약속·인계</Button> : null}
          {/* ⚠️ "수정" 단독 금지 — 아래 AI 분석 리포트에도 섹션마다 '수정'(그 섹션 문장)이 있다.
              여기는 **상담 내용 폼 전체**를 연다. */}
          {canWrite ? (
            <>
              <Button variant="outline" render={<Link href={`/enrollment/${id}/edit`} />}>
                <Pencil className="size-4" />
                상담 수정
              </Button>
              <ConsultationManageButtons values={{ id: consult.id, outcome: consult.outcome, assignedClassCount: consult.assignedClassCount }} />
            </>
          ) : null}
          {consult.aiAnalysis ? (
            <PrintWindowButton
              id={`print/enrollment/${id}`}
              href={`/enrollment/${id}/print`}
              title="신입생 인수인계서"
            >
              <Printer className="size-4" />
              인쇄 미리보기
            </PrintWindowButton>
          ) : null}
          <ConvertToStudentDialog
            consultationId={consult.id}
            defaults={{
              name: consult.prospectName,
              grade: consult.prospectGrade,
              school: consult.prospectSchool,
              parentName: consult.parentName,
              parentPhone: consult.parentPhone,
            }}
            classes={allClasses.map((c) => ({
              id: c.id,
              className: c.className,
              subject: c.subject,
              teacherName: c.teacherName,
            }))}
            recommendedIds={consult.recommendedClasses.map((r) => r.id)}
            alreadyConverted={!!consult.studentId}
            linkedStudentId={consult.studentId}
            canRequestTextbook={canRequestTextbook}
            canWrite={canWrite}
          />
          {canWrite ? <ConsultationDeleteButton id={consult.id} /> : null}
        </div>
      </header>

      {/* 배정된 반 — 상담이 끝나면 **여기가 주인공**이다(원장 2026-09-10 *"중요한건 배정된 반이니까"*).
          브리프가 쓰던 자리를 그대로 물려받고, 브리프는 '지난 상담 브리프'가 되어 페이지 맨 아래로 간다. */}
      {showAssigned && assigned ? (
        <AssignedClassesSection
          assigned={assigned}
          hasStudent={!!consult.studentId}
          canOpenClass={canOpenClass}
          // 배정 조회가 이 상담 과목으로 좁혀져 있으므로 빈 목록 문구도 그 과목을 말한다.
          subjectLabel={subjectLabel}
        />
      ) : null}

      {/* 상담 준비 브리프 — 상담 *전* 준비 문서라 '상담 전' 칸에서는 헤더 바로 아래(상담 기록보다 먼저 읽는다).
          아직 안 만든 건 '상담 전' 칸에만 권유한다 — 이미 끝난 상담에 "브리프 만들기"를 띄우면 노이즈다.
          🔴 한 번 만든 브리프는 **지우지 않는다** — 끝난 상담에서는 이름·톤을 내려(pastBrief) 아래로 옮길 뿐이다. */}
      {!pastBrief ? briefNode : null}

      {/* 같은 학생의 다른 등록상담(반복 접수) — 학생 연결 또는 자연키(이름+학교+학년)로 묶은 다른 상담 건.
          카드의 '상담 N건' 배지와 동일 그룹. 각 건을 창으로 열어 나머지 상담을 확인·정리. 등록상담만 대상. */}
      {siblings.length > 0 ? (
        <section className="border-amber/30 bg-amber-soft/30 rounded-2xl border p-4">
          <div className="flex items-center gap-2">
            <ClipboardList className="text-amber size-4" />
            <h2 className="text-foreground text-sm font-bold">
              같은 학생의 다른 신규 콜&상담 <span className="num">{siblings.length}</span>건
            </h2>
          </div>
          <p className="text-text-dim mt-1 text-xs">
            같은 이름·학교로 접수된 다른 상담입니다. 중복이면 병합하고, 다른 상담(과목·시기)이면 각각 진행하세요.
          </p>
          <ul className="mt-3 space-y-1.5">
            {siblings.map((sib) => {
              const sBadge = outcomeBadge(sib.outcome);
              const sSubject = sib.subject ? subjectMaps.labelOf(sib.subject) : null;
              return (
                <li key={sib.id} className="flex items-center gap-2">
                  <WindowLink
                    href={`/enrollment/${sib.id}`}
                    title={sib.prospectName}
                    className="bg-card hover:bg-bg-soft border-border flex flex-1 items-center justify-between gap-2 rounded-lg border px-3 py-2 transition"
                  >
                    <span className="text-foreground flex items-center gap-2 text-sm">
                      <span className="num text-text-dim">
                        {new Date(sib.consultedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}
                      </span>
                      {sSubject ? <span>· {sSubject}</span> : null}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${sBadge.class}`}>
                        {sBadge.label}
                      </span>
                      <ExternalLink className="text-text-faint size-3.5" />
                    </span>
                  </WindowLink>
                  {/* 쓰기 권한이 있을 때만 — 읽기 전용 계정에 눌리지 않는 버튼을 보여주지 않는다. */}
                  {canWrite ? <MergeButton ids={[id, sib.id]} currentId={id} /> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* 전화·방문·등록 확인 기록(s2_0063) — 이 상담의 예약·실제 방문·등록 근거 · 첫 페인트를 막지 않게 따로 스트리밍(B7). */}
      <Suspense fallback={<JourneyPanelSkeleton />}><JourneyPanel id={consult.id} /></Suspense>

      {consult.processingStatus === "failed" ? (
        <section className="border-chart-4/40 bg-chart-4/5 rounded-2xl border p-4">
          <div className="inline-flex items-center gap-2">
            <AlertCircle className="text-chart-4 size-4" />
            <h2 className="text-foreground text-sm font-bold">처리 실패</h2>
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            {consult.processingError ?? "알 수 없는 오류"}
          </p>
        </section>
      ) : null}

      {isProcessing ? (
        <section className="bg-card border-border space-y-3 rounded-2xl border p-5">
          <div className="inline-flex items-center gap-2">
            <Loader2 className="text-chart-3 size-4 animate-spin" />
            <h2 className="text-foreground text-sm font-bold">
              {consult.processingStatus === "uploaded" || consult.processingStatus === "transcribing"
                ? "녹음을 한국어로 전사 중입니다"
                : "AI가 상담록을 12개 섹션으로 분석 중입니다"}
            </h2>
          </div>
          <p className="text-muted-foreground text-xs">
            상담 1분당 5–10초 정도 소요됩니다. 페이지를 떠나도 백그라운드에서 계속 진행됩니다.
          </p>
          <div className="space-y-2">
            <div className="bg-muted h-3 w-3/4 animate-pulse rounded" />
            <div className="bg-muted h-3 w-1/2 animate-pulse rounded" />
            <div className="bg-muted h-3 w-2/3 animate-pulse rounded" />
          </div>
        </section>
      ) : null}

      {/* ── 상담 기록(왼쪽) ↔ 사전 체크리스트(오른쪽) 2단 ──
          전폭 적층이면 넓은 창에서 라벨↔값이 멀어지고 우측이 통째로 논다. 상담사는 상담 기록을 보면서
          학부모 사전 답변을 곁에 두고 판단하므로 나란히 둔다(원장 지시 2026-07-15). 오른쪽 단은
          체크리스트가 있거나 QR 접수 건일 때만 만든다 — 없으면 왼쪽이 전폭을 그대로 쓴다(빈 단 방지).
          좁은 창(<xl)은 1단으로 접혀 위→아래 순서. */}
      <div
        className={
          showChecklistPane
            ? "grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,23rem)] xl:items-start"
            : undefined
        }
      >
      {/* ── 상담 기록 (입력 정보) — 수정 폼과 동일한 카드 구조/그룹핑(접수 → 학생정보|상담내용 → 학원관리 → 후속조치 → 등록결제). ── */}
      <div className="space-y-3">
        <SectionHeader icon={ClipboardList} title="상담 기록">
          {consult.fromPublicIntake ? (
            <span className="text-chart-1 bg-chart-1/10 border-chart-1/20 inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap">
              학부모 직접 제출
            </span>
          ) : null}
        </SectionHeader>

        {/* 1. 접수 정보 */}
        <InfoCard
          title="접수 정보"
          rows={[
            ["상담자", f.counselor ?? consult.consultantName],
            ["접수일", f.receivedDate, true],
            ["상담 경로", f.consultationPath],
            // 못 읽었으면(ready=false) 줄째 뺀다 — '—'면 "소개 없음"으로 읽힌다.
            ...(referrer.ready
              ? [["소개한 사람", referrer.referrer
                  ? `${referrer.referrer.label}${referrer.referrer.hint ? ` · ${referrer.referrer.hint}` : ""}`
                  : referrer.referrerName ? `${referrer.referrerName}(신청서에 적은 이름 · 아직 연결 전)` : null] as InfoRow]
              : []),
          ]}
        />

        {/* 2. 학생 정보 ↔ 상담 내용 (2단, 상담내용이 세로공간 채움) */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <InfoCard
            title="학생 정보"
            rows={[
              ["학년", consult.prospectGrade],
              ["학교", consult.prospectSchool],
              ["학생 전화", f.studentPhone, true],
              ["영문 이름", f.englishName],
              ["성별", genderLabel],
              ["혈액형", f.bloodType ? `${f.bloodType}형` : null],
              ["생년월일", f.birthDate, true],
              ["집 전화", f.homePhone, true],
              ["주소", addr],
              ["우편번호", f.zipCode, true],
              ["보호자 성함", consult.parentName],
              ["보호자 연락처", consult.parentPhone, true],
              ["학생과의 관계", f.parentRelation],
              // 셔틀 기능이 꺼진 학원엔 줄째 없다(수정 폼과 같음 — 기능 스위치 OFF = 흔적 없이).
              ...(isModuleEnabled(settings.modules.disabled, "shuttle")
                ? // 칸이 not null default false라 '안 적음'이 없다 — QR에선 학부모가 고른 '미신청'이기도 하다.
                  [["셔틀버스", f.shuttleBusRequest ? "신청" : "미신청"] as InfoRow]
                : []),
            ]}
          />

          {/* 상담 내용 — 상담일/과목 + 자유서술(학부모 QR/상담사 입력). 세로공간 전부 채움. */}
          <SectionCard title="상담 내용" fill>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span className="text-text-dim text-xs">
                상담일 <span className="num text-foreground ml-0.5">{consultationDateLabel}</span>
              </span>
              <span className="text-text-dim text-xs">
                과목{" "}
                {subjectLabel ? (
                  <span className="text-foreground ml-0.5">{subjectLabel}</span>
                ) : (
                  <span className="text-text-faint ml-0.5">—</span>
                )}
              </span>
            </div>
            <div className="flex flex-1 flex-col">
              {consult.parentRequest ? (
                <p className="text-foreground min-h-24 flex-1 overflow-y-auto text-sm leading-relaxed break-words whitespace-pre-wrap">
                  {consult.parentRequest}
                </p>
              ) : (
                <p className="text-text-faint flex-1 text-sm">기재된 상담 내용이 없습니다.</p>
              )}
              {/* AI 액션 2종 — 같은 컴팩트 버튼으로 가로 정렬. ① 요약 채우기/덧붙이기(직접 쓰기) ② 추출기 후보 보기(펼침+편집 링크). */}
              <ConsultationContentActions
                consultationId={consult.id}
                hasExisting={!!consult.parentRequest}
                canAddSummary={!!consult.audioReport?.summary?.trim()}
                aiSuggestion={showParentRequestSuggestion ? aiSuggestedParentRequest : null}
                editHref={`/enrollment/${consult.id}/edit`}
                canWrite={canWrite}
              />
              {/* makeedu 동기화 예비상담(makeedu_id=counselSeq) → 원본 상세 링크(클릭 시 makeedu 로그인 필요). */}
              {consult.makeeduId ? (
                <a
                  href={makeeduCounselUrl(consult.makeeduId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary mt-3 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
                >
                  makeedu에서 원본 상세 보기 <ExternalLink className="size-3.5" />
                </a>
              ) : null}
            </div>
          </SectionCard>
        </div>

        {/* 3. 학원 관리 정보 */}
        <InfoCard
          title="학원 관리 정보"
          optional
          rows={[
            ["희망 진로", f.careerGoal],
            ["학생 구분", f.studentType],
            ["남매 관계", f.siblings],
            ["남매 관계 기록", f.siblingsDetails],
            ["안전사항", f.safetyNotes],
            ["이전 학원", consult.learningHistory?.prevAcademy ?? null],
            ["최근 성적", consult.learningHistory?.lastScore ?? null],
            [
              "약점 단원",
              consult.learningHistory?.weakSubjects?.length
                ? consult.learningHistory.weakSubjects.join(", ")
                : null,
            ],
          ]}
        />

        {/* 4. 후속 조치 */}
        <InfoCard
          title="후속 조치"
          optional
          rows={[
            ["후속 조치일", f.followUpDate, true],
            ["조치 내용", f.followUpContent],
            ["미등록 사유", f.nonRegistrationReason],
          ]}
        />

        <InfoCard
          title="상담 상태 / 동의"
          rows={[
            ["상담 상태", badge.label],
            ["개인정보 동의", f.privacyAgreement ? "동의" : null],
            ["환불·학칙 동의", f.installmentAgreement ? "동의" : null],
          ]}
        />
        <InfoCard
          title="과거 결제 기록"
          optional
          rows={[
            ["결제 금액", f.paymentAmount ? `${Number(f.paymentAmount).toLocaleString()}원` : null],
            ["결제일", f.paymentDate, true],
            ["등록자", f.registrar],
          ]}
        />

        {/* 6. 과목별 점수 */}
        <SubjectScoresCard details={f.subjectDetails} />

      </div>

      {/* 오른쪽 단 — 사전 체크리스트. **없어도 자리를 잡는다**(QR 접수 건 한정): 카드가 아예 없으면
          상담사가 "있는데 안 보이나?" 싶어 수정 화면 탭까지 열어봐야 했다(원장 지적 2026-07-15). */}
      {showChecklistPane ? (
        <div className="space-y-3">
          <SectionHeader icon={ClipboardCheck} iconClass="text-chart-1" title="사전 체크리스트">
            <span className="text-text-faint text-xs whitespace-nowrap">학부모 작성</span>
          </SectionHeader>
          <SectionCard title="상담 전 응답">
            {f.intakeChecklist ? (
              <ChecklistView checklist={f.intakeChecklist} />
            ) : (
              <p className="text-text-faint text-sm leading-relaxed break-keep">
                학부모가 작성한 사전 체크리스트가 없는 접수입니다. (체크리스트 도입 전 QR로 접수된 건)
              </p>
            )}
          </SectionCard>
        </div>
      ) : null}
      </div>

      {/* ── AI 분석 ── */}
      <div className="space-y-4">
        <SectionHeader icon={Sparkles} iconClass="text-gold" title="AI 분석" />
        {/* 재분석 진행 표시 — 버튼이 있는 이 섹션에서 바로 보이게(상단 배너는 시야 밖). StatusWatcher가 완료 시 자동 갱신. */}
        {consult.processingStatus === "analyzing" && consult.audioReport ? (
          <div className="border-chart-3/20 bg-chart-3/5 flex items-center gap-2 rounded-md border px-3.5 py-2.5">
            <Loader2 className="text-chart-3 size-4 shrink-0 animate-spin" />
            <p className="text-foreground text-xs">
              AI가 다시 분석 중입니다 — 완료되면 아래 결과가 자동으로 갱신됩니다.
            </p>
          </div>
        ) : null}
        {consult.audioReport && consult.aiAnalysis ? (
          <ConsultationReportEditor
            report={consult.audioReport}
            analysisId={consult.aiAnalysis.id}
            consultationId={consult.id}
            generatedAt={consult.aiAnalysis.generatedAt}
            modelVersion={consult.aiAnalysis.modelVersion}
            editedBy={consult.aiAnalysis.reportEditedBy}
            editedAt={consult.aiAnalysis.reportEditedAt}
            studentName={consult.prospectName}
            consultationDate={consult.consultedAt?.slice(0, 10)}
            transcript={consult.transcription}
            canWrite={canWrite}
          />
        ) : consult.aiAnalysis ? (
          <AiAnalysisPanel
            analysis={consult.aiAnalysis}
            recommendedClasses={consult.recommendedClasses}
            subjectLabelOf={(k) => subjectMaps.labelOf(k)}
          />
        ) : !isProcessing ? (
          <Card title="AI 분석 결과">
            <p className="text-muted-foreground py-12 text-center text-sm">
              아직 AI 분석이 실행되지 않았습니다.
              <br />
              상담 완료 후 분석을 실행하면 학생 진단과 추천 반이 자동 생성됩니다.
            </p>
          </Card>
        ) : null}

        {consult.recordings.length > 0 ? (
          // 녹음 = 여러 행(0068a) — 행마다 메타·상태·전사. speakerRoles는 **완료 녹음이 1개일 때만**
          // (웹훅 multi 판정과 동일 기준 — 실패 행이 껴도 유일한 유효 전사의 역할 라벨이 살아있게).
          <RecordingsSection
            recordings={consult.recordings}
            speakerRoles={
              consult.recordings.filter((r) => r.status === "completed").length === 1
                ? consult.speakerRoles
                : null
            }
          />
        ) : consult.transcription || (consult.speakerLabels?.length ?? 0) > 0 ? (
          // 레거시 폴백 — 녹음 행이 없는 옛 데이터(단일 컬럼만 채워진 경우).
          <TranscriptSection
            utterances={consult.speakerLabels}
            speakerRoles={consult.speakerRoles}
            plainText={consult.transcription}
          />
        ) : null}
      </div>

      {/* 지난 상담 브리프 — 상담이 끝난 뒤엔 준비물이 아니라 기록이라 맨 아래(기본 접힘).
          🔴 위쪽 `briefNode`와 **같은 한 벌**이다(둘 중 하나만 렌더된다). */}
      {pastBrief ? briefNode : null}
    </div>
  );
}

// 공용 카드 — 좌측 정보·우측 AI 분석 섹션이 모두 이 단일 박스 스타일을 쓴다(좌우 통일).
// 이모지 + 굵은 라벨 헤더(이중 박스 느낌의 별도 음영 바 없이) → 섹션 구분은 또렷하되 중복돼 보이지 않게.
function Card({ title, icon, children }: { title: string; icon?: AywaIconName; children: ReactNode }) {
  return (
    <section className="bg-card border-line rounded-2xl border p-4">
      <h3 className="text-foreground mb-2.5 flex items-center gap-1.5 text-sm font-bold">
        {icon ? <EyIcon name={icon} size={15} /> : null}
        {title}
      </h3>
      {children}
    </section>
  );
}

// 섹션 헤더(상담 기록 / AI 분석) — 아이콘 + 제목 + 배지 슬롯.
function SectionHeader({
  icon: Icon,
  iconClass,
  title,
  children,
}: {
  icon: LucideIcon;
  iconClass?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-2 pt-1">
      <Icon className={`size-4 shrink-0 ${iconClass ?? "text-primary"}`} />
      <h2 className="text-foreground text-sm font-bold">{title}</h2>
      {children}
    </header>
  );
}

// 수정 폼과 동일한 카드 스타일(단일 박스 + 상단 음영 헤더바 + primary 제목) — 읽기/편집 화면 톤 통일.
function SectionCard({ title, children, fill }: { title: string; children: ReactNode; fill?: boolean }) {
  return (
    <section className={`bg-card border-border overflow-hidden rounded-2xl border ${fill ? "flex h-full flex-col" : ""}`}>
      <div className="border-border bg-bg-soft/50 border-b px-3 py-1.5">
        <h3 className="text-primary text-xs font-bold">{title}</h3>
      </div>
      <div className={`space-y-2 p-2.5 ${fill ? "flex flex-1 flex-col" : ""}`}>{children}</div>
    </section>
  );
}

// 빈 값도 줄을 남기고 '—'로 보인다 — 어떤 칸이 비었는지 상세에서 바로 알 수 있게(원장 2026-10-19).
function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-text-dim shrink-0 text-xs">{label}</dt>
      {value ? (
        <dd className={`text-foreground text-right text-sm break-keep ${mono ? "num" : ""}`}>{value}</dd>
      ) : (
        <dd className="text-text-faint text-right text-sm">—</dd>
      )}
    </div>
  );
}

type InfoRow = [label: string, value: string | null, mono?: boolean];

// 모든 행을 그린다(빈 값은 '—'). 체크 칸(동의·셔틀)도 행으로 — 칩이면 안 고른 것이 아예 안 보인다.
// 단 `optional`(수정 폼의 '(선택)' 카드 — 학원 관리 정보·후속 조치)은 값이 있는 행만, 다 비면 카드째 안 그린다(원장 2026-10-19).
function InfoCard({ title, rows, optional }: { title: string; rows: InfoRow[]; optional?: boolean }) {
  const shown = optional ? rows.filter(([, v]) => v) : rows;
  if (shown.length === 0) return null;
  return (
    <SectionCard title={title}>
      <dl className="space-y-1.5">
        {shown.map(([label, value, mono]) => (
          <Row key={label} label={label} value={value} mono={mono} />
        ))}
      </dl>
    </SectionCard>
  );
}

function AiAnalysisPanel({
  analysis,
  recommendedClasses,
  subjectLabelOf,
}: {
  analysis: AiAnalysisDetail;
  recommendedClasses: { id: string; className: string; subject: string }[];
  // 과목 라벨은 학원설정 단일 소스(buildSubjectMaps) — 예전엔 raw 키(`math`)를 그대로 찍었다.
  subjectLabelOf: (key: string) => string;
}) {
  const { diagnosis, learningPlan } = analysis;
  return (
    <div className="space-y-4">
      <section className="bg-card border-border rounded-2xl border p-5">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow">AI 분석 결과</p>
            <h3 className="text-foreground mt-1 text-base font-bold">진단 요약</h3>
          </div>
          <span className="text-muted-foreground num text-xs">
            {formatCreatedAt(analysis.generatedAt)}
          </span>
        </header>
        <p className="text-foreground mt-3 text-sm leading-relaxed">{diagnosis.summary}</p>
        <p className="text-muted-foreground mt-3 text-xs">
          종합 수준:{" "}
          <span className="text-foreground font-medium">{diagnosis.level}</span>
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card title="강점">
          <ul className="space-y-1.5 text-sm">
            {diagnosis.strengths.map((s) => (
              <li key={s} className="text-foreground flex gap-2">
                <EyIcon name="plus" size={13} className="text-chart-2 mt-0.5 shrink-0" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="약점">
          <ul className="space-y-1.5 text-sm">
            {diagnosis.weaknesses.map((w) => (
              <li key={w} className="text-foreground flex gap-2">
                <EyIcon name="minus" size={13} className="text-chart-4 mt-0.5 shrink-0" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="학습 계획">
        <div className="space-y-4 text-sm">
          <Plan label="즉시 (4주)" items={learningPlan.immediate} />
          <Plan label="이번 학기" items={learningPlan.semester} />
          <Plan label="장기" items={learningPlan.longTerm} />
        </div>
      </Card>

      {recommendedClasses.length > 0 ? (
        <Card title="추천 반">
          <ul className="space-y-2 text-sm">
            {recommendedClasses.map((c) => (
              <li
                key={c.id}
                className="border-border bg-muted/30 flex items-center justify-between rounded-md border px-3 py-2"
              >
                <span className="text-foreground font-medium">{c.className}</span>
                <span className="text-muted-foreground text-xs">{subjectLabelOf(c.subject)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function Plan({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs font-bold">
        {label}
      </p>
      <ul className="mt-1.5 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-foreground flex gap-2">
            <span className="text-muted-foreground shrink-0">·</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 전역 과목 필드 라벨 맵 — 모든 과목/영어/공통 필드 라벨을 한 번에 시드. 어떤 키가 어느 과목에 저장돼
// 있어도(예: 수학 details에 levelTestScore) 한글 라벨로 해석 → 상세 '과목별 점수'에 raw 키가 안 새게.
const SUBJECT_FIELD_LABELS: Record<string, string> = (() => {
  const map: Record<string, string> = { testType: "테스트 유형" };
  COMMON_FIELDS.fields.forEach((fd) => (map[fd.key] = fd.label));
  SUBJECT_TABS.forEach((t) => (t.groups ?? []).forEach((g) => g.fields.forEach((fd) => (map[fd.key] = fd.label))));
  Object.values(ENGLISH_GROUPS)
    .flat()
    .forEach((g) => g.fields.forEach((fd) => (map[fd.key] = fd.label)));
  return map;
})();

function SubjectScoresCard({ details }: { details: Record<string, Record<string, string>> | null }) {
  if (!details) return null;
  const entries = Object.entries(details).filter(
    ([, vals]) => vals && Object.values(vals).some((v) => String(v).trim()),
  );
  if (entries.length === 0) return null;
  const ENG_TYPE: Record<string, string> = { ai: "AI 레벨테스트", nelt: "NELT", eie: "EiE" };
  return (
    <Card icon="chart" title="과목별 점수">
      <div className="space-y-4">
        {entries.map(([subj, vals]) => {
          const tab = SUBJECT_TABS.find((t) => t.key === subj);
          const labels = SUBJECT_FIELD_LABELS;
          const items = Object.entries(vals).filter(([k, v]) => String(v).trim() && k !== "testType");
          return (
            <div key={subj}>
              <p className="text-primary text-xs font-bold">
                {tab?.label ?? subj}
                {subj === "english" && vals.testType
                  ? ` · ${ENG_TYPE[vals.testType] ?? vals.testType}`
                  : ""}
              </p>
              {/* 좁은 '상담 기록' 컬럼에 맞춰 단일 컬럼(라벨↔값) — 긴 값도 안 잘리게. */}
              <dl className="mt-1 space-y-1">
                {items.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground shrink-0 text-xs">{labels[k] ?? k}</dt>
                    <dd className="text-foreground text-right text-xs break-keep">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
