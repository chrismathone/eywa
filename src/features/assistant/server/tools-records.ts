import "server-only";
// AI 비서 기록 툴 4종(등록상담·퇴원·회의록) — 기존 features/enrollment·withdrawals·meetings 조회
// 함수의 **read-only 래핑**(새 쿼리 없음). 쿠키 세션 createClient 경유 → RLS 자동 상속.
// PII 방침: 학부모 전화번호는 툴 표면에 싣지 않는다(students 툴과 동일 허용선). 전사(transcription)
// 원문은 컨텍스트 폭주라 제외 — AI 요약·8섹션 보고서만.

import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { getEnrollmentConsultations } from "@/features/enrollment/server/queries";
import { OUTCOME_PILL } from "@/features/enrollment/outcome-meta";
import { getWithdrawnStudents, enrollmentDuration, reasonDisplay } from "@/features/withdrawals/server/queries";
import { getMeetings, getMeetingById } from "@/features/meetings/server/queries";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { kstMonth, kstToday } from "@/lib/date-kst";
import { subjectLabeler } from "./labels";

/** timestamptz(UTC ISO) → KST 날짜(YYYY-MM-DD). UTC slice(0,10)는 KST 오전 건을 전날로 민다. */
function kstDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : kstToday(d);
}

/** timestamptz(UTC ISO)가 주어진 KST 월(YYYY-MM)에 속하는가. UTC startsWith는 경계 건을 오분류. */
function inKstMonth(iso: string | null | undefined, month: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && kstMonth(d) === month;
}

const MEETING_STATUS_LABEL: Record<string, string> = {
  idle: "노트만 작성",
  uploaded: "녹음 업로드됨",
  transcribing: "전사 중",
  analyzing: "분석 중",
  completed: "분석 완료",
  failed: "분석 실패",
};

function clip(text: string | null | undefined, max = 200): string | null {
  if (!text) return null;
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export const enrollmentConsultationsTool = betaZodTool({
  name: "search_enrollment_consultations",
  description:
    "신규생 등록상담을 검색한다(이름·학교 검색어, 월, 진행 상태 필터). 결과: 이름·학교/학년·과목·진행 상태·상담일·상담자·학부모 요청 요약·반 배정 여부. '이번 달 등록상담 몇 건?', '○○ 상담 어떻게 됐어?' 류 질문에 사용.",
  inputSchema: z.object({
    query: z.string().optional().describe("이름·학교 검색어(부분 일치)"),
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .describe("YYYY-MM. 사용자가 기간을 명시했을 때만"),
    outcome: z
      .enum(["pending", "scheduled", "consulted", "ai_done", "enrolled", "declined", "no_show"])
      .optional()
      .describe("진행 상태 필터(대기/예약/상담완료/AI완료/등록/거절/노쇼)"),
  }),
  run: async ({ query, month, outcome }) => {
    const rows = await getEnrollmentConsultations({ q: query, month, outcome });
    return JSON.stringify({
      total: rows.length,
      shown: Math.min(rows.length, 15),
      consultations: rows.slice(0, 15).map((r) => ({
        name: r.prospectName,
        meta: schoolGradeLabel(r.prospectSchool, r.prospectGrade) || null,
        outcome: OUTCOME_PILL[r.outcome]?.label ?? r.outcome,
        // consultedAt은 timestamptz(UTC ISO) — slice(0,10) UTC는 KST 오전 접수를 전날로 민다(화면과 불일치).
        consultedAt: kstDate(r.consultedAt),
        consultant: r.consultantName,
        parentRequest: clip(r.parentRequest),
        assigned: r.assignedClassCount > 0 ? "반 배정 완료" : "미배정",
        repeatCount: r.personConsultCount,
      })),
    });
  },
});

export const recentWithdrawalsTool = betaZodTool({
  name: "recent_withdrawals",
  description:
    "퇴원 학생 목록(최근순)을 돌려준다: 이름·학교/학년·퇴원일·재원 기간·마지막 반/과목·퇴원 사유·상담 메모. '최근 누가 그만뒀어?', '○월 퇴원 몇 명?' 류 질문에 사용.",
  inputSchema: z.object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .describe("YYYY-MM(퇴원월 필터). 사용자가 기간을 명시했을 때만"),
    limit: z.number().int().min(1).max(30).optional().describe("최대 건수(기본 15)"),
  }),
  run: async ({ month, limit }) => {
    const label = await subjectLabeler();
    const all = await getWithdrawnStudents();
    const filtered = month ? all.filter((w) => w.withdrawnAt?.startsWith(month)) : all;
    return JSON.stringify({
      total: filtered.length,
      shown: Math.min(filtered.length, limit ?? 15),
      withdrawals: filtered.slice(0, limit ?? 15).map((w) => ({
        name: w.name,
        meta: schoolGradeLabel(w.school, w.grade) || null,
        withdrawnAt: w.withdrawnAt,
        duration: enrollmentDuration(w.enrolledAt, w.withdrawnAt),
        lastClass: w.lastClassName,
        lastSubject: w.lastClassSubject ? (label(w.lastClassSubject) ?? w.lastClassSubject) : null,
        // withdrawalReason은 metadata 없는 행에서 raw 영문 enum(schedule/other…)으로 폴백 — 한글 라벨링
        // (reasonDisplay: 표준 키만 한글화, "반 이동" 같은 자유텍스트·기존 한글 라벨은 보존, 멱등).
        reason: reasonDisplay(w.withdrawalReason),
        memo: clip(w.metadata?.memo),
      })),
    });
  },
});

export const searchMeetingsTool = betaZodTool({
  name: "search_meetings",
  description:
    "회의록을 검색한다(제목·요약 검색어, 월 필터, 최근순). 결과: meetingId·제목·일시·작성자·참석자·요약. 상세 내용이 필요하면 get_meeting_summary에 meetingId를 넘긴다.",
  inputSchema: z.object({
    query: z.string().optional().describe("제목·요약 검색어(부분 일치). 생략 시 최근 회의"),
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .describe("YYYY-MM(회의월 필터). 사용자가 기간을 명시했을 때만"),
  }),
  run: async ({ query, month }) => {
    const all = await getMeetings();
    const term = query?.trim() ?? "";
    const rows = all
      // heldAt은 timestamptz(UTC ISO) — startsWith(월) UTC 비교는 경계 회의를 오분류(화면은 KST 월).
      .filter((m) => (month ? inKstMonth(m.heldAt, month) : true))
      // 요약은 140자 excerpt로 잘려 검색이 새므로 전문(summaryFull, >140자일 때만)까지 함께 매칭.
      .filter((m) =>
        term ? [m.title, m.summaryFull, m.excerpt].some((s) => s?.includes(term)) : true,
      )
      .slice(0, 10);
    return JSON.stringify({
      shown: rows.length,
      meetings: rows.map((m) => ({
        meetingId: m.id,
        title: m.title,
        heldAt: kstDate(m.heldAt),
        author: m.authorName,
        attendees: m.attendees,
        summary: m.summaryFull ?? m.excerpt,
        status: MEETING_STATUS_LABEL[m.processingStatus] ?? "처리 중",
      })),
    });
  },
});

export const meetingSummaryTool = betaZodTool({
  name: "get_meeting_summary",
  description:
    "회의 1건의 AI 분석 보고서(요약·안건 논의·결정 사항·액션 아이템·발언 요약·우려 사항·다음 단계)를 돌려준다. '지난 회의에서 뭐 결정했어?' 류 질문에 사용. 전사 원문은 제공하지 않는다.",
  inputSchema: z.object({ meetingId: z.string().uuid().describe("search_meetings가 준 meetingId") }),
  run: async ({ meetingId }) => {
    const m = await getMeetingById(meetingId);
    if (!m) return JSON.stringify({ error: "해당 회의를 찾을 수 없습니다." });
    return JSON.stringify({
      title: m.title,
      heldAt: kstDate(m.heldAt),
      attendees: m.attendees,
      status: MEETING_STATUS_LABEL[m.processingStatus] ?? "처리 중",
      summary: m.aiSummary ?? clip(m.content, 600),
      report: m.aiReport
        ? {
            meetingType: m.aiReport.meetingType,
            agendaDiscussion: m.aiReport.agendaDiscussion,
            decisions: m.aiReport.decisions,
            actionItems: m.aiReport.actionItems,
            speakerSummary: m.aiReport.speakerSummary,
            concerns: m.aiReport.concerns,
            nextSteps: m.aiReport.nextSteps,
          }
        : null,
      actionItems: m.aiActionItems,
    });
  },
});
