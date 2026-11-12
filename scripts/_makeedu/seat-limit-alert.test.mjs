import { describe, expect, it } from "vitest";
import alert from "./seat-limit-alert.cjs";

const { seatLimitAlertNeeded, seatLimitAlertText } = alert;

function fakeSql({ maxSeats, enrolled, recipients = [{ id: "owner" }], fresh = true }) {
  const calls = [];
  function sql(parts, ...values) {
    if (!Object.hasOwn(parts, "raw")) return { rows: parts, columns: values };
    const query = parts.join("?");
    calls.push(query);
    if (query.includes("from tenant_licenses")) return Promise.resolve(maxSeats == null ? [] : [{ max_seats: maxSeats }]);
    if (query.includes("count(*)::int as enrolled")) return Promise.resolve([{ enrolled }]);
    if (query.includes("from users")) return Promise.resolve(recipients);
    if (query.includes("insert into notification_events")) return Promise.resolve(fresh ? [{ id: "event" }] : []);
    if (query.includes("insert into notifications")) return Promise.resolve([]);
    throw new Error(`예상하지 못한 SQL: ${query}`);
  }
  return { sql, calls };
}

describe("makeedu 학생 가져오기 좌석 초과 알림", () => {
  it("침산처럼 최대 좌석이 없거나 새 재원생이 없으면 아무 일도 하지 않는다", () => {
    expect(seatLimitAlertNeeded(1, Number.NaN, 500)).toBe(false);
    expect(seatLimitAlertNeeded(0, 10, 11)).toBe(false);
  });

  it("새 재원생 가져오기로 한도를 넘긴 경우만 알린다", () => {
    expect(seatLimitAlertNeeded(1, 10, 10)).toBe(false);
    expect(seatLimitAlertNeeded(1, 10, 11)).toBe(true);
    expect(seatLimitAlertText(10, 11)).toEqual({
      title: "좌석 한도 초과",
      body: "makeedu 학생 가져오기 후 재원생 11명 · 좌석 한도 10석",
    });
  });

  it("초과 반영 뒤 원장 벨 알림을 기록하고 최대 좌석이 없으면 기록하지 않는다", async () => {
    const over = fakeSql({ maxSeats: 10, enrolled: 11 });
    await expect(alert.notifySeatLimitExceeded(over.sql, "tenant", 1)).resolves.toBe(1);
    expect(over.calls.some((query) => query.includes("insert into notifications"))).toBe(true);

    const unlimited = fakeSql({ maxSeats: null, enrolled: 500 });
    await expect(alert.notifySeatLimitExceeded(unlimited.sql, "cs", 1)).resolves.toBe(0);
    expect(unlimited.calls).toHaveLength(1);
  });
});
