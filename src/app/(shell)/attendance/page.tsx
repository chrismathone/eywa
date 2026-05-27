import { format } from "date-fns";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { getMostRecentAttendanceDate } from "@/features/attendance/server/queries";

export default async function AttendanceIndexPage() {
  await requireAccess("attendance");
  const fallback = await getMostRecentAttendanceDate();
  const target = fallback ?? format(new Date(), "yyyy-MM-dd");
  redirect(`/attendance/${target}`);
}
