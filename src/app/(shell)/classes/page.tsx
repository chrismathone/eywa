import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { Initial } from "@/components/atoms/initial";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import { getClassesList } from "@/features/classes/server/queries";

export const metadata = { title: "수업목록 — eywa" };

type SubjectColor = "primary" | "blue" | "rose" | "purple" | "amber";

const SUBJECT_META: Record<string, { label: string; color: SubjectColor }> = {
  math: { label: "수학", color: "primary" },
  english: { label: "영어", color: "blue" },
  korean: { label: "국어", color: "rose" },
  science: { label: "과학", color: "purple" },
  arts: { label: "예술", color: "amber" },
};

const SUBJECT_COLOR_BAR: Record<SubjectColor, string> = {
  primary: "bg-primary",
  blue: "bg-blue",
  rose: "bg-rose",
  purple: "bg-purple",
  amber: "bg-amber",
};

const SUBJECT_PILL: Record<SubjectColor, PillColor> = {
  primary: "primary",
  blue: "blue",
  rose: "rose",
  purple: "purple",
  amber: "amber",
};

export default async function ClassesPage() {
  await requireAccess("classes");
  const classes = await getClassesList();
  const active = classes.filter((c) => c.isActive).length;
  const totalSeats = classes.reduce((s, c) => s + c.studentCount, 0);
  const avgPerClass = classes.length > 0 ? Math.round(totalSeats / classes.length) : 0;

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="전체 반" value={classes.length} unit="개" icon="branch" color="primary" />
        <Stat label="운영 중" value={active} unit="개" icon="check" color="primary" />
        <Stat label="등록 학생" value={totalSeats} unit="명" icon="seed" color="blue" />
        <Stat label="반당 평균" value={avgPerClass} unit="명" icon="rings" color="gold" />
      </section>

      <div>
        <p className="micro">수업 카드</p>
        <h2 className="text-foreground mt-0.5 text-[17px] font-bold">
          전체 {classes.length}개 반
        </h2>
      </div>

      {classes.length === 0 ? (
        <EmptyState icon={() => <EyIcon name="branch" size={32} />} title="등록된 수업이 없습니다" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((c) => {
            const meta = SUBJECT_META[c.subject] ?? { label: c.subject, color: "primary" as SubjectColor };
            // 정원 가정: 8명 (시드 없음). 정원율 표시
            const capacity = 8;
            const pct = Math.min(100, (c.studentCount / capacity) * 100);
            return (
              <Link
                key={c.id}
                href={`/classes/${c.id}`}
                className="bg-card border-line shadow-card hover:shadow-card-hover flex flex-col gap-4 rounded-2xl border p-5 transition"
              >
                <header className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Pill color={SUBJECT_PILL[meta.color]}>{meta.label}</Pill>
                    {c.isActive ? (
                      <Pill color="primary" soft={false}>
                        ● 운영
                      </Pill>
                    ) : (
                      <Pill color="neutral">종료</Pill>
                    )}
                  </div>
                </header>

                <div>
                  <h3 className="text-foreground text-[17px] font-extrabold leading-tight">
                    {c.className}
                  </h3>
                </div>

                <div className="space-y-2 text-[12px]">
                  <div className="flex items-center gap-2">
                    {c.teacherName ? (
                      <Initial name={c.teacherName} color="gold" size="sm" />
                    ) : (
                      <span className="bg-bg-soft size-6 rounded-md" />
                    )}
                    <span className="text-text-dim flex-1 truncate">
                      {c.teacherName ?? "담임 미정"} 강사
                    </span>
                    {c.classroomName ? (
                      <span className="text-text-faint font-mono text-[11px]">{c.classroomName}</span>
                    ) : null}
                  </div>
                </div>

                <div className="border-line border-t pt-3">
                  <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
                    <span className="text-text-dim">정원 현황</span>
                    <span className="text-foreground num font-bold">
                      {c.studentCount} / {capacity}명
                    </span>
                  </div>
                  <div className="bg-bg-soft h-1.5 overflow-hidden rounded-full">
                    <span
                      className={`block h-full ${SUBJECT_COLOR_BAR[meta.color]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  icon,
  color,
}: {
  label: string;
  value: number;
  unit: string;
  icon: Parameters<typeof EyIcon>[0]["name"];
  color: "primary" | "blue" | "gold";
}) {
  const ICON_BG = {
    primary: "bg-primary-soft text-primary",
    blue: "bg-blue-soft text-blue",
    gold: "bg-gold-soft text-gold",
  } as const;
  return (
    <div className="bg-card border-line shadow-card rounded-2xl border p-4">
      <header className="flex items-center justify-between">
        <p className="micro">{label}</p>
        <span className={`flex size-[26px] items-center justify-center rounded-md ${ICON_BG[color]}`}>
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
