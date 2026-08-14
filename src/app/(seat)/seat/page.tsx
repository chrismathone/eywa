import { redirect } from "next/navigation";
import { OPEN_SEAT_KEYS } from "@/features/attendance/seat/seat";

/** `/seat` → 열려 있는 첫 자리(1차 = 랩실). */
export default function PublicSeatIndexPage() {
  redirect(`/seat/${OPEN_SEAT_KEYS[0]}`);
}
