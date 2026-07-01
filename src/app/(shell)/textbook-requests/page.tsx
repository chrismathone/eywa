import { requireAccess } from "@/lib/auth/require-access";
import { getTeacherScope } from "@/lib/auth/teacher-scope";
import { getTenantSettings } from "@/features/owner/server/queries";
import { resolveBrandingSrc } from "@/lib/storage/media-storage";
import {
  getStudentOptions,
  getStudentOptionsForIds,
  getTextbookOrdersForStudents,
  getTextbookOrdersPage,
} from "@/features/billing/server/textbook-queries";
import { TextbookRequestClient } from "./_client";

/**
 * 교재 요청 — 강사 미니셸 '내 메뉴' 진입(강사 스코프). 강사는 본인 담당 학생 교재를 요청하고
 * 진행상태(신청→주문→납부)를 조회. 사무실 역할(master/admin/accountant)은 전체 열람(처리는 /billing 교재 면).
 */
export default async function TextbookRequestsPage() {
  const user = await requireAccess("textbook_requests");
  const isTeacher = user.systemRole === "teacher";
  const settings = await getTenantSettings();

  let rows;
  let students;
  if (isTeacher) {
    const { studentIds } = await getTeacherScope(user.id);
    [rows, students] = await Promise.all([
      getTextbookOrdersForStudents(studentIds),
      getStudentOptionsForIds(studentIds),
    ]);
  } else {
    // 사무실 역할 — 전체 요청/학생(처리는 /billing에서). 최근 100건.
    const [page, opts] = await Promise.all([getTextbookOrdersPage({}, 1, 100), getStudentOptions()]);
    rows = page.rows;
    students = opts;
  }

  // '바로 다운로드'(목록에서 새 탭 없이 요청서 PNG)용 — 카드에 학원명·로고·계좌 필요.
  const logoUrl = await resolveBrandingSrc(settings.profile.logoUrl, user.tenantId);

  return (
    <TextbookRequestClient
      rows={rows}
      students={students}
      isTeacher={isTeacher}
      academyName={settings.profile.name || "인재원"}
      logoUrl={logoUrl}
      account={settings.billing.account}
    />
  );
}
