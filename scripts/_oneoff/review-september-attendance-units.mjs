import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL와 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");

const APPLY = process.argv.includes("--apply");
const FROM = "2026-09-01";
const TO = "2026-10-01";
const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: classes, error: classError } = await sb
  .from("classes")
  .select("id, subject, english_track")
  .eq("is_active", true);
if (classError) throw classError;

const tracks = new Map(
  (classes ?? [])
    .filter((c) => c.english_track === "eie" || c.english_track === "injaewon")
    .map((c) => [c.id, c.english_track]),
);
const classIds = [...tracks.keys()];
if (classIds.length === 0) {
  console.log("변환 대상 반이 없습니다.");
  process.exit(0);
}

const { data: schedules, error: scheduleError } = await sb
  .from("class_schedules")
  .select("class_id, day_of_week, start_time, end_time, valid_from, valid_to, slot_teacher_label")
  .in("class_id", classIds)
  .lte("valid_from", "2026-09-30")
  .or("valid_to.is.null,valid_to.gte.2026-09-01");
if (scheduleError) throw scheduleError;

async function fetchAllRecords() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("attendance_records")
      .select("id, class_id, student_id, session_date, slot_start, status, session_units")
      .in("class_id", classIds)
      .gte("session_date", FROM)
      .lt("session_date", TO)
      .order("session_date")
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}
const records = await fetchAllRecords();

const byClass = new Map();
for (const row of schedules ?? []) {
  const list = byClass.get(row.class_id) ?? [];
  list.push({
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    slotTeacherLabel: row.slot_teacher_label,
  });
  byClass.set(row.class_id, list);
}

function minutes(hhmmss) {
  const [h, m] = String(hhmmss ?? "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}
function dow(date) {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(`${date}T00:00:00Z`).getUTCDay()];
}
function activeSchedules(classId, date) {
  const rows = (byClass.get(classId) ?? []).filter((s) => {
    const a = s.validFrom <= date && (!s.validTo || s.validTo >= date) && s.dayOfWeek === dow(date);
    return a && !/^(LAB|JJ)\b/i.test(String(s.slotTeacherLabel ?? ""));
  });
  const seen = new Set();
  return rows.filter((s) => {
    const key = String(s.startTime).slice(0, 5);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function desired(classId, date) {
  const track = tracks.get(classId);
  const total = activeSchedules(classId, date).reduce((sum, s) => {
    const a = minutes(s.startTime);
    const b = minutes(s.endTime);
    return a == null || b == null || b <= a ? sum : sum + b - a;
  }, 0);
  if (!total) return null;
  const value = track === "eie" ? Math.round((total / 40) * 2) / 2 : Math.ceil(total / 60) / 2;
  return value === 1 ? null : Math.min(20, value);
}
function desiredSlot(classId, date, slotStart) {
  const row = activeSchedules(classId, date).find((s) => String(s.startTime).slice(0, 5) === String(slotStart).slice(0, 5));
  if (!row) return null;
  const a = minutes(row.startTime);
  const b = minutes(row.endTime);
  if (a == null || b == null || b <= a) return null;
  const value = tracks.get(classId) === "eie" ? Math.round(((b - a) / 40) * 2) / 2 : Math.ceil((b - a) / 60) / 2;
  return value === 1 ? null : Math.min(20, value);
}

const changes = [];
const skippedSlotRows = [];
for (const row of records ?? []) {
  if (!["present", "late", "early_leave", "makeup"].includes(row.status)) continue;
  const next = row.slot_start ? desiredSlot(row.class_id, row.session_date, row.slot_start) : desired(row.class_id, row.session_date);
  if (row.slot_start && next === null && !activeSchedules(row.class_id, row.session_date).some((s) => String(s.startTime).slice(0, 5) === String(row.slot_start).slice(0, 5))) {
    skippedSlotRows.push(row);
    continue;
  }
  const current = row.session_units ?? null;
  if (next !== current) changes.push({ id: row.id, classId: row.class_id, date: row.session_date, current, next });
}

console.log(JSON.stringify({ month: "2026-09", apply: APPLY, records: records?.length ?? 0, changes, skippedSlotRows: skippedSlotRows.length }, null, 2));
if (APPLY) {
  for (const change of changes) {
    const { error } = await sb.from("attendance_records").update({ session_units: change.next }).eq("id", change.id);
    if (error) throw error;
  }
  console.log(`변환 완료: ${changes.length}건`);
} else {
  console.log("검수만 수행했습니다. 실제 반영은 --apply를 붙여 실행하세요.");
}
