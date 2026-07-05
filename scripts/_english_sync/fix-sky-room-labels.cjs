// SKY 라벨 방 → 시트 실방 재배선 (2026-07-06 전격비교 픽스).
// 시트에서 SKY 반들은 실제 방(301/303)에 있고, JJ LAB 블록은 305 — '본원SKY'는 원 임포트의
// 라벨-only 결정이었으나 시트와 표시가 달라 실방(slot_room_label + classroom_id)으로 정정.
// 매핑(강사 라벨 기준): Jane→본원301 · Elsa/Dom/Florence→본원303 · JJ→본원305.
// 사용: node --env-file=.env.local scripts/_english_sync/fix-sky-room-labels.cjs [--apply]
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const APPLY = process.argv.includes("--apply");
const ART_DIR = process.env.ENGLISH_SYNC_ART_DIR || path.join(__dirname, "_artifacts");
const EXPECT = 15; // 사전 정찰(2026-07-06) 기준 본원SKY 슬롯 수 — 다르면 중단(재실행 0건은 허용)

const ROOM_BY_TEACHER = {
  Jane: "본원301",
  Elsa: "본원303",
  Dom: "본원303",
  Florence: "본원303",
  JJ: "본원305",
};

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
  try {
    const slots = await sql`
      select cs.id, cs.day_of_week, cs.start_time, cs.slot_teacher_label, cs.slot_room_label,
             cs.classroom_id, c.class_name
      from class_schedules cs
      join classes c on c.id = cs.class_id
      where c.tenant_id = ${TENANT} and c.subject = 'english'
        and cs.slot_room_label = '본원SKY'
        and cs.valid_to is null -- 현행 스케줄만. 마감(7/2)된 옛 슬롯 5건은 타임머신 이력 보존 위해 불변
      order by cs.slot_teacher_label, cs.day_of_week, cs.start_time`;

    if (slots.length === 0) {
      console.log("본원SKY 슬롯 0건 — 이미 적용됨(멱등).");
      return;
    }
    if (slots.length !== EXPECT) throw new Error(`본원SKY ${EXPECT}건 기대, 실제 ${slots.length} — 중단(재정찰 필요)`);

    const rooms = await sql`
      select id, name from classrooms
      where tenant_id = ${TENANT} and name in ('본원301', '본원303', '본원305')`;
    const roomId = new Map(rooms.map((r) => [r.name, r.id]));
    for (const name of new Set(Object.values(ROOM_BY_TEACHER))) {
      if (!roomId.has(name)) throw new Error(`강의실 ${name} 미존재 — 중단`);
    }

    const plan = slots.map((s) => {
      const room = ROOM_BY_TEACHER[s.slot_teacher_label];
      if (!room) throw new Error(`매핑 없는 강사 라벨: ${s.slot_teacher_label} — 중단`);
      return { id: s.id, teacher: s.slot_teacher_label, day: s.day_of_week, start: s.start_time, cls: s.class_name, room, room_id: roomId.get(room) };
    });
    for (const p of plan) console.log(`${p.teacher} ${p.day} ${p.start} ${p.cls} → ${p.room}`);

    if (!APPLY) {
      console.log(`[dry-run] ${plan.length}건 UPDATE 예정 — --apply로 실행`);
      return;
    }

    fs.mkdirSync(ART_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(ART_DIR, "SKYROOM_UNDO_2026-07-06.json"),
      JSON.stringify({ note: "복원 = 각 id에 slot_room_label='본원SKY', classroom_id=null", before: slots, plan }, null, 1),
    );

    await sql.begin(async (tx) => {
      for (const p of plan) {
        await tx`update class_schedules set slot_room_label = ${p.room}, classroom_id = ${p.room_id} where id = ${p.id}`;
      }
    });
    const remain = await sql`
      select count(*)::int as n from class_schedules cs
      join classes c on c.id = cs.class_id
      where c.tenant_id = ${TENANT} and c.subject = 'english' and cs.slot_room_label = '본원SKY'`;
    console.log(`적용 완료 ${plan.length}건 · 잔존 본원SKY ${remain[0].n}건 (undo → _artifacts/SKYROOM_UNDO_2026-07-06.json)`);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
