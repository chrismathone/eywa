import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertCircle, ClipboardList, ExternalLink, Loader2, Mic, Pencil, Printer, Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PrintWindowButton } from "@/components/workspace/print-window";
import { requireAccess } from "@/lib/auth/require-access";
import { BackLink } from "@/components/back-link";
import { formatCreatedAt } from "@/lib/utils";
import {
  getEnrollmentConsultationById,
  type AiAnalysisDetail,
  type ConsultationProcessingStatus,
} from "@/features/enrollment/server/queries";
import { COMMON_FIELDS, ENGLISH_GROUPS, GENDER_OPTIONS, SUBJECT_TABS } from "@/features/enrollment/form-config";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getClassesList } from "@/features/classes/server/queries";
import { TranscriptSection } from "@/components/transcript-section";
import { RecordingsSection } from "./recordings-section";
import { RunAiButton } from "./run-ai-button";
import { ConsultationReportEditor } from "./consultation-report-editor";
import { AddAiSummaryButton } from "./add-ai-summary-button";
import { ConsultationStatusWatcher } from "./status-watcher";
import { ConvertToStudentDialog } from "./_components/convert-dialog";
import { ConsultationManageButtons, ConsultationDeleteButton } from "./_components/consultation-manage";

export const metadata = { title: "신입생 상담 상세 — eywa" };

const OUTCOME_BADGE: Record<string, { label: string; class: string }> = {
  pending: { label: "대기", class: "text-chart-3 bg-chart-3/10 border-chart-3/20" },
  scheduled: { label: "예약", class: "text-chart-3 bg-chart-3/10 border-chart-3/20" },
  consulted: { label: "상담완료", class: "text-chart-1 bg-chart-1/10 border-chart-1/20" },
  ai_done: { label: "AI 완료", class: "text-chart-2 bg-chart-2/10 border-chart-2/20" },
  enrolled: { label: "등록", class: "text-chart-2 bg-chart-2/10 border-chart-2/20" },
  declined: { label: "거절", class: "text-muted-foreground bg-muted border-border" },
  no_show: { label: "노쇼", class: "text-chart-4 bg-chart-4/10 border-chart-4/20" },
};

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
  await requireAccess("enrollment");
  const { id } = await params;
  const [consult, allClasses, settings] = await Promise.all([
    getEnrollmentConsultationById(id),
    getClassesList({ active: "active" }),
    getTenantSettings(),
  ]);
  if (!consult) notFound();

  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const f = consult.fields;

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
    f.consultationDate ?? new Date(consult.consultedAt).toLocaleDateString("ko-KR");

  const badge = OUTCOME_BADGE[consult.outcome] ?? OUTCOME_BADGE.pending!;
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

      <BackLink href="/enrollment" label="등록상담으로" />

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <p className="eyebrow">신입생 등록상담</p>
          <div className="flex items-baseline gap-3">
            <h1 className="display text-foreground text-3xl">{consult.prospectName}</h1>
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${badge.class}`}
            >
              {badge.label}
            </span>
            {procBadge ? (
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${procBadge.class}`}
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
          <Button variant="outline" render={<Link href={`/enrollment/${id}/edit`} />}>
            <Pencil className="size-4" />
            수정
          </Button>
          <ConsultationManageButtons values={{ id: consult.id, outcome: consult.outcome }} />
          {consult.aiAnalysis ? (
            <PrintWindowButton
              id={`print/enrollment/${id}`}
              href={`/enrollment/${id}/print`}
              title="신입생 인수인계서"
            >
              <Printer className="size-4" />
              인쇄 미리보기
            </PrintWindowButton>
          ) : !consult.hasAudio ? (
            <RunAiButton consultationId={id} />
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
          />
          <ConsultationDeleteButton id={consult.id} />
        </div>
      </header>

      {consult.processingStatus === "failed" ? (
        <section className="border-chart-4/40 bg-chart-4/5 rounded-lg border p-4">
          <div className="inline-flex items-center gap-2">
            <AlertCircle className="text-chart-4 size-4" />
            <h2 className="text-foreground text-sm font-semibold">처리 실패</h2>
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            {consult.processingError ?? "알 수 없는 오류"}
          </p>
        </section>
      ) : null}

      {isProcessing ? (
        <section className="bg-card border-border space-y-3 rounded-lg border p-5">
          <div className="inline-flex items-center gap-2">
            <Loader2 className="text-chart-3 size-4 animate-spin" />
            <h2 className="text-foreground text-sm font-semibold">
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

      {/* ── 상담 기록 (입력 정보) — 수정 폼과 동일한 카드 구조/그룹핑(접수 → 학생정보|상담내용 → 학원관리 → 후속조치 → 등록결제). ── */}
      <div className="space-y-3">
        <SectionHeader icon={ClipboardList} title="상담 기록">
          {consult.fromPublicIntake ? (
            <span className="text-chart-1 bg-chart-1/10 border-chart-1/20 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap">
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
            ]}
            flags={[f.shuttleBusRequest ? "셔틀버스 신청" : null]}
          />

          {/* 상담 내용 — 상담일/과목 + 자유서술(학부모 QR/상담사 입력). 세로공간 전부 채움. */}
          <SectionCard title="상담 내용" fill>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span className="text-text-dim text-xs">
                상담일 <span className="num text-foreground ml-0.5">{consultationDateLabel}</span>
              </span>
              {subjectLabel ? (
                <span className="text-text-dim text-xs">
                  과목 <span className="text-foreground ml-0.5">{subjectLabel}</span>
                </span>
              ) : null}
            </div>
            <div className="flex flex-1 flex-col">
              {consult.parentRequest ? (
                <p className="text-foreground min-h-24 flex-1 overflow-y-auto text-sm leading-relaxed break-words whitespace-pre-wrap">
                  {consult.parentRequest}
                </p>
              ) : (
                <p className="text-text-faint flex-1 text-sm">기재된 상담 내용이 없습니다.</p>
              )}
              {/* AI 분석의 '상담 요약'을 상담 내용에 채우기/덧붙이기(원장 요청). 분석에 요약이 있을 때만 노출. */}
              {consult.audioReport?.summary?.trim() ? (
                <AddAiSummaryButton consultationId={consult.id} hasExisting={!!consult.parentRequest} />
              ) : null}
              {/* 녹음 분석이 정리한 상담 내용 — 이미 입력값이 있어 자동입력에서 버려진 버전을 되살려 제시(비파괴). */}
              {showParentRequestSuggestion ? (
                <details className="border-gold/40 bg-gold-soft/30 mt-2 rounded-md border px-3 py-2">
                  <summary className="text-foreground flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium">
                    <Sparkles className="text-gold size-3.5 shrink-0" />
                    AI가 정리한 상담 내용 보기
                  </summary>
                  <p className="text-text-dim mt-2 max-h-48 overflow-y-auto text-xs leading-relaxed break-words whitespace-pre-wrap">
                    {aiSuggestedParentRequest}
                  </p>
                  <Link
                    href={`/enrollment/${consult.id}/edit`}
                    className="text-gold hover:text-gold/80 mt-2 inline-flex items-center gap-1 text-xs font-medium"
                  >
                    수정에서 반영하기 <ExternalLink className="size-3" />
                  </Link>
                </details>
              ) : null}
              {/* makeedu 동기화 예비상담(makeedu_id=counselSeq) → 원본 상세 링크(클릭 시 makeedu 로그인 필요). */}
              {consult.makeeduId ? (
                <a
                  href={`https://school.makeedu.co.kr/counsel/counselList_detail.do?counselSeq=${consult.makeeduId}`}
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
          rows={[
            ["후속 조치일", f.followUpDate, true],
            ["조치 내용", f.followUpContent],
            ["미등록 사유", f.nonRegistrationReason],
          ]}
        />

        {/* 5. 등록 / 결제 */}
        <InfoCard
          title="등록 / 결제"
          rows={[
            ["등록 상태", f.registrationStatus],
            ["결제 금액", f.paymentAmount ? `${Number(f.paymentAmount).toLocaleString()}원` : null],
            ["결제일", f.paymentDate, true],
            ["등록자", f.registrar],
          ]}
          flags={[
            f.privacyAgreement ? "개인정보 동의" : null,
            f.installmentAgreement ? "환불·학칙 동의" : null,
          ]}
        />

        {/* 6. 과목별 점수 */}
        <SubjectScoresCard details={f.subjectDetails} />
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
            editedBy={consult.aiAnalysis.reportEditedBy}
            editedAt={consult.aiAnalysis.reportEditedAt}
            studentName={consult.prospectName}
            consultationDate={consult.consultedAt?.slice(0, 10)}
            transcript={consult.transcription}
          />
        ) : consult.aiAnalysis ? (
          <AiAnalysisPanel
            analysis={consult.aiAnalysis}
            recommendedClasses={consult.recommendedClasses}
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
    </div>
  );
}

// 공용 카드 — 좌측 정보·우측 AI 분석 섹션이 모두 이 단일 박스 스타일을 쓴다(좌우 통일).
// 이모지 + 굵은 라벨 헤더(이중 박스 느낌의 별도 음영 바 없이) → 섹션 구분은 또렷하되 중복돼 보이지 않게.
function Card({ title, emoji, children }: { title: string; emoji?: string; children: ReactNode }) {
  return (
    <section className="bg-card border-line rounded-md border p-4">
      <h3 className="text-foreground mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold">
        {emoji ? <span className="text-[15px] leading-none">{emoji}</span> : null}
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
      <h2 className="text-foreground text-sm font-semibold">{title}</h2>
      {children}
    </header>
  );
}

// 수정 폼과 동일한 카드 스타일(단일 박스 + 상단 음영 헤더바 + primary 제목) — 읽기/편집 화면 톤 통일.
function SectionCard({ title, children, fill }: { title: string; children: ReactNode; fill?: boolean }) {
  return (
    <section className={`bg-card border-border overflow-hidden rounded-lg border ${fill ? "flex h-full flex-col" : ""}`}>
      <div className="border-border bg-bg-soft/50 border-b px-3 py-1.5">
        <h3 className="text-primary text-xs font-bold">{title}</h3>
      </div>
      <div className={`space-y-2 p-2.5 ${fill ? "flex flex-1 flex-col" : ""}`}>{children}</div>
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-text-dim shrink-0 text-xs">{label}</dt>
      <dd className={`text-foreground text-right text-sm break-keep ${mono ? "num" : ""}`}>{value}</dd>
    </div>
  );
}

// 값이 있는 행만 렌더(빈 값 숨김). 표시할 행·플래그·자식이 하나도 없으면 카드 자체를 안 그림.
function InfoCard({
  title,
  rows,
  flags,
  children,
}: {
  title: string;
  rows?: [label: string, value: string | null, mono?: boolean][];
  flags?: (string | null)[];
  children?: ReactNode;
}) {
  const visible = (rows ?? []).filter(([, v]) => v);
  const chips = (flags ?? []).filter(Boolean) as string[];
  if (!children && visible.length === 0 && chips.length === 0) return null;
  return (
    <SectionCard title={title}>
      {visible.length > 0 ? (
        <dl className="space-y-1.5">
          {visible.map(([label, value, mono]) => (
            <Row key={label} label={label} value={value} mono={mono} />
          ))}
        </dl>
      ) : null}
      {children}
      {chips.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {chips.map((t) => (
            <span key={t} className="bg-bg-soft text-text-dim rounded px-2 py-0.5 text-[11px]">
              {t}
            </span>
          ))}
        </div>
      ) : null}
    </SectionCard>
  );
}

function AiAnalysisPanel({
  analysis,
  recommendedClasses,
}: {
  analysis: AiAnalysisDetail;
  recommendedClasses: { id: string; className: string; subject: string }[];
}) {
  const { diagnosis, learningPlan } = analysis;
  return (
    <div className="space-y-4">
      <section className="bg-card border-border rounded-lg border p-5">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow">AI 분석 결과</p>
            <h3 className="text-foreground mt-1 text-base font-semibold">진단 요약</h3>
          </div>
          <span className="text-muted-foreground num text-[10px]">
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
                <span className="text-chart-2 shrink-0">＋</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="약점">
          <ul className="space-y-1.5 text-sm">
            {diagnosis.weaknesses.map((w) => (
              <li key={w} className="text-foreground flex gap-2">
                <span className="text-chart-4 shrink-0">－</span>
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
                <span className="text-muted-foreground text-xs">{c.subject}</span>
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
      <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
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
    <Card emoji="📊" title="과목별 점수">
      <div className="space-y-4">
        {entries.map(([subj, vals]) => {
          const tab = SUBJECT_TABS.find((t) => t.key === subj);
          const labels = SUBJECT_FIELD_LABELS;
          const items = Object.entries(vals).filter(([k, v]) => String(v).trim() && k !== "testType");
          return (
            <div key={subj}>
              <p className="text-primary text-xs font-semibold">
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
