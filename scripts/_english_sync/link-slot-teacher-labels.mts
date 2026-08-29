/**
 * **라벨만 있고 계정에 안 붙은 교시 담당을 이어 붙인다** — 시트의 강사 라벨(`Song`·`Anna`…)이
 * eywa 직원 계정으로 해석되지 않아 `class_schedules.teacher_id`가 비어 있는 행을 메운다.
 *
 * 왜 생기나: 라벨→계정 매칭은 **가져오기 시점**에 일어난다. 그때 그 사람의 영어 닉네임
 * (`users.english_name`)이 안 적혀 있었으면 라벨만 남고 계정엔 안 붙는다. 나중에 닉네임을 등록해도
 * **이미 저장된 행엔 소급되지 않는다** — 그 소급을 이 스크립트가 한다.
 *
 * 실제 사고(2026-08-29): 9/1 배치에 `Song` 라벨 29칸이 들어왔는데 송지혜의 영어 닉네임이 비어 있어
 * 전부 미연결 → **9/1부터 송지혜의 ECS·강사뷰가 통째로 빈다**(16개 반에 들어가는데 한 반도 안 뜸 — 실측 정정).
 *
 * 🔴 판정은 가져오기와 **같은 함수**(`resolveTeacher`)를 쓴다 — 여기서 규칙을 새로 쓰면 다음 가져오기가
 *    다시 풀어 버리는 값을 만들게 된다. 특수 자리(`LAB`·`JJ`)는 그 함수가 사람으로 해석하지 않는다.
 * 🔴 **지난 행은 건드리지 않는다**(`valid_to < 오늘` 제외) — 출결 귀속(`resolveTaughtBy`)이 그 행을 읽으므로
 *    과거를 소급해 바꾸면 이미 찍힌 기록의 귀속이 조용히 달라진다.
 * ⚠️ 모호(동명이인 등)하면 건너뛴다 — 남의 시간표에 슬롯이 붙는 것보다 라벨-only가 낫다.
 *
 * 실행: node --env-file=.env.local node_modules/tsx/dist/cli.mjs \
 *         scripts/_english_sync/link-slot-teacher-labels.mts [--subject=english] [--apply]
 */
import postgres from "postgres";
import { resolveTeacher } from "../../src/features/timetable/import/structure/match";
import type { ExistingTeacherRef } from "../../src/features/timetable/import/structure/types";

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const SUBJECT = (args.find((a) => a.startsWith("--subject="))?.slice("--subject=".length) ?? "english").trim();

/**
 * **직책 라벨은 정본이 푼다** — 2026-08-29부터 `canonicalSlotTeacherLabel`이 `부원장 → Yoojin`으로
 * 굳히므로(teacher-label.ts `TITLE_LABEL_ALIASES`), 여기 따로 표를 두지 않는다.
 * 🔴 두 벌로 두면 가져오기와 이 소급 도구가 갈려서, 고친 다음 가져오기에 도로 풀린다.
 */

const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });

const staff = await sql<{ id: string; display_name: string; english_name: string | null; system_role: string }[]>`
  select id, display_name, english_name, system_role from users
   where tenant_id = ${TENANT} and status = 'active'`;
const teachers: ExistingTeacherRef[] = staff.map((u) => ({
  id: u.id,
  englishName: u.english_name,
  displayName: u.display_name,
  systemRole: u.system_role,
}));
const nameById = new Map(staff.map((u) => [u.id, u.display_name]));

// 라벨만 있고 계정에 안 붙은 **살아 있는** 행.
const rows = await sql<{ id: string; label: string; class_name: string; day_of_week: string; t: string; vf: string; vt: string | null }[]>`
  select s.id, s.slot_teacher_label as label, c.class_name, s.day_of_week,
         s.start_time::text as t, s.valid_from::text as vf, s.valid_to::text as vt
    from class_schedules s join classes c on c.id = s.class_id
   where c.tenant_id = ${TENANT} and c.subject = ${SUBJECT} and c.is_active
     and s.teacher_id is null and coalesce(s.slot_teacher_label, '') <> ''
     and (s.valid_to is null or s.valid_to >= current_date)
   order by s.slot_teacher_label, c.class_name, s.day_of_week, s.start_time`;

type Plan = { ids: string[]; teacherId: string; teacherName: string };
const plans = new Map<string, Plan>();
const skipped = new Map<string, number>();
for (const r of rows) {
  const { ref } = resolveTeacher(r.label, teachers);
  if (!ref) {
    skipped.set(r.label, (skipped.get(r.label) ?? 0) + 1);
    continue;
  }
  const p = plans.get(r.label) ?? { ids: [], teacherId: ref.id, teacherName: nameById.get(ref.id) ?? "?" };
  p.ids.push(r.id);
  plans.set(r.label, p);
}

console.log(`과목 ${SUBJECT} · 라벨만 있는 살아 있는 칸 ${rows.length}개  ${APPLY ? "【적용】" : "(dry-run)"}\n`);
console.log("이어 붙일 것:");
for (const [label, p] of plans) console.log(`  ${label.padEnd(12)} → ${p.teacherName.padEnd(10)} ${p.ids.length}칸`);
if (skipped.size) {
  console.log("\n건너뜀(사람으로 해석 안 됨 — 자리 라벨이거나 모호):");
  for (const [label, n] of skipped) console.log(`  ${label.padEnd(12)} ${n}칸`);
}
const total = [...plans.values()].reduce((a, p) => a + p.ids.length, 0);
console.log(`\n합계 ${total}칸`);

if (!APPLY) {
  console.log("\n(dry-run — 쓰기 없음. 실제 반영은 --apply)");
  await sql.end();
  process.exit(0);
}
let done = 0;
for (const [, p] of plans) {
  // ⚠️ teacher_id가 아직 비어 있을 때만 — 그 사이 사람이 지정했으면 그 판단이 최신이다.
  const res = await sql`
    update class_schedules set teacher_id = ${p.teacherId}
     where id = any(${p.ids}) and tenant_id = ${TENANT} and teacher_id is null`;
  done += res.count;
}
console.log(`\n✅ ${done}칸 연결 완료`);
await sql.end();
