import { redirect } from "next/navigation";
import { format } from "date-fns";

export default function AttendanceIndexPage() {
  const today = format(new Date(), "yyyy-MM-dd");
  redirect(`/attendance/${today}`);
}
