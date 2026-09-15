import { normAngle } from "./geometry";

/** 10~3월은 6시, 4~9월은 12시. 경계를 넘을 때 지정한 방향으로 반 바퀴 이동한다. */
export function ringLabelAngle(previous: number, month: number, direction: "clockwise" | "counterclockwise" = "clockwise"): number {
  const target = month >= 4 && month <= 9 ? 0 : 180;
  const delta = normAngle(target - previous);
  return previous + (direction === "counterclockwise" && delta > 0 ? delta - 360 : delta);
}
