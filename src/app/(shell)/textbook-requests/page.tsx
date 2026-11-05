import { requireAccess } from "@/lib/auth/require-access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { textbookRequestStudentIds } from "@/features/billing/server/textbook-scope";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { accountForTarget } from "@/features/owner/settings-types";
import { resolveBrandingSrc } from "@/lib/storage/media-storage";
import { getCatalogOptions } from "@/features/billing/server/catalog-queries";
import {
  getStudentOptions,
  getStudentOptionsForIds,
  getTextbookOrdersCreatedBy,
  getTextbookOrdersForStudents,
  getTextbookOrdersPage,
} from "@/features/billing/server/textbook-queries";
import { withTextbookNoticeLinks } from "@/features/billing/server/textbook-notice-links";
import { TextbookRequestClient } from "./_client";
import { NEUTRAL_ACADEMY_NAME } from "@/features/owner/defaults";

/**
 * 교재 요청 — 강사 미니셸 '내 메뉴' 진입(강사 스코프). 강사는 본인 담당 학생 교재를 요청하고
 * 진행상태(신청→주문→납부)를 조회. 사무실 역할(master/admin/accountant)은 전체 열람(처리는 /billing 교재 면).
 */
export default async function TextbookRequestsPage({
  searchParams,
}: {
  /**
   * `?studentId=` — 다른 화면에서 **그 학생으로 바로 신청서를 쓰라고** 보낸 링크(등록상담에서 수학 반을
   * 배정한 직후, 원장 2026-09-09). 값은 학생 선택칸의 초기값일 뿐이라 폼 동작·권한은 하나도 안 바뀐다.
   * ⚠️ 넘어온 id가 이 사람의 학생 목록에 없으면 클라가 조용히 무시한다(강사 스코프 밖 학생을 이 링크로
   *    끌어오지 않는다 + 이름 없는 raw UUID가 칩으로 뜨는 것 방지).
   */
  searchParams: Promise<{ studentId?: string | string[] }>;
}) {
  const user = await requireAccess("textbook_requests");
  const sp = await searchParams;
  const initialStudentIds = (Array.isArray(sp.studentId) ? sp.studentId : [sp.studentId])
    .map((v) => (v ?? "").trim())
    .filter(Boolean);
  // teacher(또는 겸직-강사뷰)면 본인 담당 학생만. isTeacher는 클라 UI(스코프 톤)에도 전달.
  const teacherId = await effectiveTeacherId();
  const isTeacher = teacherId !== null;
  // 카탈로그 = 폼 '교재 검색'(단가표 146권, 선택 시 교재명·상세·금액 자동입력 — ijw 패리티). 독립 조회라 병렬(B4).
  // 쓰기 여부 = 서버 액션(requestTextbook·수정·삭제·발송)과 **같은 판정** — 같은 행위자(teacherView)로
  // canWriteTenant("textbook_requests"). 읽기 권한이면 양식은 잠그고 저장·발송·수정·삭제 단추는 그리지 않는다
  // (원장 2026-11-05 — 양식을 다 쓰고 저장해야 "권한이 없습니다"가 떴다, write-lock.ts).
  const [settings, catalog, actor] = await Promise.all([
    getTenantSettings(),
    getCatalogOptions(),
    getCurrentUser({ teacherView: true }),
  ]);
  const canWrite = actor ? await canWriteTenant(actor.systemRole, "textbook_requests") : false;

  let rows;
  let students;
  if (teacherId) {
    // 감사 D5 — 담임 ∪ 교시 담당 ∪ 임시 위임(학생 상세 열람과 같은 판정) + **본인이 만든 요청은 항상**.
    const studentIds = await textbookRequestStudentIds(teacherId);
    const [scopedRows, mine, opts] = await Promise.all([
      getTextbookOrdersForStudents(studentIds),
      getTextbookOrdersCreatedBy(teacherId),
      getStudentOptionsForIds(studentIds),
    ]);
    const seen = new Set(scopedRows.map((r) => r.id));
    // 강사 목록 조회는 원스크린 경로라 발송 연결을 안 읽는다 — '발송함' 표시는 이 화면에서 따로 붙인다.
    rows = await withTextbookNoticeLinks(
      [...scopedRows, ...mine.filter((r) => !seen.has(r.id))].sort((a, b) =>
        (b.requestDate ?? "").localeCompare(a.requestDate ?? ""),
      ),
    );
    students = opts;
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
      academyName={settings.profile.name || NEUTRAL_ACADEMY_NAME}
      logoUrl={logoUrl}
      account={accountForTarget(settings.billing, "textbook")}
      requesterName={user.displayName}
      // 소유 판정 합집합(0174a) — 이름을 다르게 적어도 본인이 만든 요청은 본인 것.
      viewerUserId={user.id}
      initialStudentIds={initialStudentIds}
      classnoteOn={classnoteModuleOn(settings)}
      canWrite={canWrite}
    />
  );
}
