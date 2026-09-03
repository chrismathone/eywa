import { notFound } from "next/navigation";
import { AlertCircle, CheckSquare, Loader2, Mic, Printer, Scissors, Sparkles, Users } from "@/components/icons/eywa-icon-compat";
import { PrintWindowButton } from "@/components/workspace/print-window";
import { requireAccess } from "@/lib/auth/require-access";
import { BackLink } from "@/components/back-link";
import { formatCreatedAt } from "@/lib/utils";
import {
  getMeetingById,
  getStaffOptions,
  type MeetingActionItem,
  type MeetingProcessingStatus,
} from "@/features/meetings/server/queries";
import { MeetingNotepad } from "./meeting-notepad";
import { SpeakerEditor } from "./speaker-editor";
import {
  MeetingDeleteButton,
  MeetingRegenerateButton,
  MeetingRetryButton,
} from "./meeting-actions";
import { MeetingStatusWatcher } from "./status-watcher";
import { TranscriptSection } from "@/components/transcript-section";
import { MeetingReportAccordion } from "./ai-report";
import { MeetingTitleEditor } from "./meeting-title-editor";
import { MeetingTxtButton } from "./meeting-txt-button";
import { trimTrailingNoise } from "@/lib/ai/transcript-trim";

export const metadata = { title: "회의록 상세 — eywa" };

const STATUS_BADGE: Record<
  MeetingProcessingStatus,
  { label: string; class: string; spin?: boolean } | null
> = {
  idle: null,
  uploaded: { label: "분석 대기", class: "text-chart-3 bg-chart-3/10 border-chart-3/20" },
  transcribing: {
    label: "전사 중",
    class: "text-chart-3 bg-chart-3/10 border-chart-3/20",
    spin: true,
  },
  analyzing: {
    label: "AI 분석 중",
    class: "text-chart-3 bg-chart-3/10 border-chart-3/20",
    spin: true,
  },
  completed: { label: "완료", class: "text-green bg-green-soft border-green/25" },
  failed: { label: "실패", class: "text-chart-4 bg-chart-4/10 border-chart-4/20" },
};

function formatHeldAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}분 ${r}초`;
}

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("meetings");
  const { id } = await params;
  const meeting = await getMeetingById(id);
  if (!meeting) notFound();

  // 화자 지정용 직원 옵션 — 전사가 있을 때만 의미 있지만 쿼리가 가벼워 무조건 로드.
  const staffOptions = meeting.transcription ? await getStaffOptions() : [];

  const badge = STATUS_BADGE[meeting.processingStatus];
  const hasAudio = !!meeting.audioPath;
  const isProcessing =
    meeting.processingStatus === "uploaded" ||
    meeting.processingStatus === "transcribing" ||
    meeting.processingStatus === "analyzing";
  const hasAiReport = !!meeting.aiReport || !!meeting.aiSummary;
  const hasTranscription = !!meeting.transcription;
  const hasNotepad = !!meeting.content?.trim();
  // 전사·메모 중 하나라도 있으면 "AI로 정리"(regenerate) 가능. 결과가 이미 있으면 "다시 생성" 라벨.
  const canOrganize = (hasTranscription || hasNotepad) && !isProcessing;
  const organizeLabel = hasAiReport ? "AI 분석 다시 생성" : "AI로 정리";

  // B: 회의 종료 후 못 끈 뒷부분 잡음 꼬리가 분석에서 제외됐는지 — 저장된 화자 라벨로 재계산(분석 입력과 동일 함수).
  const tailTrim =
    meeting.speakerLabels && meeting.speakerLabels.length > 0 ? trimTrailingNoise(meeting.speakerLabels) : null;
  const excludedTail = tailTrim && tailTrim.removed.length > 0 ? tailTrim : null;

  return (
    <div className="space-y-6">
      <MeetingStatusWatcher meetingId={meeting.id} initialStatus={meeting.processingStatus} />

      <BackLink href="/meetings" label="회의록으로" />

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="eyebrow">{formatHeldAt(meeting.heldAt)}</p>
            {badge ? (
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium ${badge.class}`}
              >
                {badge.spin ? <Loader2 className="size-3 animate-spin" /> : null}
                {badge.label}
              </span>
            ) : null}
          </div>
          <MeetingTitleEditor meetingId={meeting.id} title={meeting.title} />
          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
            <span className="num">{formatTime(meeting.heldAt)}</span>
            {meeting.attendees.length > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-3.5" />
                <span className="num">{meeting.attendees.length}명</span>
                <span className="text-muted-foreground/80">· {meeting.attendees.join(", ")}</span>
              </span>
            ) : null}
            {hasAudio && meeting.audioDurationSec ? (
              <span className="inline-flex items-center gap-1.5">
                <Mic className="size-3.5" />
                <span className="num">{formatDuration(meeting.audioDurationSec)}</span>
              </span>
            ) : null}
            {meeting.authorName ? <span>· 작성 {meeting.authorName}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasAiReport ? (
            <PrintWindowButton id={`print/meetings/${id}`} href={`/meetings/${id}/print`} title="회의록">
              <Printer className="size-4" />
              인쇄 미리보기
            </PrintWindowButton>
          ) : null}
          {hasAiReport || meeting.content || meeting.transcription ? (
            <MeetingTxtButton
              title={meeting.title}
              heldAt={meeting.heldAt}
              attendees={meeting.attendees}
              content={meeting.content}
              transcription={meeting.transcription}
              aiReport={meeting.aiReport}
              aiSummary={meeting.aiSummary}
              aiActionItems={meeting.aiActionItems}
            />
          ) : null}
          {/* AI로 정리 — 저장된 전사 + 메모장으로 8섹션 (재)생성(오디오·웹훅 불필요, 즉시 완료). 메모만으로도 가능. */}
          {canOrganize ? (
            <MeetingRegenerateButton meetingId={meeting.id} label={organizeLabel} />
          ) : null}
          {/* 전사부터 다시 — 원본 오디오 재제출로 전사+분석 재생성. 옛 ijw 녹음은 Firebase에서 읽음. */}
          {hasAudio && hasAiReport && !isProcessing ? (
            <MeetingRetryButton
              meetingId={meeting.id}
              label="전사부터 다시"
              variant="outline"
              outerClassName=""
            />
          ) : null}
          <MeetingDeleteButton meetingId={meeting.id} />
        </div>
      </header>

      {/* Failed state — show the error */}
      {meeting.processingStatus === "failed" ? (
        <section className="border-chart-4/40 bg-chart-4/5 rounded-2xl border p-4">
          <div className="inline-flex items-center gap-2">
            <AlertCircle className="text-chart-4 size-4" />
            <h2 className="text-foreground text-sm font-bold">처리 실패</h2>
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            {meeting.processingError ?? "알 수 없는 오류"}
          </p>
          {hasAudio ? <MeetingRetryButton meetingId={meeting.id} /> : null}
        </section>
      ) : null}

      {/* Processing state — skeleton */}
      {isProcessing ? (
        <section className="bg-card border-border space-y-3 rounded-2xl border p-5">
          <div className="inline-flex items-center gap-2">
            <Loader2 className="text-chart-3 size-4 animate-spin" />
            <h2 className="text-foreground text-sm font-bold">
              {meeting.processingStatus === "uploaded" || meeting.processingStatus === "transcribing"
                ? "녹음을 한국어로 전사 중입니다"
                : "AI가 회의록을 8개 섹션으로 분석 중입니다"}
            </h2>
          </div>
          <p className="text-muted-foreground text-xs">
            보통 회의 1분당 5–10초 정도 소요됩니다. 페이지를 떠나도 백그라운드에서 계속 진행됩니다.
          </p>
          <div className="space-y-2">
            <div className="bg-muted h-3 w-3/4 animate-pulse rounded" />
            <div className="bg-muted h-3 w-1/2 animate-pulse rounded" />
            <div className="bg-muted h-3 w-2/3 animate-pulse rounded" />
          </div>
        </section>
      ) : null}

      {/* 메모장 — 회의 중/후 직접 작성한 메모(편집 가능). 저장 후 'AI로 정리'로 전사와 함께 분석.
          처리 중(전사/분석)엔 숨겨 화면 잡음을 줄인다(완료·대기·실패 상태에서 편집). */}
      {!isProcessing ? (
        <MeetingNotepad meetingId={meeting.id} content={meeting.content ?? ""} hasAudio={hasAudio} />
      ) : null}

      {/* 8-section AI report */}
      {meeting.aiReport ? (
        <section className="bg-card border-border space-y-5 rounded-2xl border p-5">
          <header className="space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Sparkles className="text-gold size-4 shrink-0" />
                <h2 className="text-foreground shrink-0 text-sm font-bold whitespace-nowrap">
                  AI 분석
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {meeting.aiGeneratedAt ? (
                  <span className="text-muted-foreground num text-xs whitespace-nowrap">
                    {formatCreatedAt(meeting.aiGeneratedAt)}
                  </span>
                ) : null}
              </div>
            </div>
            {meeting.aiReport.meetingType ? (
              <p className="text-text-dim text-xs">{meeting.aiReport.meetingType}</p>
            ) : null}
          </header>

          <MeetingReportAccordion
            report={meeting.aiReport}
            meetingId={meeting.id}
            editedBy={meeting.aiReportEditedBy}
            editedAt={meeting.aiReportEditedAt}
            modelVersion={meeting.aiModelVersion}
          />
        </section>
      ) : null}

      {/* Legacy text-only AI summary */}
      {!meeting.aiReport && meeting.aiSummary ? (
        <section className="bg-card border-border space-y-5 rounded-2xl border p-5">
          <header className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles className="text-gold size-4 shrink-0" />
              <h2 className="text-foreground shrink-0 text-sm font-bold whitespace-nowrap">
                AI 분석
              </h2>
            </div>
            {meeting.aiGeneratedAt ? (
              <span className="text-muted-foreground num text-xs whitespace-nowrap">
                {formatCreatedAt(meeting.aiGeneratedAt)}
              </span>
            ) : null}
          </header>

          <div className="space-y-2">
            <p className="eyebrow">요약</p>
            <p className="text-foreground text-sm leading-relaxed">{meeting.aiSummary}</p>
          </div>

          {meeting.aiActionItems && meeting.aiActionItems.length > 0 ? (
            <div className="space-y-2">
              <p className="eyebrow">액션 아이템</p>
              <ul className="space-y-2">
                {meeting.aiActionItems.map((item: MeetingActionItem, i) => (
                  <li
                    key={i}
                    className="border-border bg-muted/30 flex items-start gap-3 rounded-md border px-3 py-2.5 text-sm"
                  >
                    <CheckSquare className="text-chart-2 mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground">{item.action}</p>
                      {item.assignee || item.due ? (
                        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          {item.assignee ? <span>담당: {item.assignee}</span> : null}
                          {item.due ? (
                            <>
                              {item.assignee ? <span className="opacity-40">·</span> : null}
                              <span className="num">기한 {item.due}</span>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* 전사(원본 음성인식) — 최하단 보조자료, 기본 접힘. 화자별로 끊어 렌더(ijw 패리티). */}
      {meeting.transcription ? (
        <div className="space-y-3">
          {/* B: 뒷부분 잡음 꼬리가 AI 분석에서 제외됐음을 알림 — 전사에는 전체가 그대로 남는다(데이터 비파괴). */}
          {excludedTail ? (
            <p className="text-text-dim border-line bg-bg-soft flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
              <Scissors className="mt-0.5 size-3.5 shrink-0" />
              <span>
                회의 종료 후 녹음된 뒷부분 발화 <span className="num">{excludedTail.removed.length}</span>개
                {excludedTail.removedDurationSec >= 60
                  ? ` (약 ${Math.round(excludedTail.removedDurationSec / 60)}분)`
                  : ""}
                은 잡음으로 판단해 <b className="text-foreground font-bold">AI 분석에서 제외</b>했습니다. 아래 전사에는
                전체가 그대로 남아 있습니다.
              </span>
            </p>
          ) : null}
          {/* 화자 지정 — 화자 라벨이 있을 때만(diarization 된 회의). 직원 연결로 교정. */}
          {meeting.speakerLabels && meeting.speakerLabels.length > 0 ? (
            <SpeakerEditor
              meetingId={meeting.id}
              utterances={meeting.speakerLabels}
              speakerRoles={meeting.aiSpeakerRoles}
              speakerStaff={meeting.speakerStaff}
              staffOptions={staffOptions}
            />
          ) : null}
          <TranscriptSection
            utterances={meeting.speakerLabels}
            speakerRoles={meeting.aiSpeakerRoles}
            plainText={meeting.transcription}
          />
        </div>
      ) : null}
    </div>
  );
}
