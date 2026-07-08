import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth/require-access";
import { attachmentFilename } from "@/lib/http/content-disposition";
import { buildTimetableWorkbook } from "@/features/exports/timetable-excel";
import { buildMathTimetableBuffer } from "@/features/exports/math-timetable/build-buffer";
import { buildEnglishTimetableBuffer } from "@/features/exports/english-timetable/build-buffer";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(req: Request) {
  const user = await requireAccess("timetable");
  const subject = new URL(req.url).searchParams.get("subject") ?? "math";
  const date = new Date().toISOString().slice(0, 10);

  // 수학 = ijw 충실 익스포터(교시×강사요일 격자·요일그룹밴드·2D병합·반/강사/학생상태 색·진도메모).
  if (subject === "math") {
    const teacherId = user.systemRole === "teacher" ? user.id : undefined;
    const buf = await buildMathTimetableBuffer({ teacherId });
    return new NextResponse(Buffer.from(buf), {
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Disposition": attachmentFilename(`수학_시간표_${date}.xlsx`),
      },
    });
  }

  // 영어 = 강사별(마스터) + 통합(파생) 2탭 익스포터. 화면 강사뷰/통합뷰와 동일 순수 모델 emit.
  if (subject === "english") {
    const teacherId = user.systemRole === "teacher" ? user.id : undefined;
    // '1시간 단위' 토글(compact1h) 반영. 엑셀 다운로드 = 정적 값(withFormulas 미지정=false).
    const compactSections = new Set(
      (new URL(req.url).searchParams.get("compact1h") ?? "").split(",").map(Number).filter(Number.isFinite),
    );
    const buf = await buildEnglishTimetableBuffer({ teacherId, compactSections });
    return new NextResponse(Buffer.from(buf), {
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Disposition": attachmentFilename(`영어_시간표_${date}.xlsx`),
      },
    });
  }

  // 그 외 과목 — 익스포터 미이식, 기존 범용 워크북 폴백(후속 이식).
  const wb = await buildTimetableWorkbook();
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": attachmentFilename(`시간표_${date}.xlsx`),
    },
  });
}
