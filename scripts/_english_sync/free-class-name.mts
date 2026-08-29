/**
 * **폐지된 반이 붙들고 있는 이름 비우기** — 레벨 사다리가 이름을 재활용할 때 길을 터 준다.
 *
 * 배경(2026-08-29 적대 점검에서 발견): 반 이름 유니크 인덱스
 * `classes_tenant_name_subject_idx (tenant_id, class_name, subject)`엔 **`WHERE is_active`가 없다.**
 * 그래서 지난 학기에 종강한 반이 쥔 이름으로는 개명이 **23505로 거절**된다. 9/1 예약 시뮬레이션에서
 * `PJ1 → PJ2`·`KW2 → KW3`가 바로 이 이유로 실패했고, cron은 실패해도 '적용함' 표식을 남겨
 * **다시 시도하지 않는다** → 그 두 반만 영구히 옛 이름으로 남는다.
 *
 * 🔴 **반을 지우지 않는다.** 반 id가 수강·성적·출결·보고서의 키라, 이름만 바꾸면 과거 기록은 전부
 *    그대로 붙어 있다(컷오버가 신설 대신 개명을 쓰는 것과 같은 이유). 되돌리기 = 이름을 되돌리면 끝.
 * 🔴 **활성 반은 절대 건드리지 않는다** — 이 스크립트의 대상은 폐지(is_active=false)된 반뿐이다.
 *
 * ⚠️ 기본 dry-run. `--apply`에서만 쓴다.
 *
 * 실행:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs \
 *     scripts/_english_sync/free-class-name.mts --names="PJ2,KW3" [--suffix="(~{종강월})"] [--apply]
 */
import postgres from "postgres";

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const SUBJECT = "english";
const ACTOR = "fcf735fa-edf7-4095-8fa6-724285a018ed"; // 박소선(master)
const ACTOR_LABEL = "이름 비우기(스크립트)";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const names = (args.find((a) => a.startsWith("--names="))?.split("=")[1] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
/** `{종강월}` = closed_at의 `YYYY-MM`. 기본 관례가 없어 여기서 정한다(원장이 바꿔 줄 수 있게 인자). */
const SUFFIX = args.find((a) => a.startsWith("--suffix="))?.split("=")[1] ?? "(~{종강월})";

if (names.length === 0) {
  console.error('--names="PJ2,KW3" 처럼 비울 이름을 주세요.');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });

console.log(`폐지 반 이름 비우기 ${APPLY ? "【적용】" : "(dry-run)"}\n`);
let blocked = false;
const plan: { id: string; from: string; to: string }[] = [];

for (const name of names) {
  const rows = await sql<{ id: string; is_active: boolean; closed_at: string | null }[]>`
    select id, is_active, closed_at::text from classes
     where tenant_id = ${TENANT} and subject = ${SUBJECT} and class_name = ${name}`;
  if (rows.length === 0) {
    console.log(`  ⏭ "${name}" — 그 이름의 ${SUBJECT} 반이 없습니다(이미 비었음)`);
    continue;
  }
  // 🔴 활성 반이 그 이름을 쓰고 있으면 손대지 않는다 — 이 스크립트는 폐지 반만 다룬다.
  const active = rows.filter((r) => r.is_active);
  if (active.length > 0) {
    console.error(`  ❌ "${name}" — 활성 반이 쓰고 있습니다(id ${active[0]!.id.slice(0, 8)}). 건드리지 않습니다.`);
    blocked = true;
    continue;
  }
  if (rows.length > 1) {
    console.error(`  ❌ "${name}" — 폐지 반이 ${rows.length}개입니다. 어느 것인지 사람이 정해야 합니다.`);
    blocked = true;
    continue;
  }
  const c = rows[0]!;
  const month = (c.closed_at ?? "").slice(0, 7);
  const to = `${name} ${SUFFIX.replace("{종강월}", month || "종강")}`.trim();

  // 새 이름도 비어 있어야 한다(유니크 인덱스는 폐지 반도 센다 — 그게 애초의 원인이다).
  const [taken] = await sql<{ id: string }[]>`
    select id from classes where tenant_id = ${TENANT} and subject = ${SUBJECT} and class_name = ${to}`;
  if (taken) {
    console.error(`  ❌ "${to}" 도 이미 쓰이고 있습니다. --suffix 로 다른 접미사를 주세요.`);
    blocked = true;
    continue;
  }

  const [e] = await sql<{ n: number }[]>`select count(*)::int n from enrollments where class_id = ${c.id}`;
  const [a] = await sql<{ n: number }[]>`select count(*)::int n from attendance_records where class_id = ${c.id}`;
  console.log(
    `  "${name}" → "${to}"   (폐지 · 종강 ${c.closed_at ?? "-"} · 수강이력 ${e!.n} · 출결 ${a!.n} — 전부 반 id에 붙어 있어 그대로 보존)`,
  );
  plan.push({ id: c.id, from: name, to });
}

if (blocked) {
  console.error("\n중단 — 위 문제를 먼저 해결하세요(아무것도 쓰지 않았습니다).");
  await sql.end();
  process.exit(1);
}
if (!APPLY) {
  console.log(`\n(dry-run — 쓰기 없음. 실제 반영은 --apply)`);
  await sql.end();
  process.exit(0);
}

for (const p of plan) {
  await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      update classes set class_name = ${p.to}
       where id = ${p.id} and tenant_id = ${TENANT} and class_name = ${p.from} and is_active = false
      returning id`;
    if (!row) throw new Error(`"${p.from}" 갱신이 0건입니다(그 사이 바뀜)`);
    // 반 이름은 시간 축이 없어 이력이 남는 자리가 감사로그뿐이다 — 화면 `class_update` 렌더와 같은 모양.
    await tx`insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
      values (${TENANT}, ${ACTOR}, ${ACTOR_LABEL}, 'class_update', 'class', ${p.to},
              ${sql.json({
                classId: p.id,
                changed: ["반 이름"],
                changes: [{ field: "반 이름", from: p.from, to: p.to }],
                note: "폐지 반이 쥔 이름을 비움 — 레벨 사다리 재활용(유니크 인덱스에 is_active 조건 없음)",
              } as never)}::jsonb)`;
  });
  console.log(`  ✓ ${p.from} → ${p.to}`);
}
console.log(`\n비운 이름 ${plan.length}개 — 이제 그 이름으로 개명할 수 있습니다.`);
await sql.end();
