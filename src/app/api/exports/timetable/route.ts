import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth/require-access";
import { buildTimetableWorkbook } from "@/features/exports/timetable-excel";

export async function GET() {
  await requireAccess("timetable");
  const wb = await buildTimetableWorkbook();
  const buf = await wb.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(buf, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="시간표_${date}.xlsx"`,
    },
  });
}
