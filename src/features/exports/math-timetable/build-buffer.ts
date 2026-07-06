import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getWeeklyScheduleWithStudents } from "@/features/timetable/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import { reportWarning } from "@/lib/observability/report-error";
import { appendEnrollmentEditSheet } from "@/features/exports/enrollment-edit-sheet";
import { assembleMathParams } from "./assemble";
import { exportMathTimetableToExcel } from "./exporter";

/** 이번 주 월요일(00:00) — 시간표 내보내기 기준 주차. */
export function thisMonday(): Date {
  const now = new Date();
  const day = now.getDay(); // 0=일..6=토
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

/**
 * 수학 시간표 xlsx 버퍼 빌드 — ijw 충실 익스포터(교시×강사요일 격자·요일그룹밴드·2D병합·
 * 반/강사/학생상태 색·진도메모). **라우트(다운로드)와 구글시트 동기화가 공유하는 단일 빌더**.
 *
 * - `teacherId`: 강사 본인 뷰면 담당 반만(스코핑). 미지정=전체(master/관리자 뷰).
 * - 강사 헤더색은 `users.bg_color/text_color`(설정값) → 없으면 익스포터 해시색 폴백.
 */
export async function buildMathTimetableBuffer(opts?: {
  teacherId?: string;
  referenceMonday?: Date;
}): Promise<ArrayBuffer> {
  const [slots, supabase, settings] = await Promise.all([
    getWeeklyScheduleWithStudents({ teacherId: opts?.teacherId }),
    createClient(),
    getTenantSettings(),
  ]);

  const { data: staff } = await supabase
    .from("users")
    .select("display_name, bg_color, text_color");
  const teacherColors: Record<string, { bgColor?: string | null; textColor?: string | null }> = {};
  for (const u of staff ?? []) {
    if (u.bg_color || u.text_color) {
      teacherColors[u.display_name] = { bgColor: u.bg_color, textColor: u.text_color };
    }
  }

  const params = assembleMathParams(slots, {
    referenceMonday: opts?.referenceMonday ?? thisMonday(),
    teacherColors,
    // 테넌트 교시 설정(과목 전용 포함) — 커스텀 교시 시각 슬롯이 엑셀/시트에서 무에러 증발하지 않게(적대리뷰 2026-07-06).
    periodsConfig: settingsToPeriodsConfig(settings.operations),
    onSkippedSlots: (count) =>
      reportWarning(`수학 시간표 export: 교시 매핑 실패로 그리드에서 제외된 슬롯 ${count}개(교시 시작 시각 불일치 또는 레거시 8교시 초과)`, {
        scope: "math-timetable-export",
      }),
  });
  return (await exportMathTimetableToExcel({
    ...params,
    returnBufferOnly: true,
    // 라운드트립 import용 '수강편집' 시트를 직렬화 직전에 덧붙임(다운로드·구글시트 push 공유 버퍼).
    appendSheets: (wb) => appendEnrollmentEditSheet(wb, supabase),
  })) as ArrayBuffer;
}
