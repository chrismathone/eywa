import { logExportDownload } from "@/features/exports/server/log-export";
import { NextResponse } from "next/server";
import { kstToday } from "@/lib/date-kst";
import { requireAccess } from "@/lib/auth/require-access";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { attachmentFilename } from "@/lib/http/content-disposition";
import { buildTimetableWorkbook } from "@/features/exports/timetable-excel";
import { buildMathTimetableBuffer } from "@/features/exports/math-timetable/build-buffer";
import { buildEnglishTimetableBuffer } from "@/features/exports/english-timetable/build-buffer";
import { canManageTimetableImport } from "@/features/timetable/server/import-access";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(req: Request) {
  const user = await requireAccess("timetable");
  const subject = new URL(req.url).searchParams.get("subject") ?? "math";
  // 파일명 날짜는 **KST 오늘** — UTC로 뽑으면 한국 새벽(00~09시)에 어제 날짜가 박힌다.
  const date = kstToday();
  // 담당 스코프 = 화면과 동일 단일 소스(강사/겸직 강사뷰면 본인 반만, 관리자 뷰면 undefined=전체).
  const teacherId = (await effectiveTeacherId()) ?? undefined;
  // 라운드트립 '수강편집' 시트는 그리드와 달리 teacherId 스코프가 안 걸리는 **테넌트 전체 수강 명단**이라
  // 실제로 가져오기를 할 수 있는 권한자(classes=full)에게만 붙인다(2026-07-17 적대 감사 H1).
  const includeEditSheet = await canManageTimetableImport(user.systemRole);

  // 수학 = ijw 충실 익스포터(교시×강사요일 격자·요일그룹밴드·2D병합·반/강사/학생상태 색·진도메모).
  if (subject === "math") {
    const buf = await buildMathTimetableBuffer({ teacherId, includeEditSheet });
    await logExportDownload(req, "시간표");
    return new NextResponse(Buffer.from(buf), {
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Disposition": attachmentFilename(`수학_시간표_${date}.xlsx`),
      },
    });
  }

  // 영어 = 강사별(마스터) + 통합(파생) 2탭 익스포터. 화면 강사뷰/통합뷰와 동일 순수 모델 emit.
  if (subject === "english") {
    // '1시간 단위' 토글(compact1h) 반영. 엑셀 다운로드 = 정적 값(withFormulas 미지정=false).
    const compactSections = new Set(
      (new URL(req.url).searchParams.get("compact1h") ?? "").split(",").map(Number).filter(Number.isFinite),
    );
    const { buffer } = await buildEnglishTimetableBuffer({ teacherId, compactSections, includeEditSheet });
    await logExportDownload(req, "시간표");
    return new NextResponse(Buffer.from(buffer), {
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Disposition": attachmentFilename(`영어_시간표_${date}.xlsx`),
      },
    });
  }

  // 그 외 과목 — 익스포터 미이식, 기존 범용 워크북 폴백(후속 이식).
  // ⚠️ teacherId를 반드시 넘길 것 — 옛 코드는 안 넘겨서 이 폴백이 강사에게 전 강사·전 학생 명단을 줬다.
  const wb = await buildTimetableWorkbook({ teacherId, includeEditSheet });
  const buf = await wb.xlsx.writeBuffer();
  await logExportDownload(req, "시간표");
  return new NextResponse(buf, {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": attachmentFilename(`시간표_${date}.xlsx`),
    },
  });
}
