import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getWeeklyScheduleWithStudents } from "@/features/timetable/server/queries";
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
  const [slots, supabase] = await Promise.all([
    getWeeklyScheduleWithStudents({ teacherId: opts?.teacherId }),
    createClient(),
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
  });
  return (await exportMathTimetableToExcel({ ...params, returnBufferOnly: true })) as ArrayBuffer;
}
