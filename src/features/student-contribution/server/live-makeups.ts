import "server-only";
import { foldedReason } from "@/lib/folded-read";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getMakeupCases } from "@/features/makeups/server/queries";
import { absenceClassOf } from "@/features/attendance/makeup-reservation";
import { sectionResult, type LiveItem } from "@/features/students/ontology/live-contract";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { readSection, unavailableSection, type LiveContext } from "./live-context";
import { isModuleEnabled } from "@/lib/modules";

export async function readLegacyMakeups(c: LiveContext) {
  const href = `/students/${c.studentId}?tab=attendance`;
  const settings = await getTenantSettings();
  if (!isModuleEnabled(settings.modules.disabled, "makeups")) return unavailableSection("reservations", "기존 보강 예약", href, "off");
  if (!c.attendance) return Promise.resolve(unavailableSection("reservations", "기존 보강 예약", href, "forbidden"));
  return readSection("reservations", "기존 보강 예약", href, async () => {
    const { data, count, error } = await c.db.from("makeup_reservations")
      .select("id, class_id, absence_class_id, absence_date, makeup_date, slot_start, slot_end, status, attendance_record_id", { count: "exact" })
      .eq("tenant_id", c.tenant).eq("student_id", c.studentId).order("makeup_date", { ascending: false }).order("id").limit(5);
    if (error) throw error;
    if (count === null) throw new Error("Missing reservation count");
    const ids = [...new Set((data ?? []).flatMap((r) => [r.class_id, r.absence_class_id ?? r.class_id]))];
    const classes = await fetchAllPagedInChunks<{ id: string; class_name: string }>(ids, (chunk, a, b) => c.db.from("classes")
      .select("id, class_name").eq("tenant_id", c.tenant).in("id", chunk).order("id").range(a, b));
    const names = new Map(classes.map((r) => [r.id, r.class_name]));
    const items = (data ?? []).map((r): LiveItem => {
      const absence = absenceClassOf({ classId: r.class_id, absenceClassId: r.absence_class_id });
      const state = r.status === "reserved" ? "예약" : r.status === "done" ? "완료" : "상태 확인 필요";
      return { id: r.id, title: `${state} · ${r.slot_start.slice(0, 5)}–${r.slot_end.slice(0, 5)}`, date: r.makeup_date,
        detail: `기록할 반 ${names.get(r.class_id) ?? "확인 필요"} / 결석난 반 ${names.get(absence) ?? "확인 필요"} · ${r.absence_date} 결석분`,
        evidence: [{ source: "makeup_reservations", id: r.id, studentId: c.studentId, href },
          ...(r.attendance_record_id ? [{ source: "attendance_records", id: r.attendance_record_id, studentId: c.studentId, href }] : [])] };
    });
    return { ...sectionResult("reservations", "기존 보강 예약", href, items, count), note: "남아 있는 예약 기록입니다. 삭제된 예약의 이력과 인정 분량은 이 자료로 판단하지 않습니다." };
  });
}

export function readNativeMakeups(c: LiveContext) {
  const href = `/makeups?student_id=${c.studentId}`;
  return readSection("makeups", "새 보강관리 장부", href, async () => {
    const settings = await getTenantSettings();
    if (foldedReason(settings)) return unavailableSection("makeups", "새 보강관리 장부", href, "failed");
    if (!isModuleEnabled(settings.modules.disabled, "makeups")) return unavailableSection("makeups", "새 보강관리 장부", href, "off");
    if (settings.makeups.mode === "off") return unavailableSection("makeups", "새 보강관리 장부", href, "off");
    if (!c.makeups) return unavailableSection("makeups", "새 보강관리 장부", href, "forbidden");
    const result = await getMakeupCases({ student_id: c.studentId, page: 1, page_size: 5 });
    if (!result.data) return unavailableSection("makeups", "새 보강관리 장부", href, result.reason ?? "failed");
    const items = result.data.rows.map((r): LiveItem => ({ id: r.id, title: r.original_class_name ?? "보강 기록", date: r.original_date ?? undefined,
      detail: r.eligibility === "pending" ? "자격 판단 전" : r.eligibility === "denied" ? "인정 대상 아님"
        : `${r.lifecycle === "closed" ? "종결" : r.lifecycle === "on_hold" ? "보류" : "진행 중"} · 남은 분량 ${r.outstanding_minutes === null ? "미확정" : `${r.outstanding_minutes}분`} · 예약 점유 ${r.committed_minutes}분`,
      evidence: [{ source: "makeup_cases", id: r.id, studentId: c.studentId, href: `/makeups/${r.id}` }] }));
    return { ...sectionResult("makeups", "새 보강관리 장부", href, items, result.data.total), note: "보강관리 장부의 판정을 그대로 표시합니다. 기존 예약 건수와 합산하지 않습니다." };
  });
}
