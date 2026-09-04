import "server-only";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { monthDay } from "@/features/timetable/scheduled-import";
import { shouldApplyName, type ClassUpdate } from "@/features/timetable/due-class-updates";
import { DEFAULT_SHEET_LANG, sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";

/** 반 자체에 예약된 변경 한 줄. `kind`로 문구가 갈린다(화면에서 문장을 새로 만들지 않는다). */
export type ScheduledClassChange = {
  kind: "teacher" | "classroom" | "name";
  effectiveDate: string;
  /** 지금 값(표시용). 해석 실패면 null — 그때는 "→ 새 값"만 보여 준다. */
  fromLabel: string | null;
  toLabel: string | null;
};

/**
 * 이 반에 **예약된 변경**(가져오기가 미뤄 둔 것) — 반 상세 배너용. 읽기 전용.
 *
 * 🔴 예전엔 `u.teacherId`가 있을 때만 배너를 띄웠다. 그런데 **이름만 바꾸는 항목은 `teacherId: null`**
 *    이라(컷오버 스크립트가 배치 변경이 없는 반에 그렇게 넣는다) 2026-09-01에 예약된 **반 이름 변경
 *    17건이 어디에도 안 떴다.** 그래서 세 종류를 다 본다(담임·강의실·이름).
 *
 * 이 예약은 `pending_teacher_*`를 쓰지 않는다 — 그 경로의 `applyHandover`가 슬롯 담당까지 옮겨서
 * 시트대로 넣어 둔 배치를 뭉갠다(0234a 주석). 그래서 **스냅샷에서 읽어** 보여 주기만 한다.
 *
 * ⚠️ 이 배너엔 '적용'·'취소'를 붙이지 않는다 — 적용은 기한 cron이, 취소는 시간표 툴바 배지의 ×가 한다
 *    (취소는 배치·반이동까지 **한 덩이**라 반 하나만 되돌리면 어긋난다).
 * ⚠️ 예약이 없으면 첫 쿼리 한 번으로 끝난다(보통 0행).
 */
export async function getScheduledClassChanges(
  classId: string,
  /** 지금 값들 — **아직 예약 시점 그대로일 때만** 배너를 띄운다(cron의 적용 조건과 같은 판정). */
  current: { teacherId: string | null; classroomId: string | null; className: string | null },
): Promise<ScheduledClassChange[]> {
  const today = kstToday();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timetable_snapshots")
    .select("id, reference_date, updates:payload->apply->classUpdates")
    .gt("reference_date", today)
    .order("reference_date");
  if (error || !data || data.length === 0) return [];

  const rows = data as unknown as {
    id: string;
    reference_date: string | null;
    updates: ClassUpdate[] | null;
  }[];

  // 되돌린 스냅샷 제외 — 취소한 예약을 배너에 남기면 "왜 안 바뀌지"가 된다.
  const { data: logs } = await supabase
    .from("timetable_import_logs")
    .select("snapshot_id")
    .in(
      "snapshot_id",
      rows.map((r) => r.id),
    )
    .not("restored_at", "is", null);
  const restored = new Set((logs ?? []).map((l) => (l as { snapshot_id: string }).snapshot_id));

  const out: ScheduledClassChange[] = [];
  const needTeacher = new Set<string>();
  const needRoom = new Set<string>();
  const raw: { date: string; u: ClassUpdate }[] = [];

  for (const r of rows) {
    if (!r.reference_date || restored.has(r.id)) continue;
    const date = String(r.reference_date).slice(0, 10);
    for (const u of Array.isArray(r.updates) ? r.updates : []) {
      if (u?.classId !== classId) continue;
      raw.push({ date, u });
      if (u.teacherId) needTeacher.add(u.teacherId);
      if (u.prevTeacherId) needTeacher.add(u.prevTeacherId);
      if (u.classroomId) needRoom.add(u.classroomId);
      if (u.prevClassroomId) needRoom.add(u.prevClassroomId);
    }
  }
  if (raw.length === 0) return [];

  // 이름 해석 — 독립 조회라 병렬(B4). 예약이 있는 반에서만 도는 소량 조회다.
  const [teacherRes, roomRes] = await Promise.all([
    needTeacher.size
      ? supabase.from("users").select("id, display_name").in("id", [...needTeacher])
      : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    needRoom.size
      ? supabase.from("classrooms").select("id, name").in("id", [...needRoom])
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const teacherName = new Map((teacherRes.data ?? []).map((t) => [t.id, t.display_name]));
  const roomName = new Map((roomRes.data ?? []).map((r) => [r.id, r.name]));

  for (const { date, u } of raw) {
    // ⚠️ 이미 반영됐거나 사람이 손댔으면 "예정"이 아니다 — cron의 적용 조건과 **같은 판정**을 쓴다.
    if (u.teacherId && current.teacherId === (u.prevTeacherId ?? null)) {
      out.push({
        kind: "teacher",
        effectiveDate: date,
        fromLabel: current.teacherId ? (teacherName.get(current.teacherId) ?? null) : null,
        toLabel: teacherName.get(u.teacherId) ?? null,
      });
    }
    if (u.classroomId && current.classroomId === (u.prevClassroomId ?? null)) {
      out.push({
        kind: "classroom",
        effectiveDate: date,
        fromLabel: current.classroomId ? (roomName.get(current.classroomId) ?? null) : null,
        toLabel: roomName.get(u.classroomId) ?? null,
      });
    }
    if (shouldApplyName(u, current.className)) {
      out.push({
        kind: "name",
        effectiveDate: date,
        fromLabel: u.prevClassName ?? current.className,
        toLabel: u.className ?? null,
      });
    }
  }
  return out;
}

/** 배너에 그대로 찍히는 한 줄. ⚠️ 영문 kind가 새지 않게 문장은 여기서만 만든다. */
export function scheduledClassChangeLabel(
  c: ScheduledClassChange,
  lang: SheetLang = DEFAULT_SHEET_LANG,
): string {
  const what = sheetT(
    lang,
    c.kind === "teacher"
      ? "cls.col.teacher"
      : c.kind === "classroom"
        ? "cls.col.room"
        : "cls.col.name",
  );
  const from = c.fromLabel ?? sheetT(lang, "cls.teacherNone");
  const to = c.toLabel ?? "—";
  return sheetTf(lang, "sched.classChange", {
    md: monthDay(c.effectiveDate),
    what,
    from,
    to,
  });
}
