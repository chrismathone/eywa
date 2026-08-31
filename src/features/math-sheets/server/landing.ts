import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { kstMonth, monthLabel, monthRange } from "@/lib/date-kst";
import { classDaysOf, normalizeMonth, type MathScheduleRow } from "../lib/class-days";
import { mcsVisibleClassFilter } from "./access";

/**
 * MCS 랜딩 — 그 달에 **수업이 있는 수학 반**만 세운다.
 *
 * 🔴 ECS 랜딩과 같은 규칙([[landing-week-scope]] 결정): 반을 먼저 세워 놓고 교시를 세면
 *    수업이 끝난 반이 `0/0` 카드로 남는다. 그 달에 도는 날이 0일이면 카드를 만들지 않는다.
 * ⚠️ 담임 이름은 표시용이다 — 권한 판정은 `mcsVisibleClassFilter`(게이트와 같은 두 갈래)가 한다.
 */
export type MathClassCard = {
  classId: string;
  className: string;
  teacherName: string | null;
  /** 그 달 수업일 수 — 카드의 유일한 숫자(작성률은 반을 열어야 알 수 있다). */
  dayCount: number;
  studentCount: number;
};

export type MathLandingEmptyReason = "no-classes" | "no-scoped-classes" | "no-month-classes";

export type MathLandingData = {
  month: string;
  monthLabel: string;
  cards: MathClassCard[];
  emptyReason: MathLandingEmptyReason | null;
  byTeacher: { teacherName: string; cards: MathClassCard[] }[];
};

type LandingSchedRow = {
  class_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string | null;
  valid_from: string | null;
  valid_to: string | null;
};
type LandingEnrRow = {
  class_id: string;
  student_id: string;
  start_date: string | null;
  end_date: string | null;
};

export type MathLandingResult = { ok: true; data: MathLandingData } | { ok: false; error: string };

export async function getMathSheetLanding(monthRaw: string | null): Promise<MathLandingResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const level = await accessLevelTenant(user.systemRole, "mcs");
  if (level === "none") return { ok: false, error: "접근 권한이 없습니다" };

  const month = normalizeMonth(monthRaw, kstMonth());
  const { from, to } = monthRange(month);
  const admin = createAdminClient();
  const tenantId = user.tenantId;

  const [classRes, filter] = await Promise.all([
    admin
      .from("classes")
      .select("id, class_name, teacher_id")
      .eq("tenant_id", tenantId)
      .eq("subject", "math")
      .eq("is_active", true)
      // 종강한 반은 그 달 시작 전에 닫혔으면 뺀다(ECS 랜딩과 같은 조건).
      .or(`closed_at.is.null,closed_at.gte.${from}`)
      .order("class_name"),
    mcsVisibleClassFilter(),
  ]);

  const all = classRes.data ?? [];
  if (all.length === 0) {
    return { ok: true, data: { month, monthLabel: monthLabel(month), cards: [], emptyReason: "no-classes", byTeacher: [] } };
  }

  const scoped = filter ? all.filter((c) => filter(String(c.id))) : all;
  if (scoped.length === 0) {
    return {
      ok: true,
      data: { month, monthLabel: monthLabel(month), cards: [], emptyReason: "no-scoped-classes", byTeacher: [] },
    };
  }

  const classIds = new Set(scoped.map((c) => String(c.id)));
  const teacherIds = [...new Set(scoped.map((c) => c.teacher_id).filter(Boolean))].map(String);

  const [schedRows, enrRows, teacherRows] = await Promise.all([
    fetchAllPaged<LandingSchedRow>((f, t) =>
      admin
        .from("class_schedules")
        .select("class_id, day_of_week, start_time, end_time, valid_from, valid_to")
        .eq("tenant_id", tenantId)
        .order("id")
        .range(f, t),
    ),
    fetchAllPaged<LandingEnrRow>((f, t) =>
      admin
        .from("enrollments")
        .select("class_id, student_id, start_date, end_date")
        .eq("tenant_id", tenantId)
        .order("id")
        .range(f, t),
    ),
    teacherIds.length
      ? admin.from("users").select("id, display_name").eq("tenant_id", tenantId).in("id", teacherIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
  ]);

  const teacherName = new Map(
    ((teacherRows.data ?? []) as { id: string; display_name: string | null }[]).map((t) => [
      String(t.id),
      t.display_name ?? null,
    ]),
  );

  const schedByClass = new Map<string, MathScheduleRow[]>();
  for (const r of schedRows) {
    const cid = String(r.class_id);
    if (!classIds.has(cid)) continue;
    const list = schedByClass.get(cid) ?? [];
    list.push({
      dayOfWeek: String(r.day_of_week),
      startTime: String(r.start_time),
      endTime: r.end_time ? String(r.end_time) : null,
      validFrom: r.valid_from ? String(r.valid_from).slice(0, 10) : null,
      validTo: r.valid_to ? String(r.valid_to).slice(0, 10) : null,
    });
    schedByClass.set(cid, list);
  }

  // 그 달 안에 한 번이라도 명단이었던 학생 수(카드의 인원). 달 전체가 지난 수강은 안 센다.
  const studentCount = new Map<string, number>();
  for (const e of enrRows) {
    const cid = String(e.class_id);
    if (!classIds.has(cid)) continue;
    const start = e.start_date ? String(e.start_date).slice(0, 10) : null;
    const end = e.end_date ? String(e.end_date).slice(0, 10) : null;
    if (start && start > to) continue;
    if (end && end < from) continue;
    studentCount.set(cid, (studentCount.get(cid) ?? 0) + 1);
  }

  const cards: MathClassCard[] = [];
  for (const c of scoped) {
    const cid = String(c.id);
    const days = classDaysOf(month, schedByClass.get(cid) ?? []);
    if (days.length === 0) continue; // 🔴 그 달에 안 도는 반은 카드를 만들지 않는다
    cards.push({
      classId: cid,
      className: String(c.class_name),
      teacherName: c.teacher_id ? (teacherName.get(String(c.teacher_id)) ?? null) : null,
      dayCount: days.length,
      studentCount: studentCount.get(cid) ?? 0,
    });
  }

  const byTeacherMap = new Map<string, MathClassCard[]>();
  for (const card of cards) {
    const key = card.teacherName ?? "담임 미지정";
    const list = byTeacherMap.get(key) ?? [];
    list.push(card);
    byTeacherMap.set(key, list);
  }
  const byTeacher = [...byTeacherMap.entries()]
    .map(([name, list]) => ({ teacherName: name, cards: list }))
    .sort((a, b) => a.teacherName.localeCompare(b.teacherName, "ko"));

  return {
    ok: true,
    data: {
      month,
      monthLabel: monthLabel(month),
      cards,
      emptyReason: cards.length === 0 ? "no-month-classes" : null,
      byTeacher,
    },
  };
}
