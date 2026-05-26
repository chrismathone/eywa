import { format } from "date-fns";
import { redirect } from "next/navigation";
import { getMostRecentAttendanceDate } from "@/features/attendance/server/queries";

export default async function AttendanceIndexPage() {
  const fallback = await getMostRecentAttendanceDate();
  const target = fallback ?? format(new Date(), "yyyy-MM-dd");
  redirect(`/attendance/${target}`);
}
