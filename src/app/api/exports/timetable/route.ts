import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth/require-access";
import { createClient } from "@/lib/supabase/server";
import { getWeeklyScheduleWithStudents } from "@/features/timetable/server/queries";
import { buildTimetableWorkbook } from "@/features/exports/timetable-excel";
import { assembleMathParams } from "@/features/exports/math-timetable/assemble";
import { exportMathTimetableToExcel } from "@/features/exports/math-timetable/exporter";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** 이번 주 월요일(00:00). 시간표 내보내기 기준 주차. */
function thisMonday(): Date {
  const now = new Date();
  const day = now.getDay(); // 0=일..6=토
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

export async function GET(req: Request) {
  const user = await requireAccess("timetable");
  const subject = new URL(req.url).searchParams.get("subject") ?? "math";
  const date = new Date().toISOString().slice(0, 10);

  // 수학 = ijw 충실 익스포터(교시×강사요일 격자·요일그룹밴드·2D병합·반/강사/학생상태 색·진도메모).
  if (subject === "math") {
    const teacherId = user.systemRole === "teacher" ? user.id : undefined;
    const [slots, supabase] = await Promise.all([
      getWeeklyScheduleWithStudents(teacherId),
      createClient(),
    ]);
    const { data: staff } = await supabase.from("users").select("display_name, bg_color, text_color");
    const teacherColors: Record<string, { bgColor?: string | null; textColor?: string | null }> = {};
    for (const u of staff ?? []) {
      if (u.bg_color || u.text_color) {
        teacherColors[u.display_name] = { bgColor: u.bg_color, textColor: u.text_color };
      }
    }
    const params = assembleMathParams(slots, { referenceMonday: thisMonday(), teacherColors });
    const buf = (await exportMathTimetableToExcel({ ...params, returnBufferOnly: true })) as ArrayBuffer;
    return new NextResponse(Buffer.from(buf), {
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Disposition": `attachment; filename="수학_시간표_${date}.xlsx"`,
      },
    });
  }

  // 그 외 과목(영어 등) — 익스포터 미이식, 기존 범용 워크북 폴백(후속 이식).
  const wb = await buildTimetableWorkbook();
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="시간표_${date}.xlsx"`,
    },
  });
}
