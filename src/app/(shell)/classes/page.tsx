import { BookOpen } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { getClassesList } from "@/features/classes/server/queries";

export const metadata = { title: "수업목록 — eywa" };

const SUBJECT_LABEL: Record<string, string> = {
  math: "수학",
  english: "영어",
  korean: "국어",
  science: "과학",
};

const SUBJECT_ACCENT: Record<string, string> = {
  math: "text-chart-1",
  english: "text-chart-3",
  korean: "text-chart-5",
  science: "text-chart-2",
};

export default async function ClassesPage() {
  await requireAccess("classes");
  const classes = await getClassesList();
  const active = classes.filter((c) => c.isActive).length;
  const totalSeats = classes.reduce((s, c) => s + c.studentCount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="수업목록"
        description={`전체 ${classes.length}개 반 · 운영 중 ${active}개 · 등록 인원 ${totalSeats}명`}
      />

      {classes.length === 0 ? (
        <EmptyState icon={BookOpen} title="등록된 수업이 없습니다" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {classes.map((c) => (
            <article
              key={c.id}
              className="bg-card border-border flex flex-col gap-4 rounded-lg border p-5"
            >
              <header className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={`eyebrow ${SUBJECT_ACCENT[c.subject] ?? ""}`}>
                    {SUBJECT_LABEL[c.subject] ?? c.subject}
                  </p>
                  <h3 className="text-foreground mt-1.5 text-base font-semibold leading-tight">
                    {c.className}
                  </h3>
                </div>
                {c.isActive ? (
                  <span className="text-chart-2 bg-chart-2/10 border-chart-2/20 shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium">
                    운영 중
                  </span>
                ) : (
                  <span className="text-muted-foreground bg-muted border-border shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium">
                    종료
                  </span>
                )}
              </header>

              <dl className="border-border space-y-2 border-t pt-4 text-xs">
                <Row label="담임" value={c.teacherName} />
                <Row label="강의실" value={c.classroomName} />
                <Row label="학생 수" value={`${c.studentCount}명`} mono />
              </dl>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-foreground ${mono ? "num" : ""}`}>{value ?? "—"}</dd>
    </div>
  );
}
