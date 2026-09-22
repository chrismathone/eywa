import { OverviewDashboard } from "./_overview/overview-server";

export const metadata = { title: "대시보드 — aywa" };
export const maxDuration = 60;

/** 기본 주소와 기존 one/design 주소는 확정된 같은 대시보드를 제공한다. */
export default async function DashboardPage({ searchParams }: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  if (view === "rooms") {
    const [{ ClassroomPreview }, { loadClassroomPreview }] = await Promise.all([
      import("./_classrooms/classrooms"),
      import("@/features/dashboard/classroom-preview/server"),
    ]);
    return <ClassroomPreview initial={await loadClassroomPreview()} />;
  }
  return <OverviewDashboard />;
}
