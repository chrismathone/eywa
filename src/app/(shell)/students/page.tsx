import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { getStudentsList } from "@/features/students/server/queries";

export const metadata = { title: "학생목록 — eywa" };

const STATUS_LABEL: Record<string, string> = {
  prospect: "예비",
  consulted: "상담완료",
  enrolled: "재원",
  on_hold: "휴원",
  withdrawn: "퇴원",
};

const STATUS_COLOR: Record<string, string> = {
  enrolled: "text-chart-2 bg-chart-2/10 border-chart-2/20",
  prospect: "text-chart-3 bg-chart-3/10 border-chart-3/20",
  consulted: "text-chart-1 bg-chart-1/10 border-chart-1/20",
  on_hold: "text-chart-3 bg-chart-3/10 border-chart-3/20",
  withdrawn: "text-muted-foreground bg-muted border-border",
};

export default async function StudentsPage() {
  await requireAccess("students");
  const students = await getStudentsList();
  const enrolled = students.filter((s) => s.status === "enrolled").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="학생목록"
        description={`전체 ${students.length}명 · 재원 ${enrolled}명. 클릭하면 상세를 봅니다.`}
        actions={
          <Button render={<Link href="/students/new" />}>
            <Plus className="size-4" />
            학생 등록
          </Button>
        }
      />

      {students.length === 0 ? (
        <EmptyState
          icon={Users}
          title="등록된 학생이 없습니다"
          description="시드 데이터를 적용했는지 확인하세요."
        />
      ) : (
        <div className="bg-card border-border overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-border text-muted-foreground border-b text-left text-xs">
              <tr>
                <th className="eyebrow px-5 py-3 font-normal">학년</th>
                <th className="eyebrow px-5 py-3 font-normal">이름</th>
                <th className="eyebrow px-5 py-3 font-normal">학교</th>
                <th className="eyebrow px-5 py-3 font-normal">상태</th>
                <th className="eyebrow px-5 py-3 font-normal">담임</th>
                <th className="eyebrow num px-5 py-3 text-right font-normal">학부모 연락처</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {students.map((s) => (
                <tr key={s.id} className="hover:bg-accent/40 transition-colors">
                  <td className="text-muted-foreground px-5 py-3">{s.grade ?? "—"}</td>
                  <td className="px-5 py-3">
                    <Link
                      href={`/students/${s.id}`}
                      className="text-foreground font-medium hover:underline"
                    >
                      {s.name}
                    </Link>
                  </td>
                  <td className="text-muted-foreground px-5 py-3">{s.school ?? "—"}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                        STATUS_COLOR[s.status] ?? "bg-muted text-muted-foreground border-border"
                      }`}
                    >
                      {STATUS_LABEL[s.status] ?? s.status}
                    </span>
                  </td>
                  <td className="text-muted-foreground px-5 py-3">
                    {s.primaryTeacherName ?? "—"}
                  </td>
                  <td className="text-muted-foreground num px-5 py-3 text-right">
                    {s.parentPhone ?? "—"}
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
