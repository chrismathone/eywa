import { requireAccess } from "@/lib/auth/require-access";
import { getTeacherScope } from "@/lib/auth/teacher-scope";
import { getTenantSettings } from "@/features/owner/server/queries";
import { resolveBrandingSrc } from "@/lib/storage/media-storage";
import { getCatalogOptions } from "@/features/billing/server/catalog-queries";
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
  // 카탈로그 = 폼 '교재 검색'(단가표 146권, 선택 시 교재명·상세·금액 자동입력 — ijw 패리티). 독립 조회라 병렬(B4).
  const [settings, catalog] = await Promise.all([getTenantSettings(), getCatalogOptions()]);

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
      catalog={catalog}
      isTeacher={isTeacher}
      academyName={settings.profile.name || "인재원"}
      logoUrl={logoUrl}
      account={settings.billing.account}
      requesterName={user.displayName}
    />
  );
}
