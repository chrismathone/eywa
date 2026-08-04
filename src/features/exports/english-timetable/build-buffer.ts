import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getWeeklyScheduleWithStudents, getTeacherColorMap } from "@/features/timetable/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import type { TenantSettings } from "@/features/owner/settings-types";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import { resolveIntegrationGroups } from "@/features/timetable/lib/integration-groups";
import { kstToday } from "@/lib/date-kst";
import { thisMonday } from "@/features/timetable/lib/week";
import { buildTeacherGridModel } from "@/features/timetable/lib/teacher-grid-model";
import { appendEnrollmentEditSheet } from "@/features/exports/enrollment-edit-sheet";
import { appendTeacherGridSheet, computeTeacherGeometry, TEACHER_SHEET_NAME } from "./teacher-grid-sheet";
import { appendInjaewonIntegratedSheet, type FormulaCell } from "./injaewon-integrated-sheet";

/** 통합 탭 시트명(수식 주입 대상). */
export const INTEGRATED_SHEET_NAME = "통합영어시간표";

/**
 * 영어 시간표 xlsx 버퍼 빌드 — **강사별영어시간표(마스터) + 통합영어시간표(파생)** 2탭.
 * 화면 강사뷰/통합뷰가 쓰는 순수 레이아웃 함수(buildTeacherGridModel·buildRichCardGroups)를 그대로
 * emit해 화면과 배치가 일치한다. **라우트(다운로드)와 구글시트 동기화가 공유하는 단일 빌더**.
 *
 * - `teacherId`: 강사 본인 뷰면 담당 반만(스코핑). 미지정=전체(master/관리자 뷰).
 * - 3탭: 통합영어시간표(파생) → 강사별영어시간표(마스터·구조 편집) → **수강편집(학생 반이동 편집)**.
 *   강사별=구조(반/방/강사) 가져오기, 수강편집=학생 반이동 가져오기(수학과 동일 enrollment 라운드트립·영어 학생만).
 */
export async function buildEnglishTimetableBuffer(opts?: {
  teacherId?: string;
  /** true=수식 셀 목록도 수집(구글시트 API 후주입용) / false·미지정=엑셀용(정적만). xlsx 자체는 항상 정적. */
  withFormulas?: boolean;
  /** '1시간 단위' 압축 섹션(sectionKey) — 화면 통합뷰 토글과 동일. */
  compactSections?: Set<number>;
  /**
   * 라운드트립 '수강편집' 탭 포함 여부(기본 true — cron 시트 push는 이 탭이 있어야 가져오기가 닫힌다).
   * ⚠️ 그리드는 teacherId로 스코프돼도 이 탭은 **영어 전체 수강 명단**이라 스코프가 안 걸린다 →
   * 담당(scoped) 사용자에겐 false(2026-07-17 적대 감사).
   */
  includeEditSheet?: boolean;
  /** 세션 없는 호출(cron 자동 시트 반영)용 주입 — admin 클라이언트 + tenant 명시 + 설정(쿠키 경로 회피). */
  db?: { supabase: Awaited<ReturnType<typeof createClient>>; tenantId: string; settings: TenantSettings };
}): Promise<{ buffer: ArrayBuffer; formulaCells: FormulaCell[] }> {
  const timetableDb = opts?.db ? { supabase: opts.db.supabase, tenantId: opts.db.tenantId } : undefined;
  const [slots, teacherColors, settings, supabase] = await Promise.all([
    getWeeklyScheduleWithStudents({ subject: "english", teacherId: opts?.teacherId, db: timetableDb }),
    getTeacherColorMap(timetableDb),
    opts?.db ? Promise.resolve(opts.db.settings) : getTenantSettings(),
    opts?.db ? Promise.resolve(opts.db.supabase) : createClient(),
  ]);
  // ⚠️ 반 정원(통합 탭 '정원' 행)은 현 DB `classes`에 capacity 컬럼이 없어 공백 처리(스키마 확장 시 채움).
  const capacityByClassId: Record<string, number | null> = {};

  const config = settingsToPeriodsConfig(settings.operations);
  const today = kstToday();
  // 제목에 붙일 반영 시각 — "이 시트가 언제 동기화된 건지"(원장 요청 2026-08-04, 수학 합계행 '기준일' 대응).
  // ⚠️ 서버는 UTC라 `new Date().getHours()`를 쓰면 9시간 어긋난다 → 항상 Asia/Seoul로 포맷(전역 KST 규칙).
  // 구글시트 push는 이 버퍼를 만든 직후 올리므로 생성 시각 = 반영 시각. 다운로드 xlsx에도 같은 의미다.
  const syncedAt = `${today} ${new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date())}`;
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
  // 통합 탭 섹션 = 화면 통합뷰와 **같은 해석기**. "시트가 화면 그대로"가 이 빌더의 계약이라, 커스텀
  // 그룹을 화면에서만 적용하면 계약이 깨진다(원장이 배치를 바꿔도 시트는 옛 섹션으로 나감).
  const customGroups = resolveIntegrationGroups(subjectRow);

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "eywa";
  wb.created = new Date();

  // 강사뷰 모델 = 강사별 탭 + 통합 미니그리드 조회수식이 공유(같은 열/행 배치를 가리켜야 정합).
  const teacherModel = buildTeacherGridModel(slots, { stepMin, breakRanges, excludedTeachers, teacherColors });
  const teacherGeometry = computeTeacherGeometry(teacherModel, TEACHER_SHEET_NAME);

  // 탭 순서 = 원본 인재원 시트와 동일: 통합영어시간표(원장 손작업 형식 재현) → 강사별영어시간표(화면 강사뷰).
  const formulaCells: FormulaCell[] = [];
  appendInjaewonIntegratedSheet(wb, slots, {
    config,
    capacityByClassId,
    teacherColors,
    referenceDate: weekMonday,
    compactSections: opts?.compactSections,
    customGroups,
    formulaSink: opts?.withFormulas ? formulaCells : undefined,
    // 스마트 동기화: 미니그리드를 강사별 역조회 수식으로(구글시트만 — withFormulas일 때 sink와 함께).
    teacherGeometry: opts?.withFormulas ? teacherGeometry : undefined,
    sheetName: INTEGRATED_SHEET_NAME,
    title: `${academyLabel} ${month}월 통합 영어시간표    ·    ${syncedAt} 반영`,
  });
  appendTeacherGridSheet(wb, slots, {
    teacherColors,
    stepMin,
    breakRanges,
    excludedTeachers,
    sectionLineMins,
    weekMonday,
    sheetName: TEACHER_SHEET_NAME,
    model: teacherModel,
  });
  // 학생 반이동 라운드트립: '수강편집' 탭(영어 수강만) — 수학과 동일 enrollment import 경로가 영어에서도 닫힌다.
  // 담당(scoped) 사용자에겐 생략 — 이 탭만은 teacherId 스코프가 안 걸린다(영어 전체 명단).
  if (opts?.includeEditSheet ?? true) {
    await appendEnrollmentEditSheet(wb, supabase, "english", opts?.db?.tenantId);
  }

  return { buffer: (await wb.xlsx.writeBuffer()) as ArrayBuffer, formulaCells };
}
