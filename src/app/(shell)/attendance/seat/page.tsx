import { redirect } from "next/navigation";
import { USABLE_SEAT_KEYS } from "@/features/attendance/seat/seat";

/** `/attendance/seat` → 열려 있는 첫 자리로. (1차 = 랩실 하나뿐이라 고를 화면을 따로 두지 않는다.) */
export default function SeatIndexPage() {
  redirect(`/attendance/seat/${USABLE_SEAT_KEYS[0]}`);
}
