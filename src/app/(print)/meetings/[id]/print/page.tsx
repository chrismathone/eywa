import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { requireAccess } from "@/lib/auth/require-access";
import { getMeetingById, type MeetingReportSection } from "@/features/meetings/server/queries";
import { RichText } from "@/components/rich-text";
import { MeetingPrintActions } from "./meeting-print-actions";

export const metadata = { title: "회의록 인쇄 — eywa" };

// list=나열형(불릿). 화면 분석탭(ai-report.tsx)과 동일 — Solar가 줄바꿈 안 줘도 RichText가 불릿화.
const REPORT_SECTIONS: { key: keyof MeetingReportSection; label: string; list?: boolean }[] = [
  { key: "summary", label: "회의 요약" },
  { key: "agendaDiscussion", label: "안건별 논의", list: true },
  { key: "decisions", label: "결정 사항", list: true },
  { key: "actionItems", label: "액션 아이템", list: true },
  { key: "speakerSummary", label: "발언자별 요약", list: true },
  { key: "concerns", label: "우려사항", list: true },
  { key: "nextSteps", label: "다음 단계", list: true },
];

export default async function MeetingPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("meetings");
  const { id } = await params;
  const embedded = (await headers()).get("x-embed") === "1";
  const meeting = await getMeetingById(id);
  if (!meeting) notFound();

  return (
    <main className="meeting-doc print-portrait mx-auto max-w-[800px] px-12 py-10 print:px-0 print:py-0">
      <MeetingPrintActions embedded={embedded} hasTranscript={!!meeting.transcription} />

      <header className="border-b border-gray-300 pb-4">
        <p className="text-xs uppercase tracking-wider text-gray-500">회의록</p>
        <h1 className="mt-1 text-2xl font-bold">{meeting.title}</h1>
        <p className="mt-1 text-xs text-gray-600">
          {new Date(meeting.heldAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
          {meeting.authorName ? ` · 작성: ${meeting.authorName}` : ""}
          {meeting.attendees.length > 0 ? ` · 참석: ${meeting.attendees.join(", ")}` : ""}
        </p>
      </header>

      {meeting.aiReport ? (
        <section className="mt-6 space-y-5">
          <p className="text-xs uppercase tracking-wider text-gray-500">AI 분석 (8 섹션)</p>
          {REPORT_SECTIONS.map(({ key, label, list }) => {
            const body = meeting.aiReport?.[key];
            if (typeof body !== "string" || !body.trim()) return null;
            return (
              <div key={key} className="space-y-1">
                <h2 className="text-sm font-semibold text-gray-700">{label}</h2>
                <RichText text={body} bulletize={list} className="space-y-1 text-sm leading-relaxed" />
              </div>
            );
          })}
        </section>
      ) : null}

      {meeting.aiActionItems && meeting.aiActionItems.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-gray-700">액션 아이템</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {meeting.aiActionItems.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <span>•</span>
                <span className="flex-1">
                  {a.action}
                  {a.assignee ? ` — ${a.assignee}` : ""}
                  {a.due ? ` (${a.due})` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!meeting.aiReport && meeting.content ? (
        <section className="mt-6 space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">회의 내용</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{meeting.content}</p>
        </section>
      ) : null}

      {meeting.transcription ? (
        <section id="meeting-transcript" className="mt-6 space-y-2 border-t border-gray-300 pt-5">
          <h2 className="text-sm font-semibold text-gray-700">전사 내용</h2>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
            {meeting.transcription}
          </p>
        </section>
      ) : null}

      <footer className="mt-10 border-t border-gray-300 pt-3 text-center text-[10px] text-gray-500">
        eywa · 인쇄 일시 {new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
      </footer>
    </main>
  );
}
