import "server-only";
import { getShellView } from "@/lib/auth/view-mode";
import { isWithinMakeupDeadline, makeupDeadlineMessage } from "../makeup-options";

/**
 * **보강 기한 쓰기 문** — 결석한 달의 다음 달 말일이 지난 결석을 강사뷰에서 보강으로 잇지 못하게 한다
 * (원장 2026-09-18 *"강사뷰 보강 추가할때 1개월 초과된 보강은 보여주지말것 … 9월 결석이면 10월 마지막날까지"*).
 *
 * 🔴 **보강을 결석에 잇는 쓰기 경로는 전부 이 한 함수**를 지난다(#77 — 목록에서 뺀 결석을 '직접 입력'이나 다른 문으로
 *    되살리지 못하게): 메모 연결(`noteMakeupAgainstAbsence`) · 분리 보강 연결(`linkMakeupToAbsence`) · 원스크린 보강 등록
 *    (`registerMakeupEntries`). 목록(`fetchMakeupAbsences`)과 **같은 판정**(`getShellView() === "teacher"`)이다.
 * 🔑 선보강(결석일이 뒤)은 판정 전에 통과한다 — 셸 조회도 안 한다. 사무실 화면은 종전 그대로(null).
 * @returns 막을 때 한글 사유, 통과면 null.
 */
export async function makeupDeadlineError(absentDate: string, makeupDate: string): Promise<string | null> {
  if (isWithinMakeupDeadline(absentDate, makeupDate)) return null;
  if ((await getShellView()) !== "teacher") return null;
  return makeupDeadlineMessage(absentDate);
}
