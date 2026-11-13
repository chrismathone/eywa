import "server-only";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { BOARDING_STATUS_LABEL, isBoardingStatus } from "@/features/shuttle/types";
import { sectionResult, type LiveItem } from "@/features/students/ontology/live-contract";
import { readSection, unavailableSection, type LiveContext } from "./live-context";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";

export function readLiveShuttle(c: LiveContext) {
  const href = "/shuttle/today";
  return readSection("shuttle", "셔틀 탑승 기록", href, async () => {
    const settings = await getTenantSettings();
    if (!isModuleEnabled(settings.modules.disabled, "shuttle")) return unavailableSection("shuttle", "셔틀 탑승 기록", href, "off");
    if (!(await canAccessTenant(c.role, "shuttle"))) return unavailableSection("shuttle", "셔틀 탑승 기록", href, "forbidden");
    const { data, count, error } = await c.db.from("shuttle_boardings")
      .select("id, boarded_on, status, stop_label, vehicle_label", { count: "exact" }).eq("tenant_id", c.tenant).eq("student_id", c.studentId)
      .order("boarded_on", { ascending: false }).order("id").limit(5);
    if (error) throw error;
    if (count === null) throw new Error("Missing boarding count");
    return { ...sectionResult("shuttle", "셔틀 탑승 기록", href, (data ?? []).map((r): LiveItem => ({ id: r.id, date: r.boarded_on,
      title: isBoardingStatus(r.status) ? BOARDING_STATUS_LABEL[r.status] : "상태 확인 필요", detail: [r.vehicle_label, r.stop_label].filter(Boolean).join(" / ") || "차량·정류장 정보 미입력",
      evidence: [{ source: "shuttle_boardings", id: r.id, studentId: c.studentId, href: `${href}?d=${r.boarded_on}` }] })), count),
      note: "기록된 탑승 상태입니다. 탑승 기록이 없는 날의 이용 여부는 판단하지 않습니다." };
  });
}
