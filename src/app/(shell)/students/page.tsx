import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Initial, type InitialColor } from "@/components/atoms/initial";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { StudentQuickPopover } from "@/components/student-quick-popover";
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

const SUBJECT_META: Record<string, { label: string; color: PillColor }> = {
  math: { label: "수학", color: "primary" },
  english: { label: "영어", color: "blue" },
  korean: { label: "국어", color: "rose" },
  science: { label: "과학", color: "purple" },
  arts: { label: "예술", color: "amber" },
};

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "enrolled", label: "재원" },
  { key: "consulted", label: "예비·상담" },
  { key: "on_hold", label: "휴원" },
  { key: "withdrawn", label: "퇴원" },
];

const SUBJECT_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "math", label: "수학" },
  { key: "english", label: "영어" },
  { key: "korean", label: "국어" },
  { key: "science", label: "과학" },
  { key: "arts", label: "예술" },
];

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

function buildHref(
  current: { status?: string; subject?: string; q?: string },
  patch: Partial<{ status: string; subject: string; q: string }>,
): string {
  const params = new URLSearchParams();
  const status = patch.status ?? current.status;
  const subject = patch.subject ?? current.subject;
  const q = patch.q !== undefined ? patch.q : current.q;
  if (status && status !== "all") params.set("status", status);
  if (subject && subject !== "all") params.set("subject", subject);
  if (q) params.set("q", q);
  const s = params.toString();
  return s ? `/students?${s}` : "/students";
}

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; subject?: string; q?: string }>;
}) {
  await requireAccess("students");
  const sp = await searchParams;
  const status = sp.status ?? "all";
  const subject = sp.subject ?? "all";
  const q = sp.q ?? "";

  const students = await getStudentsList({ status, subject, q });

  // 전체 카운트는 별도 unfiltered 쿼리로 (Stat 표시용)
  const all = await getStudentsList({});
  const enrolled = all.filter((s) => s.status === "enrolled").length;
  const prospect = all.filter((s) => s.status === "prospect" || s.status === "consulted").length;
  const withdrawn = all.filter((s) => s.status === "withdrawn").length;

  const current = { status, subject, q };

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="전체" value={all.length} unit="명" color="primary" icon="seed" />
        <Stat label="재원" value={enrolled} unit="명" color="primary" icon="check" />
        <Stat label="예비·상담" value={prospect} unit="명" color="gold" icon="sprout" />
        <Stat label="퇴원" value={withdrawn} unit="명" color="neutral" icon="falling" />
      </section>

      {/* Filter bar */}
      <div className="bg-card border-line shadow-card space-y-3 rounded-md border px-4 py-3">
        {/* 상태 chip */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="micro mr-1">상태</span>
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={buildHref(current, { status: f.key })}
              className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                status === f.key
                  ? "border-foreground bg-foreground text-background font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {/* 과목 chip + 검색 */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">과목</span>
            {SUBJECT_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildHref(current, { subject: f.key })}
                className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                  subject === f.key
                    ? "border-primary bg-primary text-primary-foreground font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>

          <form action="/students" method="get" className="ml-auto flex items-center gap-2">
            {status !== "all" ? (
              <input type="hidden" name="status" value={status} />
            ) : null}
            {subject !== "all" ? (
              <input type="hidden" name="subject" value={subject} />
            ) : null}
            <div className="border-line bg-bg-soft text-text-dim flex items-center gap-2 rounded-sm border px-2.5 py-1.5">
              <EyIcon name="search" size={13} />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="이름·학교"
                className="text-foreground placeholder:text-text-faint w-40 bg-transparent text-xs focus:outline-none"
              />
            </div>
            <Button type="submit" variant="outline" size="sm">
              검색
            </Button>
          </form>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="micro">
          결과 <span className="text-foreground font-bold">{students.length}</span>명
          {q ? <span className="text-text-dim ml-2">&ldquo;{q}&rdquo; 검색</span> : null}
        </p>
        <Button render={<Link href="/students/new" />}>
          <EyIcon name="plus" size={13} className="mr-1" />새 학생
        </Button>
      </div>

      {students.length === 0 ? (
        <EmptyState
          icon={() => <EyIcon name="seed" size={32} />}
          title="결과 없음"
          description="검색어/필터를 조정해보세요."
        />
      ) : (
        <div className="bg-card border-line shadow-card overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-line border-b">
              <tr>
                <th className="micro px-5 py-3 text-left">학생</th>
                <th className="micro px-5 py-3 text-left">학년</th>
                <th className="micro px-5 py-3 text-left">학교</th>
                <th className="micro px-5 py-3 text-left">상태</th>
                <th className="micro px-5 py-3 text-left">수강 과목</th>
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
                      <StudentQuickPopover
                        student={{
                          id: s.id,
                          name: s.name,
                          grade: s.grade,
                          school: s.school,
                          status: s.status,
                          subjects: s.subjects,
                          primaryTeacherName: s.primaryTeacherName,
                          parentPhone: s.parentPhone,
                          enrolledAt: s.enrolledAt,
                        }}
                      >
                        <Link href={`/students/${s.id}`} className="flex items-center gap-2.5">
                          <Initial name={s.name} color={colorForGrade(s.grade)} size="md" />
                          <span className="text-foreground text-[13px] font-bold hover:underline">
                            {s.name}
                          </span>
                        </Link>
                      </StudentQuickPopover>
                    </td>
                    <td className="text-text-dim px-5 py-3 text-xs">{s.grade ?? "—"}</td>
                    <td className="text-text-dim px-5 py-3 text-xs">{s.school ?? "—"}</td>
                    <td className="px-5 py-3">
                      <Pill color={meta.color}>{meta.label}</Pill>
                    </td>
                    <td className="px-5 py-3">
                      {s.subjects.length === 0 ? (
                        <span className="text-text-faint text-xs">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {s.subjects.map((sub) => {
                            const sm = SUBJECT_META[sub] ?? { label: sub, color: "neutral" as PillColor };
                            return (
                              <Pill key={sub} color={sm.color}>
                                {sm.label}
                              </Pill>
                            );
                          })}
                        </div>
                      )}
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
    <div className="bg-card border-line shadow-card rounded-md border p-4">
      <header className="flex items-center justify-between">
        <p className="micro">{label}</p>
        <span className={`flex size-[26px] items-center justify-center rounded-sm ${ICON_BG[color]}`}>
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
