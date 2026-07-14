import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import { getStaffResumeById } from "@/features/staff/server/resume-queries";
import { RESUME_VIEW_COOKIE, verifyResumeViewToken } from "@/features/staff/server/resume-view-token";
import { ResumeSheet } from "../_components/resume-sheet";
import { ResumeUnlock } from "../_components/resume-unlock";

export const metadata = { title: "직원 이력서 — eywa" };

export default async function ResumeViewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("staff");
  const { id } = await params;
  const [resume, canWriteRole, jar] = await Promise.all([
    getStaffResumeById(id),
    canWriteTenant(user.systemRole, "staff"),
    cookies(),
  ]);
  if (!resume) notFound();
  const name = resume.data.personal.name || "(이름 미입력)";

  // 열람 게이트: 작성 본인 · 원장(master) · 재인증 10분 창(서명 쿠키) 중 하나면 열람.
  // 그 외 사무실 직원은 본인 비밀번호 재입력 필요 — 잠김일 땐 sheet(민감 데이터)를 렌더하지 않는다.
  const canView =
    resume.uploadedBy === user.id ||
    user.systemRole === "master" ||
    verifyResumeViewToken(jar.get(RESUME_VIEW_COOKIE)?.value, user.id, id);
  const canWrite = canView && canWriteRole; // 열람 못 하면 수정도 불가(sheet 인라인 편집)

  return (
    <div className="print-portrait space-y-4 p-6">
      <header className="print:hidden">
        <BackLink href="/staff?tab=resumes" label="직원 이력서 목록으로" />
        <h1 className="text-foreground mt-1 text-lg font-bold">직원 이력서 — {name}</h1>
        <p className="text-text-dim text-xs">
          {new Date(resume.createdAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} 작성
          {resume.authorName ? ` · ${resume.authorName}` : ""} · 데이터베이스(인사·직원)에 저장됨
        </p>
      </header>
      {canView ? (
        <ResumeSheet data={resume.data} id={id} canWrite={canWrite} />
      ) : (
        <ResumeUnlock id={id} name={name} />
      )}
    </div>
  );
}
