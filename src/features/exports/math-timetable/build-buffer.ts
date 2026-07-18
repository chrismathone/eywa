import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getWeeklyScheduleWithStudents } from "@/features/timetable/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import type { TenantSettings } from "@/features/owner/settings-types";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import { reportWarning } from "@/lib/observability/report-error";
import { appendEnrollmentEditSheet } from "@/features/exports/enrollment-edit-sheet";
import { kstToday } from "@/lib/date-kst";
import { thisMonday as thisMondayStr } from "@/features/timetable/lib/week";
import { assembleMathParams } from "./assemble";
import { exportMathTimetableToExcel } from "./exporter";

/**
 * 이번 주 월요일(UTC 00:00) — **KST 오늘 기준**. ⚠️ `new Date().getDay()`(서버 로컬=Vercel UTC) 금지:
 * KST 월요일 04:00(=UTC 일요일 19:00)에 도는 새벽 cron이 getDay()=0 → 지난주 월요일로 밀린다(적대리뷰
 * 2026-07-13). 문자열 기반 thisMonday(UTC 결정적) + UTC 자정 Date로 도출 → getMonth/getDate가 KST/UTC 동일.
 */
export function thisMonday(): Date {
  return new Date(`${thisMondayStr(kstToday())}T00:00:00Z`);
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
  /**
   * 라운드트립 '수강편집' 시트 포함 여부(기본 true — cron 시트 push는 이 시트가 있어야 가져오기가 닫힌다).
   * ⚠️ 그리드는 teacherId로 스코프돼도 이 시트는 **과목 전체 수강 명단**이라 스코프가 안 걸린다 →
   * 담당(scoped) 사용자에겐 false로 끌 것(2026-07-17 적대 감사: 강사가 엑셀 버튼만 눌러도 같은 과목
   * 전 학생 이름·학교·학년이 시트로 나갔다).
   */
  includeEditSheet?: boolean;
  /** 세션 없는 호출(cron 자동 시트 반영)용 주입 — admin 클라이언트 + tenant 명시 + 설정(쿠키 경로 회피). */
  db?: { supabase: Awaited<ReturnType<typeof createClient>>; tenantId: string; settings: TenantSettings };
}): Promise<ArrayBuffer> {
  const timetableDb = opts?.db ? { supabase: opts.db.supabase, tenantId: opts.db.tenantId } : undefined;
  const [slots, supabase, settings] = await Promise.all([
    getWeeklyScheduleWithStudents({ teacherId: opts?.teacherId, db: timetableDb }),
    opts?.db ? Promise.resolve(opts.db.supabase) : createClient(),
    opts?.db ? Promise.resolve(opts.db.settings) : getTenantSettings(),
  ]);

  let staffQuery = supabase.from("users").select("display_name, bg_color, text_color");
  if (opts?.db) staffQuery = staffQuery.eq("tenant_id", opts.db.tenantId); // admin(cron) 경로 — 명시 격리
  const { data: staff } = await staffQuery;
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
    // 수학 파일엔 **수학 수강만** — 영어 학생이 섞이지 않게(과목별 시트 분리·cross-subject remove 방지).
    // 담당(scoped) 사용자에겐 생략 — 이 시트만은 teacherId 스코프가 안 걸린다(과목 전체 명단).
    appendSheets:
      (opts?.includeEditSheet ?? true)
        ? (wb) => appendEnrollmentEditSheet(wb, supabase, "math", opts?.db?.tenantId)
        : undefined,
  })) as ArrayBuffer;
}
