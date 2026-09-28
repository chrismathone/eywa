import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { resolveTenantReadUrls } from "@/lib/storage/media-storage";
import { BackLink } from "@/components/back-link";
import { getStaffResumeById } from "@/features/staff/server/resume-queries";
import { canViewResume } from "@/features/staff/server/resume-access";
import { ResumeSheet } from "../_components/resume-sheet";

export const metadata = { title: "직원 이력서 — 에이와" };

export default async function ResumeViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const user = await requireAccess("staff");
  const { id } = await params;
  const { edit } = await searchParams;
  const [resume, canWriteRole] = await Promise.all([
    getStaffResumeById(id),
    canWriteTenant(user.systemRole, "staff"),
  ]);
  if (!resume) notFound();
  const name = resume.data.personal.name || "(이름 미입력)";

  // 열람 게이트 = 공용 canViewResume(원장·관리자 — 재인증 제거, 2026-07-28). 쓰기 액션·/documents 삭제도 같은 함수.
  // 권한 밖이면 sheet(민감 데이터)를 렌더하지 않는다 — 클라로 전송 자체가 안 감.
  const canView = await canViewResume(user, resume.staffUserId);
  const isSelf = resume.staffUserId === user.id;
  // 열람 못 하면 수정도 불가(sheet 인라인 편집). 본인 이력서는 직원관리 권한 없이도 수정(2026-07-29).
  const canWrite = canView && (canWriteRole || isSelf);

  return (
    <div className="print-portrait space-y-4 p-6">
      <header className="print:hidden">
        <BackLink href="/staff" label="직원관리로" />
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
          // 직원 상세 '수정' 버튼(?edit=1) — 편집 모드로 바로 연다(수정 권한이 있을 때만).
          startEditing={edit === "1" && canWrite}
          // 성명·E-mail 칸 안내 — **서버가 실제로 계정에 반영하는 조건과 같게** 맞춘다
          // (계정에 연결된 이력서 + 직원관리 쓰기). 본인 이력서만 있는 사람에겐 안 뜬다.
          syncsToAccount={Boolean(resume.staffUserId) && canWriteRole}
          // 증명사진 signed URL — **게이트 통과(canView) 시에만** 발급·전달(경로만으론 열람 불가).
          photoUrls={await (async () => {
            if (resume.data.photos.length === 0) return [];
            const map = await resolveTenantReadUrls(resume.data.photos, "document", user.tenantId);
            return resume.data.photos.map((p) => map[p] ?? null);
          })()}
        />
      ) : (
        <div className="border-line bg-card mx-auto w-full max-w-[780px] rounded-2xl border p-8 text-center shadow-card">
          <p className="text-foreground text-sm font-bold">이력서는 원장·관리자와 본인만 열람할 수 있습니다</p>
          <p className="text-text-dim mt-1 text-xs">개인 인사 정보(주민번호·급여·계좌)가 담겨 있어 열람 권한이 제한됩니다.</p>
        </div>
      )}
    </div>
  );
}
