import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Initial, type InitialColor } from "@/components/atoms/initial";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { getStudentsList } from "@/features/students/server/queries";

export const metadata = { title: "학생목록 — eywa" };

const STATUS_META: Record<string, { label: string; color: PillColor }> = {
  prospect: { label: "예비", color: "amber" },
  consulted: { label: "상담완료", color: "blue" },
  enrolled: { label: "재원", color: "primary" },
  on_hold: { label: "휴원", color: "amber" },
  withdrawn: { label: "퇴원", color: "neutral" },
};

// 학년에 따른 Initial 컬러 매핑 (시각적 다양성)
function colorForGrade(grade: string | null | undefined): InitialColor {
  if (!grade) return "neutral";
  if (grade.startsWith("중1")) return "blue";
  if (grade.startsWith("중2")) return "primary";
  if (grade.startsWith("중3")) return "gold";
  if (grade.startsWith("고1")) return "purple";
  if (grade.startsWith("고2")) return "rose";
  if (grade.startsWith("고3")) return "amber";
  return "neutral";
}

export default async function StudentsPage() {
  await requireAccess("students");
  const students = await getStudentsList();
  const enrolled = students.filter((s) => s.status === "enrolled").length;
  const prospect = students.filter((s) => s.status === "prospect" || s.status === "consulted").length;
  const withdrawn = students.filter((s) => s.status === "withdrawn").length;

  return (
    <div className="space-y-5">
      {/* Stat strip — 시안 4개 */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="전체" value={students.length} unit="명" color="primary" icon="seed" />
        <Stat label="재원" value={enrolled} unit="명" color="primary" icon="check" />
        <Stat label="예비·상담" value={prospect} unit="명" color="gold" icon="sprout" />
        <Stat label="퇴원" value={withdrawn} unit="명" color="neutral" icon="falling" />
      </section>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <p className="micro">전체 학생</p>
          <h2 className="text-foreground mt-0.5 text-[17px] font-bold">학생 명단</h2>
        </div>
        <Button render={<Link href="/students/new" />}>
          <EyIcon name="plus" size={13} className="mr-1" />새 학생
        </Button>
      </div>

      {students.length === 0 ? (
        <EmptyState
          icon={() => <EyIcon name="seed" size={32} />}
          title="등록된 학생이 없습니다"
          description="시드 데이터를 적용했는지 확인하세요."
        />
      ) : (
        <div className="bg-card border-line shadow-card overflow-hidden rounded-2xl border">
          <table className="w-full text-sm">
            <thead className="border-line border-b">
              <tr>
                <th className="micro px-5 py-3 text-left">학생</th>
                <th className="micro px-5 py-3 text-left">학년</th>
                <th className="micro px-5 py-3 text-left">학교</th>
                <th className="micro px-5 py-3 text-left">상태</th>
                <th className="micro px-5 py-3 text-left">담임</th>
                <th className="micro px-5 py-3 text-right">학부모 연락처</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {students.map((s) => {
                const meta = STATUS_META[s.status] ?? { label: s.status, color: "neutral" as PillColor };
                return (
                  <tr key={s.id} className="hover:bg-bg-soft/50 transition-colors">
                    <td className="px-5 py-3">
                      <Link
                        href={`/students/${s.id}`}
                        className="flex items-center gap-2.5"
                      >
                        <Initial name={s.name} color={colorForGrade(s.grade)} size="md" />
                        <span className="text-foreground text-[13px] font-bold hover:underline">
                          {s.name}
                        </span>
                      </Link>
                    </td>
                    <td className="text-text-dim px-5 py-3 text-xs">{s.grade ?? "—"}</td>
                    <td className="text-text-dim px-5 py-3 text-xs">{s.school ?? "—"}</td>
                    <td className="px-5 py-3">
                      <Pill color={meta.color}>{meta.label}</Pill>
                    </td>
                    <td className="text-text-dim px-5 py-3 text-xs">
                      {s.primaryTeacherName ?? "—"}
                    </td>
                    <td className="text-text-dim num px-5 py-3 text-right text-xs">
                      {s.parentPhone ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  color,
  icon,
}: {
  label: string;
  value: number;
  unit: string;
  color: "primary" | "gold" | "blue" | "neutral";
  icon: Parameters<typeof EyIcon>[0]["name"];
}) {
  const ICON_BG: Record<typeof color, string> = {
    primary: "bg-primary-soft text-primary",
    gold: "bg-gold-soft text-gold",
    blue: "bg-blue-soft text-blue",
    neutral: "bg-bg-soft text-text-dim",
  };
  return (
    <div className="bg-card border-line shadow-card rounded-2xl border p-4">
      <header className="flex items-center justify-between">
        <p className="micro">{label}</p>
        <span
          className={`flex size-[26px] items-center justify-center rounded-md ${ICON_BG[color]}`}
        >
          <EyIcon name={icon} size={13} />
        </span>
      </header>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="tabular text-foreground text-[28px] leading-none">{value}</span>
        <span className="text-text-dim text-xs">{unit}</span>
      </p>
    </div>
  );
}
