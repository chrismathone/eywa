import { expect, it } from "vitest";
import { dailyRefreshSchedule, refreshScheduleState, remainingTime } from "./refresh-schedule";
it("UTC cron을 한국시간 자정 이후의 실제 다음 일정으로 환산한다", () => {
  const now = Date.parse("2026-10-26T15:39:00Z");
  expect(dailyRefreshSchedule("40 15 * * *", now)).toEqual({ next: Date.parse("2026-10-26T15:40:00Z"), previous: Date.parse("2026-10-25T15:40:00Z"), time: "00:40" });
  expect(remainingTime(60_000)).toBe("1분 후"); expect(remainingTime(3_660_000)).toBe("1시간 1분 후");
  expect(remainingTime(86_400_000)).toBe("1일 후");
});
it("예정 시각이 지나도 실제 완료되지 않은 집계를 성공으로 표시하지 않는다", () => {
  expect(refreshScheduleState("40 15 * * *", Date.parse("2026-10-26T16:00:00Z"), "2026-10-25T15:41:00Z", Date.parse("2026-10-26T10:00:00Z"))?.status).toBe("outdated");
  expect(refreshScheduleState("40 15 * * *", Date.parse("2026-10-26T15:40:00Z"), "2026-10-25T15:41:00Z")?.status).toBe("running");
  expect(refreshScheduleState("40 15 * * *", Date.parse("2026-10-26T16:00:00Z"), "2026-10-25T15:41:00Z")?.status).toBe("unconfirmed");
  expect(refreshScheduleState("40 15 * * *", Date.parse("2026-10-26T16:00:00Z"), "2026-10-26T15:41:00Z")?.status).toBe("scheduled");
  expect(dailyRefreshSchedule("0 */6 * * *", Date.now())).toBeNull(); expect(dailyRefreshSchedule("60 25 * * *", Date.now())).toBeNull();
});
