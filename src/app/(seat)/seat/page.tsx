import { redirect } from "next/navigation";
import { PIN_SEAT_KEYS } from "@/features/attendance/seat/seat";

/** `/seat` → 공개 PIN이 열린 첫 자리(랩실). 자리별 주소(`/seat/lab`·`/seat/jj`)를 직접 연다. */
export default function PublicSeatIndexPage() {
  redirect(`/seat/${PIN_SEAT_KEYS[0]}`);
}
