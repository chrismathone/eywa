import "server-only";
import { getWeeklyScheduleWithStudents, getTeacherColorMap } from "@/features/timetable/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import { buildSubjectMaps } from "@/features/owner/subjects";
import type { PillColor } from "@/components/atoms/pill";
import { kstToday } from "@/lib/date-kst";
import { thisMonday } from "@/features/timetable/lib/week";
import { appendTeacherGridSheet } from "./teacher-grid-sheet";
import { appendIntegratedSheet } from "./integrated-sheet";

// 과목 소프트색(PillColor) → 엑셀 셀 hex. 통합 탭 반 헤더 폴백(card.bgColor 없을 때).
const PILL_SOFT_HEX: Record<PillColor, string> = {
  primary: "FFDCEFE4",
  blue: "FFD7E7F5",
  rose: "FFF6DEE5",
  purple: "FFE7DEF3",
  amber: "FFF7E8CE",
  gold: "FFF3E8D0",
  danger: "FFF8DCDC",
  neutral: "FFEEEADD",
};

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

  const config = settingsToPeriodsConfig(settings.operations);
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const subjectSoftHex = PILL_SOFT_HEX[subjectMaps.colorOf("english") as PillColor];
  const weekMonday = thisMonday(kstToday());

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

  // 마스터 = 강사별(화면 강사뷰). 그 다음 파생 = 통합(반=열 + 학생명단).
  appendTeacherGridSheet(wb, slots, {
    teacherColors,
    stepMin,
    breakRanges,
    excludedTeachers,
    sectionLineMins,
    weekMonday,
  });
  appendIntegratedSheet(wb, slots, {
    config,
    teacherColors,
    subjectSoftHex,
  });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
