import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { shiftMonth } from "@/lib/month-grid";
import { kstToday } from "@/lib/date-kst";
import type { MonthBoarding, MonthException, MonthRegular } from "../parent-month";
import { buildStaffMonth, type StaffMonth, type StaffMonthStudentInput } from "../staff-month";
import { stopLabels } from "./parent-month-data";
import { isBoardingStatus, isDirection, type DayCode } from "../../types";

/**
 * 직원 '학부모 등하원 → 월별' 재료 — **학원 전체 · 한 달**(사용자 2026-10-16).
 * 학부모 월별(`loadParentMonth`, 아이 한 명)과 같은 표 셋(정기 배정 · 그 달 변경 · 그 달 탑승 기록)을 학원 단위로 한 번에 읽는다.
 *
 * 🔒 호출부(페이지)가 셔틀 열람 게이트(`requireShuttleView`)를 먼저 통과한다. admin이라 tenant 필터 필수([[#104]]).
 * 🔑 대상 = 정기 배정이 있거나 그 달에 변경·탑승 기록이 있는 아이.
 * ⚡ 독립 조회는 함께(B4) — 왕복 1번 + 이름·자리 글자 함께 1~2번.
 * 🔑 평소 자리·바뀐 자리 글자(`stopLabels`)를 붙여 둔다 — 날짜·칸을 누르면 뜨는 상세 모달이 서버를 다시 부르지 않게.
 * 실패하면 빈 표로 접고 계측만 남긴다.
 */
export async function loadStaffMonth(tenantId: string, month: string): Promise<StaffMonth & { ok: boolean }> {
  try {
    return { ...(await load(tenantId, month)), ok: true };
  } catch (e) {
    reportError(e, { scope: "shuttle.staffMonth", month });
    return { days: [], rows: [], ok: false };
  }
}

/** 마지막으로 바꾼 사람(0321a `actor_kind`·`actor_name`) → "학부모 김민지" · "직원 이수진" · "자동". */
function actorLabel(kind: string | null, name: string | null): string | null {
  const who = kind === "parent" ? "학부모" : kind === "system" ? "자동" : kind === "staff" ? "직원" : null;
  if (!who) return null;
  return [who, kind === "system" ? null : name?.trim()].filter(Boolean).join(" ");
}

async function load(tenantId: string, month: string): Promise<StaffMonth> {
  const admin = createAdminClient();
  const from = `${month}-01`;
  const until = `${shiftMonth(month, 1)}-01`;

  const [ridersRes, exceptionsRes, boardingsRes, settings] = await Promise.all([
    admin.from("shuttle_riders").select("student_id, io_kind, weekdays, run_stop_id").eq("tenant_id", tenantId).limit(3000),
    admin.from("shuttle_ride_exceptions").select("student_id, on_date, io_kind, kind, run_stop_id, memo, actor_kind, actor_name")
      .eq("tenant_id", tenantId).gte("on_date", from).lt("on_date", until).limit(5000),
    admin.from("shuttle_boardings").select("student_id, boarded_on, io_kind, status")
      .eq("tenant_id", tenantId).gte("boarded_on", from).lt("boarded_on", until).limit(10000),
    getTenantSettingsByTenantId(tenantId),
  ]);
  for (const res of [ridersRes, exceptionsRes, boardingsRes]) if (res.error) throw res.error;

  const per = new Map<string, { regular: MonthRegular[]; exceptions: MonthException[]; boardings: MonthBoarding[] }>();
  const slot = (id: string) => {
    let s = per.get(id);
    if (!s) per.set(id, (s = { regular: [], exceptions: [], boardings: [] }));
    return s;
  };
  for (const r of ridersRes.data ?? []) {
    if (!r.student_id || !isDirection(r.io_kind)) continue;
    slot(String(r.student_id)).regular.push({ direction: r.io_kind, weekdays: (r.weekdays ?? []) as DayCode[], runStopId: String(r.run_stop_id) });
  }
  for (const e of exceptionsRes.data ?? []) {
    if (!e.student_id || !isDirection(e.io_kind) || (e.kind !== "add" && e.kind !== "skip")) continue;
    slot(String(e.student_id)).exceptions.push({
      onDate: String(e.on_date).slice(0, 10),
      direction: e.io_kind,
      kind: e.kind,
      runStopId: (e.run_stop_id as string | null) ?? null,
      memo: (e.memo as string | null) ?? null,
      actor: actorLabel(e.actor_kind as string | null, e.actor_name as string | null),
    });
  }
  for (const b of boardingsRes.data ?? []) {
    if (!b.student_id || !isDirection(b.io_kind) || !isBoardingStatus(b.status)) continue;
    slot(String(b.student_id)).boardings.push({ date: String(b.boarded_on).slice(0, 10), direction: b.io_kind, status: b.status as MonthBoarding["status"] });
  }

  const ids = [...per.keys()];
  const names = new Map<string, { name: string; schoolGrade: string }>();
  const readNames = async () => {
    for (let i = 0; i < ids.length; i += 300) {
      const { data, error } = await admin.from("students").select("id, name, school, grade").eq("tenant_id", tenantId).in("id", ids.slice(i, i + 300));
      if (error) throw error;
      for (const s of data ?? []) names.set(String(s.id), { name: s.name ?? "", schoolGrade: schoolGradeLabel(s.school, s.grade) });
    }
  };
  const slots = [...per.values()];
  const runStopIds = slots.flatMap((s) => [
    ...s.regular.map((r) => r.runStopId),
    ...s.exceptions.flatMap((e) => (e.kind === "add" && e.runStopId ? [e.runStopId] : [])),
  ]);
  const [labels] = await Promise.all([stopLabels(admin, tenantId, runStopIds), readNames()]);
  for (const s of slots) {
    for (const r of s.regular) r.label = labels.get(r.runStopId) ?? null;
    for (const e of s.exceptions) e.label = e.runStopId ? labels.get(e.runStopId) ?? null : null;
  }

  const students: StaffMonthStudentInput[] = ids.map((id) => ({
    id,
    ...(names.get(id) ?? { name: "(이름 모름)", schoolGrade: "" }),
    ...per.get(id)!,
  }));
  return buildStaffMonth({ month, today: kstToday(), holidays: buildHolidayMap(settings.operations.holidays), students });
}
