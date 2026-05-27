import { BadgeCheck } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { getStaffList } from "@/features/staff/server/queries";

export const metadata = { title: "직원관리 — eywa" };

const ROLE_LABEL: Record<string, string> = {
  master: "원장",
  admin: "관리자",
  manager: "매니저",
  teacher: "강사",
  counselor: "상담",
  accountant: "회계",
  viewer: "참관",
};

const ROLE_COLOR: Record<string, string> = {
  master: "text-chart-4 bg-chart-4/10 border-chart-4/20",
  admin: "text-chart-1 bg-chart-1/10 border-chart-1/20",
  manager: "text-chart-1 bg-chart-1/10 border-chart-1/20",
  teacher: "text-chart-2 bg-chart-2/10 border-chart-2/20",
  counselor: "text-chart-3 bg-chart-3/10 border-chart-3/20",
  accountant: "text-chart-5 bg-chart-5/10 border-chart-5/20",
  viewer: "text-muted-foreground bg-muted border-border",
};

const STATUS_LABEL: Record<string, string> = {
  active: "재직",
  inactive: "퇴사",
  pending: "대기",
};

export default async function StaffPage() {
  await requireAccess("staff");
  const staff = await getStaffList();
  const teachers = staff.filter((s) => s.systemRole === "teacher").length;
  const total = staff.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="직원관리"
        description={`전체 ${total}명 · 강사 ${teachers}명. 역할/담당 학생수가 함께 표시됩니다.`}
      />

      {staff.length === 0 ? (
        <EmptyState icon={BadgeCheck} title="등록된 직원이 없습니다" />
      ) : (
        <div className="bg-card border-border overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-border text-muted-foreground border-b text-left text-xs">
              <tr>
                <th className="eyebrow px-5 py-3 font-normal">이름</th>
                <th className="eyebrow px-5 py-3 font-normal">역할</th>
                <th className="eyebrow px-5 py-3 font-normal">이메일</th>
                <th className="eyebrow num px-5 py-3 text-right font-normal">담당 반</th>
                <th className="eyebrow num px-5 py-3 text-right font-normal">담당 학생</th>
                <th className="eyebrow px-5 py-3 font-normal">상태</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {staff.map((s) => (
                <tr key={s.id} className="hover:bg-accent/40 transition-colors">
                  <td className="text-foreground px-5 py-3 font-medium">{s.displayName}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                        ROLE_COLOR[s.systemRole] ?? "bg-muted text-muted-foreground border-border"
                      }`}
                    >
                      {ROLE_LABEL[s.systemRole] ?? s.systemRole}
                    </span>
                  </td>
                  <td className="text-muted-foreground num px-5 py-3 text-xs">{s.email}</td>
                  <td className="text-foreground num px-5 py-3 text-right">
                    {s.classesCount > 0 ? `${s.classesCount}개` : "—"}
                  </td>
                  <td className="text-foreground num px-5 py-3 text-right">
                    {s.primaryStudentsCount > 0 ? `${s.primaryStudentsCount}명` : "—"}
                  </td>
                  <td className="text-muted-foreground px-5 py-3 text-xs">
                    {STATUS_LABEL[s.status] ?? s.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
