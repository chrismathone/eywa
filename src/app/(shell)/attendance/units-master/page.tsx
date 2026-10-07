import { loadUnitsMaster } from "@/features/attendance/server/units-master";
import { kstMonth } from "@/lib/date-kst";
import { UnitsMasterSheet } from "./sheet";

export const metadata = { title: "시수 마스터 — 에이와" };

export default async function UnitsMasterPage({ searchParams }: { searchParams: Promise<{ month?: string; subject?: string }> }) {
  const { month, subject } = await searchParams;
  const data = await loadUnitsMaster(month ?? kstMonth());
  return <UnitsMasterSheet key={data.month} data={data} initialSubject={subject} />;
}
