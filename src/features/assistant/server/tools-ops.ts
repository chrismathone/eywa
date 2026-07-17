import "server-only";
// AI 비서 운영 툴 5종(출결·수납·상담·이탈 위험) — 기존 조회 함수 read-only 래핑(새 쿼리 없음).
// 전부 쿠키 세션 경유(RLS 자동). retention은 세션+5분 unstable_cache인 getRetentionRoster만 사용
// (raw computeRetentionRoster는 앱 최중량 읽기라 대화 턴마다 돌리지 않는다 — B7).

import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { getDailyProcessingStatus, getAttendanceForDate } from "@/features/attendance/server/queries";
import { getBillingSummary } from "@/features/billing/server/queries";
import { getTopOutstanding } from "@/features/dashboard/server/queries";
import { getStudentConsultationsPage } from "@/features/consultations/server/queries";
import { getRetentionRoster } from "@/features/retention/server/queries";
import { summarizeRoster } from "@/features/retention/roster";
import { kstToday } from "@/lib/date-kst";
import { CONSULTATION_CATEGORY_LABEL, INVOICE_STATUS_LABEL, RISK_LEVEL_LABEL, subjectLabeler } from "./labels";

const ATTENDANCE_STATUS_LABEL: Record<string, string> = {
  present: "출석",
  absent: "결석",
  late: "지각",
  early_leave: "조퇴",
  excused: "공결", // UI에서 폐지된 상태지만 과거 데이터에 잔존 가능
  makeup: "보강", // 누락 시 raw 영문 키가 모델 답변으로 유출(2026-07-17 적대 리뷰 확정)
};

export const attendanceDayTool = betaZodTool({
  name: "get_attendance_day",
  description:
    "특정 날짜(기본 오늘)의 출결 현황을 돌려준다: 상태별 집계(출석/결석/지각)와 반별 출석 처리 진행(예정 인원 대비 기록 인원, 미처리 수). '오늘 출석 어때?', '어느 반이 출석 처리 안 됐어?' 류 질문에 사용.",
  inputSchema: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("YYYY-MM-DD. 미지정 시 오늘(KST)"),
  }),
  run: async ({ date }) => {
    const target = date ?? kstToday();
    const label = await subjectLabeler();
    const [classes, records] = await Promise.all([
      getDailyProcessingStatus(target),
      getAttendanceForDate(target),
    ]);
    const byStatus: Record<string, number> = {};
    for (const r of records) {
      const key = ATTENDANCE_STATUS_LABEL[r.status] ?? r.status;
      byStatus[key] = (byStatus[key] ?? 0) + 1;
    }
    const absentees = records
      .filter((r) => r.status === "absent")
      .slice(0, 20)
      .map((r) => ({ name: r.studentName, grade: r.studentGrade, className: r.className }));
    return JSON.stringify({
      date: target,
      recorded: records.length,
      byStatus,
      absentees,
      classes: classes.map((c) => ({
        className: c.className,
        subject: label(c.subject) ?? c.subject,
        teacher: c.teacherName,
        expected: c.expected,
        recorded: c.recorded,
        unprocessed: c.unprocessed,
      })),
    });
  },
});

export const billingSummaryTool = betaZodTool({
  name: "get_billing_summary",
  description:
    "월별 수납 요약(청구 건수·완납/부분납/미납 건수·청구액·수납액·미수액·수납률%)을 돌려준다. '이번 달 수납률은?' 류 질문에 사용.",
  inputSchema: z.object({
    period: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .describe("YYYY-MM. 미지정 시 이번 달"),
  }),
  run: async ({ period }) => JSON.stringify(await getBillingSummary(period)),
});

export const topOutstandingTool = betaZodTool({
  name: "get_top_outstanding",
  description: "미수(미납) 잔액이 큰 학생 순위를 돌려준다. '누가 제일 많이 밀렸어?' 류 질문에 사용.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(20).optional().describe("최대 인원(기본 8)"),
  }),
  run: async ({ limit }) => {
    const items = await getTopOutstanding(limit ?? 8);
    return JSON.stringify({
      students: items.map((i) => ({
        name: i.studentName,
        outstanding: i.amount,
        status: INVOICE_STATUS_LABEL[i.status] ?? i.status,
      })),
    });
  },
});

export const searchConsultationsTool = betaZodTool({
  name: "search_consultations",
  description:
    "재원생 상담 기록을 검색한다(학생 이름·내용 검색, 기간 필터). 상담 이력·후속조치 질문에 사용. 특정 학생의 전체 이력은 get_student_timeline이 더 적합.",
  inputSchema: z.object({
    query: z.string().optional().describe("학생 이름 또는 상담 내용 검색어"),
    range: z.enum(["7d", "30d", "all"]).optional().describe("기간(기본 30d)"),
  }),
  run: async ({ query, range }) => {
    const label = await subjectLabeler();
    const { rows, total } = await getStudentConsultationsPage(
      { q: query, range: range ?? "30d" },
      1,
      10,
    );
    return JSON.stringify({
      total,
      shown: rows.length,
      consultations: rows.map((r) => ({
        studentName: r.studentName,
        grade: r.studentGrade,
        counselor: r.counselorName,
        consultedAt: r.consultedAt,
        category: r.category ? (CONSULTATION_CATEGORY_LABEL[r.category] ?? r.category) : null,
        subject: label(r.subject),
        summary: r.summary.length > 200 ? `${r.summary.slice(0, 200)}…` : r.summary,
        followUpAction: r.followUpAction,
        followUpDate: r.followUpDate,
        followUpDone: r.followUpDone,
      })),
    });
  },
});

export const retentionRisksTool = betaZodTool({
  name: "get_retention_risks",
  description:
    "이탈(퇴원) 위험 학생 목록과 전체 통계를 돌려준다(위험 점수·사유·권장 조치 포함, 위험도 내림차순). '그만둘 것 같은 학생', '관리가 필요한 학생' 류 질문에 사용. 결과는 5분 캐시라 실시간이 아닐 수 있다.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(20).optional().describe("최대 인원(기본 10)"),
  }),
  run: async ({ limit }) => {
    const roster = await getRetentionRoster();
    const stats = summarizeRoster(roster);
    return JSON.stringify({
      stats: { 재원생: stats.total, 위험: stats.risk, 주의: stats.warn },
      students: roster
        .filter((s) => s.risk.level !== "ok")
        .slice(0, limit ?? 10)
        .map((s) => ({
          name: s.name,
          grade: s.grade,
          school: s.school,
          teacher: s.teacherName,
          level: RISK_LEVEL_LABEL[s.risk.level] ?? s.risk.level,
          score: s.risk.score,
          reasons: s.risk.reasons,
          recommendedAction: s.primaryAction || null,
          nextContactDate: s.nextContactDate,
        })),
    });
  },
});
