import "server-only";
// AI 비서 반·수업 툴 2종 — 기존 features/classes 조회 함수의 **read-only 래핑**(새 쿼리 없음).
// 쿠키 세션 createClient 경유 → RLS·teacher scope 자동 상속. 수강생 명단은 이름·학교·학년 수준
// (students 툴과 동일 허용선 — 주소·전화 등 PII 없음).

import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { getClassesList, getClassDetail, getClassStudents } from "@/features/classes/server/queries";
import { formatRow, summarizeSchedule } from "@/features/classes/schedule-summary";
import { kstToday } from "@/lib/date-kst";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { balancedTake } from "@/lib/collections/balanced-take";
import { DAY_LABEL, subjectLabeler, subjectResolver, subjectLabelList } from "./labels";

/** 한 번에 모델에게 넘길 반 개수 상한(툴 결과 토큰 방어). */
const CLASS_CAP = 25;

export const searchClassesTool = betaZodTool({
  name: "search_classes",
  description:
    "반(수업)을 이름·과목으로 검색해 기본 정보와 classId를 돌려준다. 특정 반에 대한 질문은 이 툴로 반을 먼저 찾은 뒤 get_class_detail에 classId를 넘긴다. 검색어를 생략하면 진행 중인 반 전체(수강생 수·요일 포함). 결과가 잘리면 응답의 note를 읽고 subject로 좁혀 다시 부를 것.",
  inputSchema: z.object({
    query: z.string().optional().describe("반 이름(부분 일치). 생략 시 전체"),
    subject: z
      .string()
      .optional()
      .describe(
        "과목으로 좁힌다. 한글 과목명(예: 수학, 영어) 또는 내부 키. ⚠️ 반 이름에 과목명이 안 들어가는 경우가 많아(예: 수학반 이름이 '고등M 고1 BS4A') 과목별 조회는 query가 아니라 이 인자로 해야 한다.",
      ),
    active: z
      .enum(["active", "closed", "all"])
      .optional()
      .describe("진행 상태 필터. 기본 active(진행 중)"),
  }),
  run: async ({ query, subject, active }) => {
    // 라벨러·과목 해석기·라벨 목록은 같은 설정 캐시를 쓰고 목록 조회와 독립 — 병렬(B4).
    const [label, resolve, subjectLabels] = await Promise.all([
      subjectLabeler(),
      subjectResolver(),
      subjectLabelList(),
    ]);
    const subjectKey = resolve(subject);
    const rows = await getClassesList({
      q: query,
      subject: subjectKey ?? undefined,
      active: active ?? "active",
    });

    // ⚠️ `rows.slice(0, N)` 금지(gotcha #84). 반 목록은 이름 오름차순인데 영어반은 로마자 코드
    // (DP5·JP1), 수학반은 한글(고등M·개별)이라 앞부분이 통째로 영어반이다 — 실측 상위 25개가
    // 영어 22 : 수학 3이었고, 모델은 "진행 중인 반"을 물으면 영어반만 나열하면서 total은 108로
    // 정확히 보고해 **전부 본 것처럼** 답했다. 과목별 라운드로빈으로 표본이 한쪽에 쏠리지 않게 한다.
    const shown = balancedTake(rows, (c) => c.subject ?? "", CLASS_CAP);
    const truncated = rows.length > shown.length;

    return JSON.stringify({
      total: rows.length,
      shown: shown.length,
      // 잘렸다는 사실과 **좁히는 방법**을 함께 준다. 이게 없으면 모델이 표본을 전체로 착각한다.
      note: truncated
        ? `${rows.length}개 중 과목별로 고르게 ${shown.length}개만 표시했습니다. 전체가 필요하면 subject(${subjectLabels.join("·")}) 또는 query로 좁혀 다시 호출하세요. 이 목록만 보고 "전부"라고 답하지 마세요.`
        : undefined,
      // 모델이 잘못된 과목명을 넣었을 때 조용히 무시하지 않고 알린다(안 그러면 필터가 안 걸린 결과를
      // 필터된 결과로 착각한다).
      subjectFilter: subject ? (subjectKey ? label(subjectKey) : `'${subject}'는 등록된 과목이 아니라 무시했습니다(등록 과목: ${subjectLabels.join("·")})`) : undefined,
      classes: shown.map((c) => ({
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
      // ⚠️ 전 슬롯을 그대로 넘기면 안 된다 — `class_schedules`는 운영 이력을 함께 담아
      // 이미 끝난 배치(실측 480/1068행)까지 섞인다. 그걸 넘기면 비서가 "DP5는 17:40까지"처럼
      // **사실이 아닌 시간표**를 답한다(사실 원칙 위반). 화면(반 상세)과 같은 요약을 쓴다.
      schedule: summarizeSchedule(detail.scheduleSlots, kstToday()).current.map(formatRow),
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
