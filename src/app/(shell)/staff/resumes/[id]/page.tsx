import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { resolveTenantReadUrls } from "@/lib/storage/media-storage";
import { BackLink } from "@/components/back-link";
import { getStaffResumeById } from "@/features/staff/server/resume-queries";
import { canViewResume } from "@/features/staff/server/resume-access";
import { ResumeSheet } from "../_components/resume-sheet";
import { ResumeUnlock } from "../_components/resume-unlock";

export const metadata = { title: "직원 이력서 — eywa" };

export default async function ResumeViewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("staff");
  const { id } = await params;
  const [resume, canWriteRole] = await Promise.all([
    getStaffResumeById(id),
    canWriteTenant(user.systemRole, "staff"),
  ]);
  if (!resume) notFound();
  const name = resume.data.personal.name || "(이름 미입력)";

  // 열람 게이트 = 공용 canViewResume(작성 본인 · 원장 · 재인증 10분 창). 쓰기 액션·/documents 삭제도 같은 함수.
  // 잠김일 땐 sheet(민감 데이터)를 렌더하지 않는다 — 클라로 전송 자체가 안 감.
  const canView = await canViewResume(user, id, resume.uploadedBy);
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
        <ResumeSheet
          data={resume.data}
          id={id}
          userId={user.id}
          canWrite={canWrite}
          // 증명사진 signed URL — **게이트 통과(canView) 시에만** 발급·전달(경로만으론 열람 불가).
          photoUrls={await (async () => {
            if (resume.data.photos.length === 0) return [];
            const map = await resolveTenantReadUrls(resume.data.photos, "document", user.tenantId);
            return resume.data.photos.map((p) => map[p] ?? null);
          })()}
        />
      ) : (
        <ResumeUnlock id={id} name={name} />
      )}
    </div>
  );
}
