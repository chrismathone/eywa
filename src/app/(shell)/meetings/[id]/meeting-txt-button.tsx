"use client";

import { Download } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import type {
  MeetingActionItem,
  MeetingReportSection,
} from "@/features/meetings/server/queries";

// ai-report.tsx의 섹션 정의와 동일 순서(meetingType 제외) — TXT 직렬화용.
const SECTIONS: { key: Exclude<keyof MeetingReportSection, "meetingType">; label: string }[] = [
  { key: "summary", label: "요약" },
  { key: "agendaDiscussion", label: "안건별 논의" },
  { key: "decisions", label: "결정 사항" },
  { key: "actionItems", label: "액션 아이템" },
  { key: "speakerSummary", label: "참석자별 발언" },
  { key: "concerns", label: "우려 / 위험 요소" },
  { key: "nextSteps", label: "다음 단계" },
];

/** 회의록을 평문 TXT로 다운로드(클라 Blob) — 제목·일시·참석자·원본/전사·AI 8섹션. 서버 불필요. */
export function MeetingTxtButton({
  title,
  heldAt,
  attendees,
  content,
  transcription,
  aiReport,
  aiSummary,
  aiActionItems,
}: {
  title: string;
  heldAt: string;
  attendees: string[];
  content: string | null;
  transcription: string | null;
  aiReport: MeetingReportSection | null;
  aiSummary: string | null;
  aiActionItems: MeetingActionItem[] | null;
}) {
  const build = (): string => {
    const lines: string[] = [];
    lines.push(`[회의록] ${title}`);
    lines.push(`일시: ${new Date(heldAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`);
    if (attendees.length) lines.push(`참석자: ${attendees.join(", ")}`);
    lines.push("");

    if (content) lines.push("[원본 노트]", content, "");

    if (aiReport) {
      lines.push("[AI 분석]");
      if (aiReport.meetingType) lines.push(`유형: ${aiReport.meetingType}`);
      for (const s of SECTIONS) {
        const v = aiReport[s.key]?.trim();
        if (v) lines.push("", `■ ${s.label}`, v);
      }
      lines.push("");
    } else if (aiSummary) {
      lines.push("[AI 분석]", "", "■ 요약", aiSummary);
      if (aiActionItems?.length) {
        lines.push("", "■ 액션 아이템");
        for (const it of aiActionItems) {
          const meta = [it.assignee ? `담당: ${it.assignee}` : "", it.due ? `기한: ${it.due}` : ""]
            .filter(Boolean)
            .join(", ");
          lines.push(`- ${it.action}${meta ? ` (${meta})` : ""}`);
        }
      }
      lines.push("");
    }

    if (transcription) lines.push("[전사]", transcription);

    return lines.join("\n");
  };

  const onDownload = () => {
    const blob = new Blob([build()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title || "회의록").replace(/[\\/:*?"<>|]/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Button variant="outline" onClick={onDownload}>
      <Download className="size-4" />
      TXT
    </Button>
  );
}
