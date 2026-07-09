import Link from "next/link";

export const STAFF_TABS = [
  { key: "info", label: "기본정보" },
  { key: "schedule", label: "근무일정" },
  { key: "classes", label: "수업이력" },
] as const;

// 활동 로그 탭 — 사무실(master/admin/manager)에게만 노출(activity_log RLS와 정합). 별도 상수로 조건부 부착.
const ACTIVITY_TAB = { key: "activity", label: "활동 로그" } as const;

export type StaffTabKey = (typeof STAFF_TABS)[number]["key"] | "activity";

export function isStaffTabKey(v: string | undefined): v is StaffTabKey {
  return v === "activity" || STAFF_TABS.some((t) => t.key === v);
}

export function StaffTabsNav({
  staffId,
  active,
  showActivity,
}: {
  staffId: string;
  active: StaffTabKey;
  showActivity: boolean;
}) {
  const tabs = showActivity ? [...STAFF_TABS, ACTIVITY_TAB] : STAFF_TABS;
  return (
    <nav
      role="tablist"
      className="scrollbar-thin border-border bg-card overflow-x-auto rounded-md border"
    >
      <ul className="flex gap-0.5 px-1.5 py-1.5">
        {tabs.map((t) => {
          const isActive = t.key === active;
          const href = t.key === "info" ? `/staff/${staffId}` : `/staff/${staffId}?tab=${t.key}`;
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
