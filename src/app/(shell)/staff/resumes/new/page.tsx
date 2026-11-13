import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { assignableRoles } from "@/lib/auth/role-hierarchy";
import { BackLink } from "@/components/back-link";
import { emptyResume } from "@/features/staff/resume/resume";
import { isImportArtifactEmail } from "@/features/staff/email";
import { getStaffById } from "@/features/staff/server/queries";
import { ResumeSheet } from "../_components/resume-sheet";
import { phoneLabel } from "@/lib/format/phone";

// 명칭(원장 지시 2026-08-07): **직원등록(신규, 연결 없음) 때만 "직원 명부"**, 그 외(기존 직원 연결·열람·수정)는 "이력서".
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ staff?: string }> }) {
  const { staff } = await searchParams;
  return { title: staff ? "직원 이력서 작성 — 에이와" : "직원 명부 작성 — 에이와" };
}

export default async function NewResumePage({
  searchParams,
}: {
  searchParams: Promise<{ staff?: string }>;
}) {
  const user = await requireAccess("staff");
  if (!(await canWriteTenant(user.systemRole, "staff"))) redirect("/staff");

  // 직원목록에서 이력서 없는 직원을 클릭해 온 경우(?staff=) — 아는 정보를 미리 채우고 저장 시 그 직원과 연결.
  const { staff: staffParam } = await searchParams;
  const staff = staffParam ? await getStaffById(staffParam) : null;
  const data = emptyResume();
  if (staff) {
    data.personal.name = staff.displayName;
    data.personal.nameEn = staff.englishName ?? "";
    // 플레이스홀더(@imported.local)는 실이메일이 아니므로 이력서에 안 옮긴다.
    data.personal.email = isImportArtifactEmail(staff.email) ? "" : staff.email;
    data.personal.phone = phoneLabel(staff.phone) ?? "";
    data.contract.startDate = staff.hireDate ?? "";
    // 지정 목록 밖 부서(시트 이관분 국어과·차량팀 등)도 그대로 옮긴다 — 잘라내면 프리필에서 부서가 사라진다.
    data.contract.division = staff.department ?? "";
    data.contract.employmentType = staff.employmentType ?? "";
    data.contract.jobTitle = staff.jobTitle ?? "";
  }

  return (
    <div className="print-portrait space-y-4 p-6">
      <header className="print:hidden">
        <BackLink href="/staff" label="직원관리로" />
        <h1 className="text-foreground mt-1 text-lg font-bold">
          {staff ? `직원 이력서 작성 — ${staff.displayName}` : "직원 명부 작성"}
        </h1>
        <p className="text-text-dim mt-1 text-sm">
          {staff
            ? "직원 정보로 미리 채워진 서식입니다 — 저장하면 이 직원과 이력서가 연결됩니다."
            : "종이 서식의 각 칸에 바로 입력하세요 — 저장하면 직원 계정까지 함께 만들어지고(하단 옵션), 이후엔 그 직원의 이력서로 보관됩니다."}
        </p>
      </header>
      <ResumeSheet
        data={data}
        userId={user.id}
        canWrite
        startEditing
        staffUserId={staff?.id}
        // 원샷 직원 등록 옵션 — 기존 직원 연결 모드에선 계정이 이미 있으므로 미노출.
        assignableRoles={!staff ? assignableRoles(user.systemRole) : []}
      />
    </div>
  );
}
