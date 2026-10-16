// 학부모 만족도 쓰기의 서버 확인 — 마감 · 담당(`satisfaction-actions.ts`가 부른다). 서버 액션 파일 밖에 둔다(동기·내부 도우미가 액션으로 열리지 않게 #119).
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday, shiftMonth } from "@/lib/date-kst";
import { openFloorMonths } from "./satisfaction-judge";

/** 지점의 재료 달 하한 — 그보다 앞선 달의 글·클레임은 마감한 점수 달의 재료다. */
export const floorOf = async (tenantId: string) =>
  (await openFloorMonths(createAdminClient(), tenantId)).get(tenantId) ?? shiftMonth(kstToday().slice(0, 7), -1);

/**
 * 클레임은 강사가 정해져 있다 — 그 날짜가 쓰이는 점수 달(다음 달 — 10월 점수 = 9월 기록)의 그 강사 줄이 마감됐는지(마감은 줄마다) ·
 * 계산 창 안인지(지점의 재료 달 하한)를 함께 본다.
 */
export async function claimMonthClosed(tenantId: string, teacherId: string, day: string): Promise<boolean> {
  if (day.slice(0, 7) < (await floorOf(tenantId))) return true;
  const { data } = await createAdminClient().from("teacher_portfolio_months").select("closed_at").eq("tenant_id", tenantId)
    .eq("teacher_id", teacherId).eq("month", shiftMonth(day.slice(0, 7), 1)).maybeSingle();
  return Boolean(data?.closed_at);
}

/**
 * 이 글이 이 강사 몫인지 — 그 글의 점수 달(올라온 달의 다음 달) 줄의 저장된 근거 표(`payload`의 만족도 `detail`)에 그 판정이 있어야 한다
 * (원장 2026-10-16 *"내 담당 아닌건 뜨지 않고 적용되지도 않게"*). 관리 창이 보이는 목록과 같은 원본이다(화면 목록만 거르면 우회된다 #77).
 * 근거를 받지 않고 jsonb 포함으로 그 줄 하나만 본다. 몫이 아니면 null, 몫이면 그 줄이 마감됐는지(마감은 담당 확인 뒤에 따로 알린다).
 */
export async function ownsJudgment(tenantId: string, teacherId: string, id: string, scoreMonth: string): Promise<{ closed: boolean } | null> {
  const { data, error } = await createAdminClient().from("teacher_portfolio_months").select("closed_at").eq("tenant_id", tenantId)
    .eq("teacher_id", teacherId).eq("month", scoreMonth)
    .contains("payload", { items: [{ id: "satisfaction", detail: [{ source: "글", key: id }] }] }).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { closed: Boolean(data.closed_at) } : null;
}
