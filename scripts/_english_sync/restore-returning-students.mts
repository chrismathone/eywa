/**
 * **복학(퇴원 → 재원) 되돌리기** — 시트 명단에 있는데 DB는 퇴원인 학생을 사람이 확인한 뒤 되살린다.
 *
 * 배경(2026-08-29): 9월 컷오버의 명단 이동이 퇴원 학생 2명을 **적용하지 않고 목록으로 넘겼다**
 * (원장 방침: 학생 상태를 자동으로 바꾸는 경로는 만들지 않는다 — 강사 소급 퇴원 사고 이후).
 * 원장이 *"다시 학원에 다닌다고 했나봐"* 로 확인해 준 뒤에만 도는 것이 이 스크립트다.
 *
 * 🔴 **앱의 복구(`changeStudentStatus` target=enrolled)와 한 군데가 다르다 — 옛 수강을 되살리지 않는다.**
 *    앱은 "퇴원이 닫은 수강을 다시 연다"(재원인데 수강이 없어 시간표 '퇴원'에 뜨는 것을 막으려고).
 *    복학은 그 상황이 아니다 — 되살리면 **시작일이 옛 날짜 그대로**라 오늘부터 활성이 되고, 9월부터
 *    다니기로 한 학생이 8월 출석부·수강료에 잡힌다. 지난 기간은 기록으로 닫아 두고, 새 기간을
 *    `master-cutover --roster-only`가 적용일부터 새로 연다(그래야 예약 취소로도 함께 되돌아간다).
 *
 * ⚠️ 기본 dry-run. `--apply`에서만 쓴다. 되돌리기 = 학생 상세에서 다시 퇴원 처리.
 *
 * 실행:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs \
 *     scripts/_english_sync/restore-returning-students.mts --names="박인유,강태인" [--apply]
 */
import postgres from "postgres";

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
/** 감사로그 actor — 스크립트로 돈 것임을 `actor_name`이 말한다(사람이 누른 것처럼 위장하지 않는다). */
const ACTOR = "fcf735fa-edf7-4095-8fa6-724285a018ed"; // 박소선(master)
const ACTOR_LABEL = "복학 처리(스크립트)";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const names = (args.find((a) => a.startsWith("--names="))?.split("=")[1] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (names.length === 0) {
  console.error('--names="박인유,강태인" 처럼 복학할 학생 이름을 주세요.');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });

const rows = await sql<
  { id: string; name: string; school: string | null; grade: string | null; status: string }[]
>`select id, name, school, grade, status from students
   where tenant_id = ${TENANT} and name = any(${names}) order by name`;

// 🔴 이름이 유일하지 않으면 고르지 않는다 — 남의 아이를 되살린다.
const byName = new Map<string, typeof rows>();
for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r] as typeof rows);
let blocked = false;
for (const n of names) {
  const hits = byName.get(n) ?? [];
  if (hits.length === 0) {
    console.error(`❌ "${n}" — 그 이름의 학생이 없습니다.`);
    blocked = true;
  } else if (hits.length > 1) {
    console.error(
      `❌ "${n}" — 동명이인 ${hits.length}명입니다(${hits
        .map((h) => `${h.school ?? "?"}${h.grade ?? ""}/${h.status}`)
        .join(" · ")}). 이름만으로는 못 고릅니다.`,
    );
    blocked = true;
  }
}
if (blocked) {
  await sql.end();
  process.exit(1);
}

console.log(`복학 처리 ${APPLY ? "【적용】" : "(dry-run)"}\n`);
for (const s of rows) {
  if (s.status === "enrolled") {
    console.log(`  ⏭ ${s.name}(${s.school ?? "?"}${s.grade ?? ""}) — 이미 재원, 건너뜀`);
    continue;
  }
  const enr = await sql<{ cls: string; sd: string; ed: string | null }[]>`
    select c.class_name cls, e.start_date::text sd, e.end_date::text ed
      from enrollments e join classes c on c.id = e.class_id
     where e.student_id = ${s.id} order by e.start_date`;
  console.log(`  ${s.name}(${s.school ?? "?"}${s.grade ?? ""}) — ${s.status} → 재원`);
  console.log(
    `    지난 수강 ${enr.length}건은 **닫힌 채로 둡니다**(기록 보존): ` +
      (enr.map((e) => `${e.cls} ${e.sd}~${e.ed ?? "열림"}`).join(", ") || "없음"),
  );
  // ⚠️ 퇴원은 수강을 닫으므로 **열린 수강이 남아 있으면 이례적**이다. 앱 복구는 그런 수강의 on_hold를
  //    풀어 주는데 여기선 손대지 않으므로(복학은 새 기간을 새로 연다), 있으면 사람에게 알린다.
  const open = enr.filter((e) => e.ed === null);
  if (open.length)
    console.log(`    ⚠️ 열린 수강 ${open.length}건이 남아 있습니다 — 휴원 표식은 손대지 않았습니다: ${open.map((e) => e.cls).join(", ")}`);
  if (!APPLY) continue;

  await sql.begin(async (tx) => {
    const [upd] = await tx<{ id: string }[]>`
      update students set status = 'enrolled', withdrawn_at = null, withdrawal_metadata = null
       where id = ${s.id} and tenant_id = ${TENANT} returning id`;
    if (!upd) throw new Error(`${s.name} 상태 변경이 0건입니다`);
    // 학생 레코드를 바꾸는 경로는 감사로그 필수(원장 2026-08-18) — 앱과 같은 action 키.
    await tx`insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
      values (${TENANT}, ${ACTOR}, ${ACTOR_LABEL}, 'student_restore', 'student', ${s.name},
              ${sql.json({ studentId: s.id, note: "9월 명단 복학 — 지난 수강은 닫힌 채로 두고 새 기간을 적용일부터 연다" } as never)}::jsonb)`;
  });
  console.log(`    ✓ 재원으로 복구 + 감사로그`);
}

if (!APPLY) console.log("\n(dry-run — 쓰기 없음. 실제 반영은 --apply)");
else console.log("\n다음: master-cutover --roster-only 로 적용일부터의 수강을 연다.");
await sql.end();
