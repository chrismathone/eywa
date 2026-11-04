import { NextResponse, type NextRequest } from "next/server";
import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { attachmentFilename } from "@/lib/http/content-disposition";
import { ENGLISH_TRACK_LABEL } from "@/features/classes/english-track";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { examSlotLabel } from "@/features/grades/exam-slots";
import { termLabel } from "@/features/grades/term";
import { buildGradesWorkbook } from "@/features/grades/server/excel-build";
import { getGradeSheet } from "@/features/grades/server/queries";
import { resolveGradeSelection } from "@/features/grades/selection";

/**
 * 성적 엑셀 내려받기 — **지금 화면에 선 명단과 점수**가 들어간 xlsx(시트: 성적 · 안내).
 * 열람 권한(exams)만 있으면 받는다 — 올리는 쪽은 쓰기 게이트가 막는다(재고 선례).
 * 🔴 파일명의 한글은 헤더에 직접 넣지 않는다(B1 — `attachmentFilename`).
 * ⚠️ 축 해석은 화면(`/exams`)과 같은 순수 모듈을 쓴다. 주소가 곧 축이라 화면에서 보던 것과 같은 파일이 나온다.
 */
export async function GET(req: NextRequest) {
  await requireAccess("exams");
  const sp = req.nextUrl.searchParams;
  // 같은 이름이 두 번 오면 첫 값만 — 배열 필터로 400이 나지 않게(화면 page.tsx와 같은 방어).
  const one = (k: string) => (sp.get(k) ?? "").trim();

  const settings = await getTenantSettings();
  const subjects = buildSubjectMaps(settings.operations.subjects);
  // 🔴 축 해석은 화면과 **같은 순수 함수** 하나로 — 두 곳에서 규칙을 따로 적으면 "화면과 다른 시트가
  //    받아진다"가 된다(시험일이 학기 밖으로 새는 것, 만점 상한이 다른 것 모두 여기서 막힌다).
  const selection = resolveGradeSelection(
    {
      year: one("year"),
      term: one("term"),
      subject: one("subject"),
      class: one("class"),
      slot: one("slot"),
      date: one("date"),
      max: one("max"),
    },
    { subjectOptions: subjects.options, todayIso: kstToday() },
  );
  if (!selection) {
    return new NextResponse("과목이 등록되어 있지 않습니다 — 학원 설정에서 과목을 먼저 추가해 주세요.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const { year, term, slot } = selection;

  // 축을 정해야 명단을 뽑을 수 있어 순서가 있다(B4의 병렬 대상이 아니다).
  const sheet = await getGradeSheet(selection);
  const subjectLabel = subjects.labelOf(selection.subject);
  const wb = await buildGradesWorkbook(sheet, { subjectLabel, slotLabel: examSlotLabel(selection.subject, slot) });
  const buf = await wb.xlsx.writeBuffer();

  const className = sheet.classes.find((c) => c.id === selection.classId)?.className;
  // 파일명에 경로 문자가 섞이면 저장이 깨진다(반 이름은 사람이 적는 값).
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  const trackPart = selection.track ? `(${ENGLISH_TRACK_LABEL[selection.track]})` : "";
  const name = [
    "성적",
    termLabel(year, term).replace(/\s+/g, ""),
    `${subjectLabel}${trackPart}`,
    className ? safe(className) : null,
    examSlotLabel(selection.subject, slot),
    selection.date,
  ]
    .filter(Boolean)
    .join("_");

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachmentFilename(`${name}.xlsx`),
    },
  });
}
