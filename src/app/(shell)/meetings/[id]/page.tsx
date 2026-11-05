import { notFound } from "next/navigation";
import { AlertCircle, CheckSquare, Loader2, Mic, Scissors, Sparkles, Users } from "@/components/icons/aywa-icon-compat";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { toneColor } from "@/lib/design/semantic-color";
import { formatCreatedAt } from "@/lib/utils";
import {
  getMeetingById,
  getStaffOptions,
  type MeetingActionItem,
  type MeetingProcessingStatus,
} from "@/features/meetings/server/queries";
import { MeetingNotepad } from "./meeting-notepad";
import { SpeakerEditor } from "./speaker-editor";
import { MeetingRegenerateButton, MeetingRetryButton } from "./meeting-actions";
import { MeetingMoreMenu } from "./meeting-more-menu";
import { MeetingStatusWatcher } from "./status-watcher";
import { TranscriptSection } from "@/components/transcript-section";
import { MeetingReportAccordion } from "./ai-report";
import { MeetingTitleEditor } from "./meeting-title-editor";
import { trimTrailingNoise } from "@/lib/ai/transcript-trim";

export const metadata = { title: "회의록 상세 — 에이와" };

/** 목록(page.tsx)과 같은 의미색 캐논 — 대기=caution · 처리 중=info · 완료=positive · 실패=critical(옛 chart-3/4 로컬 클래스 폐기). */
const STATUS_BADGE: Record<MeetingProcessingStatus, { label: string; color: PillColor; spin?: boolean } | null> = {
  idle: null,
  uploaded: { label: "분석 대기", color: toneColor("caution") },
  transcribing: { label: "전사 중", color: toneColor("info"), spin: true },
  analyzing: { label: "AI 분석 중", color: toneColor("info"), spin: true },
  completed: { label: "완료", color: toneColor("positive") },
  failed: { label: "실패", color: toneColor("critical") },
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
  const user = await requireAccess("meetings");
  const { id } = await params;
  // 쓰기 판정 = 이 화면의 모든 변경 액션(제목·메모·AI 정리·재전사·삭제·섹션 수정·화자 지정)과 같은 함수.
  // 읽기 권한이면 그 단추·편집기를 그리지 않는다(원장 2026-11-05 — src/lib/write-lock.ts). 인쇄·텍스트 저장은 읽기라 남긴다.
  const [meeting, canWrite] = await Promise.all([getMeetingById(id), canWriteTenant(user.systemRole, "meetings")]);
  if (!meeting) notFound();

  // 화자 지정용 직원 옵션 — 전사가 있고 지정할 수 있을 때만(읽기 권한엔 편집기가 없다).
  const staffOptions = meeting.transcription && canWrite ? await getStaffOptions() : [];

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
  const canOrganize = canWrite && (hasTranscription || hasNotepad) && !isProcessing;
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
              <Pill color={badge.color} className="gap-1">
                {badge.spin ? <Loader2 className="size-3 animate-spin" /> : null}
                {badge.label}
              </Pill>
            ) : null}
          </div>
          <MeetingTitleEditor meetingId={meeting.id} title={meeting.title} canWrite={canWrite} />
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
        {/* 상시 버튼은 둘(지시서 §10): Primary 'AI로 정리'(저장된 전사 + 메모장으로 8섹션 (재)생성 — 오디오·웹훅 불필요) +
            텍스트 '더보기'(인쇄 미리보기 · 텍스트 저장 · 전사부터 다시(원본 오디오 재제출) · 삭제). 옛 머리엔 버튼 다섯이 나란히 섰다. */}
        {/* shrink-0 + nowrap — 최소 창(760)에서 왼쪽 참석자 줄이 길면 이 묶음이 감겨 '더보기'가 Primary 아래로 떨어졌다(실측). */}
        <div className="flex shrink-0 items-center gap-2">
          {canOrganize ? (
            <MeetingRegenerateButton meetingId={meeting.id} label={organizeLabel} />
          ) : null}
          {/* key=상태 — 재전사·삭제 확인 줄(클라 state)이 상태가 바뀐 뒤에도 남아 있지 않게 리셋(effect setState 없이, #25). */}
          <MeetingMoreMenu
            key={meeting.processingStatus}
            meetingId={meeting.id}
            printHref={`/meetings/${id}/print`}
            canPrint={hasAiReport}
            txt={
              hasAiReport || meeting.content || meeting.transcription
                ? {
                    title: meeting.title,
                    heldAt: meeting.heldAt,
                    attendees: meeting.attendees,
                    content: meeting.content,
                    transcription: meeting.transcription,
                    aiReport: meeting.aiReport,
                    aiSummary: meeting.aiSummary,
                    aiActionItems: meeting.aiActionItems,
                  }
                : null
            }
            canRetry={canWrite && hasAudio && hasAiReport && !isProcessing}
            canDelete={canWrite}
          />
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
          {hasAudio && canWrite ? <MeetingRetryButton meetingId={meeting.id} /> : null}
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
        <MeetingNotepad meetingId={meeting.id} content={meeting.content ?? ""} canWrite={canWrite} />
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
            canWrite={canWrite}
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
          {/* 화자 지정 — 화자 라벨이 있고(diarization 된 회의) 쓰기 권한이 있을 때만(updateMeetingSpeakers와 같은 판정). 직원 연결로 교정. */}
          {canWrite && meeting.speakerLabels && meeting.speakerLabels.length > 0 ? (
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
