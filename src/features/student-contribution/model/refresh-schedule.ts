const DAY = 86_400_000;
/** Only a daily UTC schedule is accepted; an unknown schedule must not become a made-up ETA. */
export function dailyRefreshSchedule(cron: string | null, now: number) {
  const match = cron?.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (!match || Number(match[1]) > 59 || Number(match[2]) > 23 || !Number.isFinite(now)) return null;
  const date = new Date(now), hour = Number(match[2]), minute = Number(match[1]);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute);
  const next = today > now ? today : today + DAY;
  return { next, previous: next - DAY, time: `${String((hour + 9) % 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

export function remainingTime(milliseconds: number) {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}분 후`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (hours < 24) return `${hours}시간${rest ? ` ${rest}분` : ""} 후`;
  const days = Math.floor(hours / 24), extra = hours % 24;
  return `${days}일${extra ? ` ${extra}시간` : ""} 후`;
}

export function refreshScheduleState(cron: string | null, now: number, refreshedAt: string | null, checkedAt = now) {
  const schedule = dailyRefreshSchedule(cron, now);
  if (!schedule) return null;
  const lastSuccess = refreshedAt ? Date.parse(refreshedAt) : NaN;
  const awaiting = !Number.isFinite(lastSuccess) || lastSuccess < schedule.previous;
  return { ...schedule, status: awaiting ? checkedAt < schedule.previous ? "outdated" : checkedAt - schedule.previous <= 10 * 60_000 ? "running" : "unconfirmed" : "scheduled" } as const;
}
