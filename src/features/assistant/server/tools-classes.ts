import "server-only";
// AI 비서 반·수업 툴 2종 — 기존 features/classes 조회 함수의 **read-only 래핑**(새 쿼리 없음).
// 쿠키 세션 createClient 경유 → RLS·teacher scope 자동 상속. 수강생 명단은 이름·학교·학년 수준
// (students 툴과 동일 허용선 — 주소·전화 등 PII 없음).

import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { getClassesList, getClassDetail, getClassStudents } from "@/features/classes/server/queries";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { DAY_LABEL, subjectLabeler } from "./labels";

export const searchClassesTool = betaZodTool({
  name: "search_classes",
  description:
    "반(수업)을 반 이름으로 검색해 기본 정보와 classId를 돌려준다. 특정 반에 대한 질문은 이 툴로 반을 먼저 찾은 뒤 get_class_detail에 classId를 넘긴다. 검색어를 생략하면 진행 중인 반 전체(수강생 수·요일 포함).",
  inputSchema: z.object({
    query: z.string().optional().describe("반 이름(부분 일치). 생략 시 전체"),
    active: z
      .enum(["active", "closed", "all"])
      .optional()
      .describe("진행 상태 필터. 기본 active(진행 중)"),
  }),
  run: async ({ query, active }) => {
    // 라벨러·목록 조회는 독립 — 병렬(B4).
    const [label, rows] = await Promise.all([
      subjectLabeler(),
      getClassesList({ q: query, active: active ?? "active" }),
    ]);
    return JSON.stringify({
      total: rows.length,
      shown: Math.min(rows.length, 25),
      classes: rows.slice(0, 25).map((c) => ({
        classId: c.id,
        className: c.className,
        subject: label(c.subject) ?? c.subject,
        teacher: c.teacherName,
        classroom: c.classroomName,
        active: c.isActive ? "진행 중" : "종료",
        studentCount: c.studentCount,
        days: c.days.map((d) => `${DAY_LABEL[d.day] ?? d.day}${d.start ? ` ${d.start}` : ""}`),
      })),
    });
  },
});

export const classDetailTool = betaZodTool({
  name: "get_class_detail",
  description:
    "반 1개의 상세(담당 강사·강의실·시간표 슬롯·수강생 명단)를 돌려준다. '○○반에 누가 있어?', '○○반 언제 수업해?' 류 질문에 사용.",
  inputSchema: z.object({ classId: z.string().uuid().describe("search_classes가 준 classId") }),
  run: async ({ classId }) => {
    // 라벨러·상세·수강생은 독립 조회 — 전부 병렬(B4).
    const [label, detail, students] = await Promise.all([
      subjectLabeler(),
      getClassDetail(classId),
      getClassStudents(classId),
    ]);
    if (!detail) return JSON.stringify({ error: "해당 반을 찾을 수 없습니다." });
    return JSON.stringify({
      className: detail.className,
      subject: label(detail.subject) ?? detail.subject,
      teacher: detail.teacherName,
      classroom: detail.classroomName,
      active: detail.isActive ? "진행 중" : "종료",
      closedAt: detail.closedAt,
      schedule: detail.scheduleSlots.map(
        (s) => `${DAY_LABEL[s.dayOfWeek] ?? s.dayOfWeek} ${s.startTime}~${s.endTime}`,
      ),
      studentCount: detail.studentCount,
      students: students.map((s) => ({
        studentId: s.studentId,
        name: s.name,
        meta: schoolGradeLabel(s.school, s.grade) || null,
        enrolledAt: s.enrolledAt,
        onHold: s.onHold ? "휴원 중" : null,
      })),
    });
  },
});
