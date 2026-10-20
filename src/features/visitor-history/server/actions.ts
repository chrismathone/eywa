"use server";
import { isValidYm, kstToday } from "@/lib/date-kst";
import { visitorAccess } from "./access";
import { cachedVisitorMonth, visitorMonthTag } from "./google";
import { updateTag } from "next/cache";
import type { MonthHistory } from "../model";

export async function loadVisitorMonth(month: unknown, refresh = false): Promise<{ data: MonthHistory } | { error: string }> {
  if (typeof month !== "string" || !isValidYm(month) || month < "2000-01" || month > `${kstToday().slice(0, 4)}-12`)
    return { error: "조회할 연월을 확인해 주세요." };
  const user = await visitorAccess();
  if (!user) return { error: "방문 기록을 조회할 권한 또는 캘린더 연결을 확인해 주세요." };
  try {
    if (refresh === true) updateTag(visitorMonthTag(user.tenantId, month));
    return { data: await cachedVisitorMonth(user.tenantId, month) };
  } catch { return { error: "기록을 읽지 못했습니다. 잠시 후 다시 조회해 주세요." }; }
}
