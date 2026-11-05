import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageSheetSync } from "@/features/integrations/server/sheet-access";
import { canManageTimetableImport } from "@/features/timetable/server/import-access";
import { kstToday } from "@/lib/date-kst";
import { MASTER_SHEET_ID } from "@/features/timetable/import/master/types";
import { MasterSheetForm } from "./sheet-form";

export default async function EnglishSheetPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // 판정 = 시간표 툴바의 진입 링크(`canMasterImport`)·서버 반영 액션(master-sheet-actions)과 같은 두 문.
  // ⚠️ 시간표 메뉴 키(timetable)는 보지 않는다 — 서버 반영 게이트가 보지 않는 키로 화면만 닫으면 어긋난다(2026-11-05 리뷰).
  const [sheet, classes] = await Promise.all([
    canManageSheetSync(user.systemRole),
    canManageTimetableImport(user.systemRole),
  ]);
  if (!sheet || !classes)
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold">영어 시트 반영</h1>
        <p className="my-4">
          구글 시트 연동과 반 일괄 관리 권한이 모두 필요합니다.
        </p>
        <Link href="/timetable?subject=english">시간표로 돌아가기</Link>
      </div>
    );
  const source =
    user.tenantId === "becaa316-e636-42e9-9d09-08b133e0b094"
      ? `https://docs.google.com/spreadsheets/d/${MASTER_SHEET_ID}/edit`
      : "";
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <header>
        <Link
          href="/timetable?subject=english"
          className="text-sm text-text-dim hover:underline"
        >
          ← 영어 시간표
        </Link>
        <h1 className="mt-3 text-xl font-semibold">영어 시트 반영</h1>
        <p className="mt-1 text-sm text-text-dim">
          월별 시트의 수업 배치·반 이름·학생 이동을 확인하고 적용일을
          지정합니다.
        </p>
      </header>
      <MasterSheetForm today={kstToday()} defaultSource={source} />
    </div>
  );
}
