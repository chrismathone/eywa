import { getStaffWorkSchedule } from "@/features/staff/server/queries";
import { ScheduleEditor } from "../_components/schedule-editor";

export async function ScheduleTab({ staffId, canManage }: { staffId: string; canManage: boolean }) {
  const schedule = await getStaffWorkSchedule(staffId);
  return <ScheduleEditor staffId={staffId} initial={schedule} canManage={canManage} />;
}
