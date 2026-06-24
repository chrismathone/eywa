import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertCircle,
  CheckSquare,
  FileText,
  Loader2,
  Mic,
  Printer,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { BackLink } from "@/components/back-link";
import { formatCreatedAt } from "@/lib/utils";
import {
  getMeetingById,
  type MeetingActionItem,
  type MeetingProcessingStatus,
} from "@/features/meetings/server/queries";
import { RunMeetingAiButton } from "./run-ai-button";
import { MeetingDeleteButton, MeetingRetryButton } from "./meeting-actions";
import { MeetingStatusWatcher } from "./status-watcher";
import { TranscriptSection } from "@/components/transcript-section";
import { MeetingReportAccordion } from "./ai-report";
import { MeetingTitleEditor } from "./meeting-title-editor";
import { MeetingTxtButton } from "./meeting-txt-button";

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
  completed: { label: "완료", class: "text-chart-2 bg-chart-2/10 border-chart-2/20" },
  failed: { label: "실패", class: "text-chart-4 bg-chart-4/10 border-chart-4/20" },
};

function formatHeldAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
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

  const badge = STATUS_BADGE[meeting.processingStatus];
  const hasAudio = !!meeting.audioPath;
  const isProcessing =
    meeting.processingStatus === "uploaded" ||
    meeting.processingStatus === "transcribing" ||
    meeting.processingStatus === "analyzing";
  const hasAiReport = !!meeting.aiReport || !!meeting.aiSummary;

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
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${badge.class}`}
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
            <Button variant="outline" render={<Link href={`/meetings/${id}/print`} target="_blank" />}>
              <Printer className="size-4" />
              인쇄
            </Button>
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
          {!hasAudio && meeting.content && !hasAiReport ? (
            <RunMeetingAiButton meetingId={meeting.id} hasExisting={false} />
          ) : null}
          {/* 음성 회의록 다시 분석 — 재제출(status 리셋)로 8섹션 리포트 재생성 */}
          {hasAudio && hasAiReport && !isProcessing ? (
            <MeetingRetryButton
              meetingId={meeting.id}
              label="다시 분석"
              variant="outline"
              outerClassName=""
            />
          ) : null}
          <MeetingDeleteButton meetingId={meeting.id} />
        </div>
      </header>

      {/* Failed state — show the error */}
      {meeting.processingStatus === "failed" ? (
        <section className="border-chart-4/40 bg-chart-4/5 rounded-lg border p-4">
          <div className="inline-flex items-center gap-2">
            <AlertCircle className="text-chart-4 size-4" />
            <h2 className="text-foreground text-sm font-semibold">처리 실패</h2>
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            {meeting.processingError ?? "알 수 없는 오류"}
          </p>
          {hasAudio ? <MeetingRetryButton meetingId={meeting.id} /> : null}
        </section>
      ) : null}

      {/* Processing state — skeleton */}
      {isProcessing ? (
        <section className="bg-card border-border space-y-3 rounded-lg border p-5">
          <div className="inline-flex items-center gap-2">
            <Loader2 className="text-chart-3 size-4 animate-spin" />
            <h2 className="text-foreground text-sm font-semibold">
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

      {/* Manual text content — raw notes input by the user. Not AI output. AI 분석 섹션과 헤더 스타일 통일. */}
      {!hasAudio && meeting.content ? (
        <section className="bg-card border-border space-y-3 rounded-lg border p-5">
          <header className="inline-flex items-center gap-2">
            <FileText className="text-text-dim size-4 shrink-0" />
            <h2 className="text-foreground text-sm font-semibold">원본 노트</h2>
          </header>
          <pre className="text-foreground font-sans text-sm whitespace-pre-wrap leading-relaxed">
            {meeting.content}
          </pre>
        </section>
      ) : null}

      {/* 8-section AI report */}
      {meeting.aiReport ? (
        <section className="bg-card border-border space-y-5 rounded-lg border p-5">
          <header className="space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Sparkles className="text-gold size-4 shrink-0" />
                <h2 className="text-foreground shrink-0 text-sm font-semibold whitespace-nowrap">
                  AI 분석
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {!hasAudio && meeting.content ? (
                  <RunMeetingAiButton meetingId={meeting.id} hasExisting variant="link" />
                ) : null}
                {meeting.aiGeneratedAt ? (
                  <span className="text-muted-foreground num text-[11px] whitespace-nowrap">
                    {formatCreatedAt(meeting.aiGeneratedAt)}
                  </span>
                ) : null}
              </div>
            </div>
            {meeting.aiReport.meetingType ? (
              <p className="text-text-dim text-xs">{meeting.aiReport.meetingType}</p>
            ) : null}
          </header>

          <MeetingReportAccordion report={meeting.aiReport} />
        </section>
      ) : null}

      {/* Legacy text-only AI summary */}
      {!meeting.aiReport && meeting.aiSummary ? (
        <section className="bg-card border-border space-y-5 rounded-lg border p-5">
          <header className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles className="text-gold size-4 shrink-0" />
              <h2 className="text-foreground shrink-0 text-sm font-semibold whitespace-nowrap">
                AI 분석
              </h2>
            </div>
            {meeting.aiGeneratedAt ? (
              <span className="text-muted-foreground num text-[11px] whitespace-nowrap">
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
        <TranscriptSection
          utterances={meeting.speakerLabels}
          speakerRoles={meeting.aiSpeakerRoles}
          plainText={meeting.transcription}
        />
      ) : null}
    </div>
  );
}
