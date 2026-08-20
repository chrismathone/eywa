import "server-only";
// AI 비서 직원·강사 툴 3종 — 기존 features/staff·report-admin 조회 함수의 **read-only 래핑**(새 쿼리 없음).
// 전부 쿠키 세션 createClient 경유 → RLS 자동 상속(직원 데이터 접근 권한이 없는 역할은 조회가 빈다).
// ⚠️ PII 방침(툴 불변 조건 ②): 급여(hourlyRate·monthlyBase)·주민번호·계좌·이력서 form_data는 물론,
// 직원 email·phone·인사 memo도 툴 표면에 싣지 않는다 — 비서 답변은 DB(대화 저장)에 남기 때문.

import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { getStaffList, getStaffById, getStaffClasses, getStaffWorkSchedule } from "@/features/staff/server/queries";
import { getWeeklyWritingRates } from "@/features/report-admin/server/queries";
import { DAY_LABEL, STAFF_STATUS_LABEL, SYSTEM_ROLE_LABEL, subjectLabeler } from "./labels";
import { requireMenu } from "./tool-gate";

/**
 * 🔴 직원관리(/staff)는 **원장 + 개인 예외** 체제(2026-08-01)라 RLS가 아니라 **메뉴 권한**이 게이트다 —
 * 그 게이트가 비서에 없으면 admin·manager가 "직원 목록 알려줘"로 화면을 우회한다(#77, 2026-08-20 배선).
 * 보고서 작성 현황은 강사 업무 현황이라 수업보고서(lesson_reports) 메뉴 축이다.
 */
const STAFF_GATE = () => requireMenu("staff", "직원 정보");
const REPORT_GATE = () => requireMenu("lesson_reports", "수업보고서 현황");

export const searchStaffTool = betaZodTool({
  name: "search_staff",
  description:
    "직원(강사·관리자·상담사 등)을 이름으로 검색해 기본 정보와 staffId를 돌려준다. 특정 선생님·직원에 대한 질문은 항상 이 툴로 먼저 찾은 뒤 staff_summary에 staffId를 넘긴다. 검색어를 생략하면 전체 직원 목록.",
  inputSchema: z.object({
    query: z.string().optional().describe("직원 이름(부분 일치). 생략 시 전체"),
  }),
  run: async ({ query }) => {
    const denied = await STAFF_GATE();
    if (denied) return denied;
    const all = await getStaffList();
    const term = query?.trim() ?? "";
    // ⚠️ total은 slice 이전 매칭 전체 수 — slice 이후 length를 total로 쓰면 15명 초과 시 "총 15명" 오답.
    const matched = all
      // 학생 계정은 직원 검색에서 제외(학생은 search_students 담당).
      .filter((s) => s.systemRole !== "student")
      .filter((s) => (term ? s.displayName.includes(term) : true));
    const rows = matched.slice(0, 15);
    return JSON.stringify({
      total: matched.length,
      shown: rows.length,
      staff: rows.map((s) => ({
        staffId: s.id,
        name: s.displayName,
        role: SYSTEM_ROLE_LABEL[s.systemRole] ?? s.systemRole,
        status: STAFF_STATUS_LABEL[s.status] ?? s.status,
        classesCount: s.classesCount,
        studentsCount: s.primaryStudentsCount,
      })),
    });
  },
});

export const staffSummaryTool = betaZodTool({
  name: "get_staff_summary",
  description:
    "직원 1명의 종합 현황(역할·직급·담당 과목·재직 상태·입사일·근무 일정·담당 반 목록과 각 반 수강생 수/시간표)을 돌려준다. '○○ 선생님 현황은?', '○○쌤 무슨 반 맡고 있어?' 류 질문의 기본 툴. 급여·연락처·개인정보는 제공하지 않는다.",
  inputSchema: z.object({ staffId: z.string().uuid().describe("search_staff가 준 staffId") }),
  run: async ({ staffId }) => {
    const denied = await STAFF_GATE();
    if (denied) return denied;
    // 라벨러·상세·담당 반·근무 일정은 상호 독립 조회 — 전부 병렬(B4, labeler도 Promise.all 안으로).
    const [label, detail, classes, workSchedule] = await Promise.all([
      subjectLabeler(),
      getStaffById(staffId),
      getStaffClasses(staffId),
      getStaffWorkSchedule(staffId),
    ]);
    if (!detail) return JSON.stringify({ error: "해당 직원을 찾을 수 없습니다." });
    const days = (sch: { day: string; startTime: string; endTime: string }[]) =>
      sch.map((s) => `${DAY_LABEL[s.day] ?? s.day} ${s.startTime}~${s.endTime}`);
    return JSON.stringify({
      // ⚠️ detail 스프레드 금지 — hourlyRate·monthlyBase(급여)·memo·email·phone이 섞인다. 필드 명시 선택만.
      name: detail.displayName,
      role: SYSTEM_ROLE_LABEL[detail.systemRole] ?? detail.systemRole,
      jobTitle: detail.jobTitle,
      subjects: detail.subjects.map((s) => label(s) ?? s),
      status: STAFF_STATUS_LABEL[detail.status] ?? detail.status,
      hireDate: detail.hireDate,
      defaultClassroom: detail.defaultClassroom,
      workSchedule: Object.fromEntries(
        Object.entries(workSchedule).map(([day, ranges]) => [DAY_LABEL[day] ?? day, ranges]),
      ),
      classes: classes.map((c) => ({
        classId: c.id,
        className: c.className,
        subject: label(c.subject) ?? c.subject,
        active: c.isActive ? "진행 중" : "종료",
        studentCount: c.studentCount,
        schedule: days(c.schedules),
      })),
    });
  },
});

export const writingStatusTool = betaZodTool({
  name: "get_report_writing_status",
  description:
    "강사별 수업보고서 작성 현황(오늘 대상/작성/미작성 학생 명단, 이번 주 작성률)을 돌려준다. '보고서 누가 안 썼어?', '○○ 선생님 보고서 잘 쓰고 있어?' 류 질문에 사용. teacherName을 주면 그 강사만.",
  inputSchema: z.object({
    teacherName: z.string().optional().describe("강사 이름(정확 일치 우선, 부분 일치 허용). 생략 시 전체"),
  }),
  run: async ({ teacherName }) => {
    const denied = await REPORT_GATE();
    if (denied) return denied;
    const [view, label] = await Promise.all([getWeeklyWritingRates(), subjectLabeler()]);
    if (!view) return JSON.stringify({ error: "작성 현황을 조회할 수 없습니다." });
    const term = teacherName?.trim() ?? "";
    const rates = view.rates
      .filter((r) => (term ? r.teacher === term || r.teacher.includes(term) : true))
      .slice(0, 20);
    return JSON.stringify({
      weekDates: `${view.dates[0]} ~ ${view.dates[view.dates.length - 1]}`,
      teachers: rates.map((r) => ({
        teacher: r.teacher,
        // subjects는 raw 과목 키(class.subject) — 라벨링 없이 내보내면 영문 키가 답변으로 유출된다.
        subjects: r.subjects.map((s) => label(s) ?? s),
        todayTarget: r.todayTarget,
        todayWritten: r.todayWritten,
        todayMissingStudents: r.todayMissing,
        weekWritten: r.weekWritten,
        weekTarget: r.weekTarget,
        weekRatePercent: r.weekRate,
      })),
    });
  },
});
