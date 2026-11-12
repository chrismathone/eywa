import "server-only";
import { cache } from "react";
import { LIVE_RELATION_VERSION, type LiveConnections } from "@/features/students/ontology/live-contract";
import { getLiveContext, type LiveContext } from "./live-context";
import { readLiveEnrollments } from "./live-enrollments";
import { readLiveConsultations, readLiveMemos } from "./live-records";
import { readLiveFamily } from "./live-family";
import { readLegacyMakeups, readNativeMakeups } from "./live-makeups";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled, type ModuleId } from "@/lib/modules";

export const liveSectionReaders = [
  { key: "classes", label: "현재 수강·담당자", read: readLiveEnrollments },
  { key: "consultations", label: "최근 상담", read: readLiveConsultations },
  { key: "memos", label: "최근 메모", read: readLiveMemos },
  { key: "family", label: "보호자·형제", read: readLiveFamily },
  { key: "reservations", label: "기존 보강 예약", read: readLegacyMakeups, module: "makeups" },
  { key: "makeups", label: "새 보강관리 장부", read: readNativeMakeups, module: "makeups" },
] as const;
export function liveReadersFor(disabled: readonly ModuleId[]) {
  return liveSectionReaders.filter((reader) => !("module" in reader) || isModuleEnabled(disabled, reader.module));
}
export const readLiveSection = cache((key: (typeof liveSectionReaders)[number]["key"], context: LiveContext) =>
  liveSectionReaders.find((reader) => reader.key === key)!.read(context));

export async function getLiveConnections(studentId: string): Promise<LiveConnections | null> {
  const [context, settings] = await Promise.all([getLiveContext(studentId), getTenantSettings()]);
  if (!context) return null;
  return { studentId, asOf: context.today, checkedAt: new Date().toISOString(), ruleVersion: LIVE_RELATION_VERSION,
    sections: await Promise.all(liveReadersFor(settings.modules.disabled).map((reader) => readLiveSection(reader.key, context))) };
}
