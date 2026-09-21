import { loadUnitsMaster } from "@/features/attendance/server/units-master";
import { kstMonth } from "@/lib/date-kst";
import { UnitsMasterSheet } from "./sheet";

export const metadata = { title: "영어 시수 마스터 — eywa" };

export default async function UnitsMasterPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month } = await searchParams;
  const data = await loadUnitsMaster(month ?? kstMonth());
  return <UnitsMasterSheet data={data} />;
}
