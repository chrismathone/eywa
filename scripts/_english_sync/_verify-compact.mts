// 검증(재현 가능·읽기 전용): 실 프로덕션 영어 슬롯 → buildRichCardGroups(compact) 그룹별 교시행 before/after.
// 통합뷰 '1시간 단위' 의미론(체계별 그룹 분리 + 사이 빈 교시 숨김·위아래 패딩 유지) 확인용.
// 실행: node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/_english_sync/_verify-compact.mts
import postgres from "postgres";
import { buildRichCardGroups, type GridSlot } from "../../src/features/timetable/lib/class-grid";
import { DEFAULT_PERIODS_CONFIG } from "../../src/features/timetable/lib/periods";

const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });

const rows = await sql`
  select cs.class_id, c.class_name, cs.day_of_week, cs.start_time, cs.end_time,
         cs.slot_teacher_label, cs.slot_room_label
  from class_schedules cs
  join classes c on c.id = cs.class_id and c.is_active and (c.closed_at is null or c.closed_at >= current_date)
  where c.subject = 'english'
    and cs.valid_from <= current_date and (cs.valid_to is null or cs.valid_to >= current_date)
`;

const slots: GridSlot[] = rows.map((r) => ({
  classId: r.class_id,
  className: r.class_name,
  subject: "english",
  dayOfWeek: r.day_of_week,
  startTime: String(r.start_time).slice(0, 5),
  endTime: String(r.end_time).slice(0, 5),
  teacherName: null,
  classroomName: null,
  slotTeacherLabel: r.slot_teacher_label,
  slotRoomLabel: r.slot_room_label,
  classBgColor: null,
  classTextColor: null,
  students: [],
}));

const before = buildRichCardGroups(slots, DEFAULT_PERIODS_CONFIG, false);
const after = buildRichCardGroups(slots, DEFAULT_PERIODS_CONFIG, true);
const fmt = (g: (typeof before)[number]) => g.periodRows.map((p) => p.label.replace("교시", "")).join(",");

console.log(`영어 활성 슬롯 ${slots.length}건 → 기본 ${before.length}그룹 / 1시간단위 ${after.length}그룹\n`);
console.log("=== 기본 ===");
for (const g of before) console.log(`${g.label.padEnd(12)} (${g.cards.length}반)  [${fmt(g)}]`);
console.log("\n=== 1시간 단위 ===");
for (const g of after)
  console.log(
    `${g.label.padEnd(12)} (${g.cards.length}반)  [${fmt(g)}]  반: ${g.cards.map((c) => c.className).slice(0, 8).join("·")}${g.cards.length > 8 ? "…" : ""}`,
  );
await sql.end();
