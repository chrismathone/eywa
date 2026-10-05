/** 추가 지도는 결석일을 만들지 않는다. 정책이 열리기 전에는 예약만 막는다. */

export function additionalReserveBlock(input: {
  cause: "absence" | "closure" | "additional" | "other";
  originalDate: string | null;
  allowAdditional: boolean;
  billingPolicy: string | null;
  anchorClassId: string | null;
}): string | null {
  if (input.cause === "additional" && input.originalDate) return "추가 지도에는 결석일을 넣지 않습니다";
  if (input.cause !== "additional") {
    return input.originalDate ? null : "결석일을 확인해 주세요";
  }
  if (!input.allowAdditional) return "추가 지도 예약은 아직 열리지 않았습니다";
  if (!input.billingPolicy || input.billingPolicy === "undecided") {
    return "추가 지도의 정산 기준이 정해진 뒤에 예약할 수 있습니다";
  }
  if (!input.anchorClassId) return "추가 지도는 출결을 남길 반을 지정한 뒤에 예약할 수 있습니다";
  return null;
}
