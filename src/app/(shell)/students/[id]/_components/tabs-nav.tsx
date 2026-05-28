import Link from "next/link";

export const STUDENT_TABS = [
  { key: "overview", label: "개요" },
  { key: "billing", label: "수납" },
  { key: "grades", label: "성적" },
  { key: "attendance", label: "출결" },
  { key: "consultations", label: "상담" },
  { key: "memos", label: "메모" },
  { key: "timeline", label: "타임라인" },
] as const;

export type StudentTabKey = (typeof STUDENT_TABS)[number]["key"];

export function isStudentTabKey(v: string | undefined): v is StudentTabKey {
  return STUDENT_TABS.some((t) => t.key === v);
}

export function StudentTabsNav({
  studentId,
  active,
}: {
  studentId: string;
  active: StudentTabKey;
}) {
  return (
    <nav
      role="tablist"
      className="border-border bg-card overflow-x-auto rounded-md border"
    >
      <ul className="flex gap-0.5 px-1.5 py-1.5">
        {STUDENT_TABS.map((t) => {
          const isActive = t.key === active;
          const href =
            t.key === "overview"
              ? `/students/${studentId}`
              : `/students/${studentId}?tab=${t.key}`;
          return (
            <li key={t.key}>
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={`shrink-0 rounded-sm px-3 py-1.5 text-xs font-medium transition ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
