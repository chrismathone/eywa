import "server-only";
// AI 비서 학생 툴 4종 — 기존 features/students 조회 함수의 **read-only 래핑**(새 쿼리 없음).
// 전부 쿠키 세션 createClient 경유 → RLS·teacher scope 자동 상속. PII 방침: 주소·전화·이메일·생일이
// 있는 StudentDetail은 노출하지 않고, PII-free 합성인 getStudentSummary만 쓴다(학생 이름·학교·상담
// 내용 수준은 기존 AI 전송 허용선).

import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  getStudentsPage,
  getStudentSummary,
  getStudentTimeline,
  getStudentLessonReports,
} from "@/features/students/server/queries";
import { studentStatusLabel } from "@/features/students/status-labels";
import { INVOICE_STATUS_LABEL, subjectLabeler } from "./labels";
import { requireMenu } from "./tool-gate";

/** 이 파일의 툴이 여는 화면 = 학생목록 — 그 메뉴를 못 보는 사람은 비서로도 못 본다(#77). */
const GATE = () => requireMenu("students", "학생 정보");

const TIMELINE_KIND_LABEL: Record<string, string> = {
  enrollment_start: "수강 시작",
  enrollment_end: "수강 종료",
  consultation: "상담",
  memo: "메모",
  status_change: "상태 변경",
  grade: "성적",
  textbook: "교재",
  enrollment_consultation: "입학 상담",
};

export const searchStudentsTool = betaZodTool({
  name: "search_students",
  description:
    "학생을 이름(부분 일치)으로 검색해 기본 정보와 studentId를 돌려준다. 특정 학생에 대한 질문은 항상 이 툴로 학생을 먼저 찾은 뒤 다른 학생 툴에 studentId를 넘긴다. 동명이인이 여러 명이면 전부 반환되므로 학교·학년으로 구분해 사용자에게 되물어라.",
  inputSchema: z.object({
    query: z.string().min(1).describe("학생 이름 또는 학교명(부분 일치)"),
    status: z
      .enum(["all", "enrolled", "consulted", "on_hold", "withdrawn"])
      .optional()
      .describe("상태 필터. 기본 all(전체). enrolled=재원"),
  }),
  run: async ({ query, status }) => {
    const denied = await GATE();
    if (denied) return denied;
    const label = await subjectLabeler();
    const { rows, total } = await getStudentsPage({ q: query, status: status ?? "all" }, 1, 10);
    return JSON.stringify({
      total,
      shown: rows.length,
      students: rows.map((r) => ({
        studentId: r.id,
        name: r.name,
        school: r.school,
        grade: r.grade,
        status: studentStatusLabel(r.status),
        subjects: r.subjects.map((s) => label(s) ?? s),
        teachers: r.teacherNames,
      })),
    });
  },
});

export const studentSummaryTool = betaZodTool({
  name: "get_student_summary",
  description:
    "학생 1명의 종합 현황(상태·담당 강사·수강 반·최근 30일 출결 통계·수납 상태)을 돌려준다. '○○ 요즘 어때?' 류 질문의 기본 툴.",
  inputSchema: z.object({ studentId: z.string().uuid().describe("search_students가 준 studentId") }),
  run: async ({ studentId }) => {
    const denied = await GATE();
    if (denied) return denied;
    const label = await subjectLabeler();
    const summary = await getStudentSummary(studentId);
    if (!summary) return JSON.stringify({ error: "해당 학생을 찾을 수 없습니다." });
    return JSON.stringify({
      ...summary,
      status: studentStatusLabel(summary.status),
      enrollments: summary.enrollments.map((e) => ({ ...e, subject: label(e.subject) ?? e.subject })),
      // latestStatus raw enum(unpaid/void…)이 모델 답변으로 유출되지 않게 한글 라벨링(상류 차단).
      billing: {
        ...summary.billing,
        latestStatus: summary.billing.latestStatus
          ? (INVOICE_STATUS_LABEL[summary.billing.latestStatus] ?? summary.billing.latestStatus)
          : null,
      },
    });
  },
});

export const studentTimelineTool = betaZodTool({
  name: "get_student_timeline",
  description:
    "학생 1명의 이력 타임라인(수강 시작/종료·상담·메모·상태 변경·성적)을 최신순으로 돌려준다. 최근에 무슨 일이 있었는지 물을 때 사용.",
  inputSchema: z.object({
    studentId: z.string().uuid(),
    limit: z.number().int().min(1).max(50).optional().describe("최대 이벤트 수(기본 20)"),
  }),
  run: async ({ studentId, limit }) => {
    const denied = await GATE();
    if (denied) return denied;
    const events = await getStudentTimeline(studentId);
    return JSON.stringify({
      totalEvents: events.length,
      events: events.slice(0, limit ?? 20).map((e) => ({
        date: e.date,
        kind: TIMELINE_KIND_LABEL[e.kind] ?? e.kind,
        title: e.title,
        description: e.description ?? null,
      })),
    });
  },
});

export const studentLessonReportsTool = betaZodTool({
  name: "get_student_lesson_reports",
  description: "학생 1명의 최근 수업보고서(진도·시험·숙제 점수·담당 강사)를 최신순으로 돌려준다.",
  inputSchema: z.object({
    studentId: z.string().uuid(),
    limit: z.number().int().min(1).max(20).optional().describe("최대 건수(기본 8)"),
  }),
  run: async ({ studentId, limit }) => {
    const denied = await GATE();
    if (denied) return denied;
    // 🔴 과목을 함께 넘긴다(2026-07-29 적대검증) — 없으면 모델이 **수학 진도를 그 학생의 전체 진도**로
    //    서술한다(현재 저장된 보고서는 사실상 전부 수학). 라벨은 학원설정 단일 소스 —
    //    raw 키("math")를 넘기면 모델이 그대로 사용자에게 흘릴 수 있다(UI raw 코드 노출 금지 규칙).
    const [rows, subjectLabel] = await Promise.all([
      getStudentLessonReports(studentId, limit ?? 8),
      subjectLabeler(), // assistant 공용 라벨러(labels.ts) — 이 파일에서 buildSubjectMaps를 다시 짜지 않는다.
    ]);
    return JSON.stringify({
      reports: rows.map((r) => ({
        date: r.reportDate,
        subject: subjectLabel(r.subject),
        teacher: r.teacherName,
        progress: r.progress,
        exam: r.examInfo,
        homeworkScore: r.homeworkScore,
      })),
    });
  },
});
