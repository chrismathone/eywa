import "server-only";
import { getWeeklyScheduleWithStudents, getTeacherColorMap } from "@/features/timetable/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import { kstToday } from "@/lib/date-kst";
import { thisMonday } from "@/features/timetable/lib/week";
import { appendTeacherGridSheet } from "./teacher-grid-sheet";
import { appendInjaewonIntegratedSheet } from "./injaewon-integrated-sheet";

/**
 * 영어 시간표 xlsx 버퍼 빌드 — **강사별영어시간표(마스터) + 통합영어시간표(파생)** 2탭.
 * 화면 강사뷰/통합뷰가 쓰는 순수 레이아웃 함수(buildTeacherGridModel·buildRichCardGroups)를 그대로
 * emit해 화면과 배치가 일치한다. **라우트(다운로드)와 구글시트 동기화가 공유하는 단일 빌더**.
 *
 * - `teacherId`: 강사 본인 뷰면 담당 반만(스코핑). 미지정=전체(master/관리자 뷰).
 * - 영어는 내보내기 전용 — 수강편집(라운드트립) 탭 미포함(가져오기는 math 전용).
 */
export async function buildEnglishTimetableBuffer(opts?: {
  teacherId?: string;
}): Promise<ArrayBuffer> {
  const [slots, teacherColors, settings] = await Promise.all([
    getWeeklyScheduleWithStudents({ subject: "english", teacherId: opts?.teacherId }),
    getTeacherColorMap(),
    getTenantSettings(),
  ]);
  // ⚠️ 반 정원(통합 탭 '정원' 행)은 현 DB `classes`에 capacity 컬럼이 없어 공백 처리(스키마 확장 시 채움).
  const capacityByClassId: Record<string, number | null> = {};

  const config = settingsToPeriodsConfig(settings.operations);
  const today = kstToday();
  const weekMonday = thisMonday(today);
  const month = Number(today.slice(5, 7));
  const academyLabel =
    [settings.profile?.name, settings.profile?.branchLabel].filter(Boolean).join(" ") || "인재원 본원";

  // 강사뷰 파라미터 = 과목 설정(operations.subjects[english]) — page.tsx 도출과 동일(resolve가 english 프리필).
  const subjectRow = settings.operations.subjects.find((s) => s.key === "english");
  const sectionLineMins = (subjectRow?.teacherViewLines ?? [])
    .map((t) => {
      const [h, m] = t.split(":").map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    })
    .filter((m) => Number.isFinite(m));
  const stepMin = subjectRow?.teacherViewStep ?? 10;
  const breakRanges = subjectRow?.teacherViewBreaks ?? [];
  const excludedTeachers = subjectRow?.teacherViewLineExcluded ?? [];

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "eywa";
  wb.created = new Date();

  // 탭 순서 = 원본 인재원 시트와 동일: 통합영어시간표(원장 손작업 형식 재현) → 강사별영어시간표(화면 강사뷰).
  appendInjaewonIntegratedSheet(wb, slots, {
    config,
    capacityByClassId,
    teacherColors,
    title: `${academyLabel} ${month}월 통합 영어시간표`,
  });
  appendTeacherGridSheet(wb, slots, {
    teacherColors,
    stepMin,
    breakRanges,
    excludedTeachers,
    sectionLineMins,
    weekMonday,
  });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
