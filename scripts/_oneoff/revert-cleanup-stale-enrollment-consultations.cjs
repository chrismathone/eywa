// 장기 미결 상담 정리(2026-10-23) 되돌리기 — backup.json의 옛 상태로 돌린다. 🔴 원장 승인 뒤에만.
// 정리 뒤 사람이 다시 고친 상담(지금 상태가 정리한 값과 다름)은 건드리지 않는다.
// 기본은 드라이런. 실제로 되돌리려면 --write.
// set -a; . D:/eywa_refactoring/.env.local; set +a; node scripts/_oneoff/revert-cleanup-stale-enrollment-consultations.cjs [--write]
// 옛 상태 원본(학생 이름이 들어 있어 저장소 밖) = STALE_CLEANUP_BACKUP 또는 아래 기본 경로.
const fs = require("fs");
const { createRequire } = require("module");
const req = createRequire("D:/eywa_refactoring/package.json");
const postgres = req("postgres");
const WRITE = process.argv.includes("--write");
const ACTOR = "자료 정리 되돌리기(장기 미결 상담 · 2026-10-23)";
const backup = JSON.parse(fs.readFileSync(process.env.STALE_CLEANUP_BACKUP ?? "D:/tmp/enrollment-stale-cleanup-2026-10-23/backup.json", "utf8"));
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });
(async () => {
  const [{ id: T }] = await sql`select id from tenants where slug = 'cs'`;
  const ids = backup.rows.map((r) => r.id);
  const now = new Map((await sql`select id, outcome::text outcome from enrollment_consultations where id = any(${ids}::uuid[])`).map((r) => [r.id, r.outcome]));
  const todo = backup.rows.filter((r) => now.get(r.id) === r.to);
  console.log("백업", backup.rows.length, "· 되돌릴 수 있음", todo.length, "· 그사이 바뀜(건너뜀)", backup.rows.length - todo.length);
  if (!WRITE) { await sql.end(); return; }
  let done = 0;
  await sql.begin(async (tx) => {
    for (const r of todo) {
      const res = await tx`update public.enrollment_consultations set outcome = ${r.from} where id = ${r.id} and tenant_id = ${T} and outcome::text = ${r.to}`;
      if (res.count !== 1) continue;
      await tx`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
        values (${T}, null, ${ACTOR}, 'enrollment_consultation_outcome', 'enrollment_consultations', ${r.name ?? "상담"},
          ${tx.json({ consultationId: r.id, from: r.to, to: r.from, via: "revert", category: r.category })})`;
      done++;
    }
  });
  console.log("되돌림", done);
  await sql.end();
})().catch(async (e) => { console.error("실패(되돌려짐):", e.message); await sql.end(); process.exit(1); });
