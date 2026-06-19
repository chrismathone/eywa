// 일회성 마이그레이션: 과목 키 highmath → subject_1 (통일성 — 수학(심화)를 학원 고유 과목 subject_N 계열로).
// 대상: ijw-demo 테넌트. ① tenant_settings.data.operations.subjects 의 key 교체 ② subject 컬럼 6개 테이블 일괄 교체.
// 사용: node scripts/_poc_migration/migrate-highmath-to-subject1.cjs           (dry-run, 쓰기 없음)
//       node scripts/_poc_migration/migrate-highmath-to-subject1.cjs --apply   (실제 UPDATE)
const fs = require("fs");
const postgres = require("postgres");

const APPLY = process.argv.includes("--apply");
const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094"; // ijw-demo
const OLD = "highmath";
const NEW = "subject_1";
const TABLES = ["classes", "student_grades", "exams", "level_tests", "student_consultations", "textbook_catalog"];

let url = process.env.DATABASE_URL;
if (!url) {
  const e = fs.readFileSync("D:/eywa_refactoring/.env.local", "utf8");
  url = e.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))?.slice(13).trim().replace(/^["']|["']$/g, "");
}
if (!url) throw new Error("DATABASE_URL not found");

const sql = postgres(url, { prepare: false });

(async () => {
  console.log(`[${APPLY ? "APPLY" : "DRY-RUN"}] highmath → subject_1  (tenant ${TENANT})\n`);

  // 0) 충돌 점검 — 이미 subject_1 을 쓰는 행/설정이 있으면 중단(서로 다른 과목 병합 방지)
  let collision = 0;
  for (const t of TABLES) {
    const [{ n }] = await sql`select count(*)::int n from ${sql(t)} where tenant_id = ${TENANT} and subject = ${NEW}`;
    if (n > 0) { console.log(`  ⚠️ ${t}: 이미 ${NEW} ${n}행 존재`); collision += n; }
  }

  // 1) tenant_settings.data.operations.subjects 점검/교체
  const [row] = await sql`select data from tenant_settings where tenant_id = ${TENANT}`;
  let settingsAction = "변경 없음(저장된 subjects 없음 — 기본값 사용)";
  let newData = null;
  if (row?.data?.operations?.subjects) {
    const subs = row.data.operations.subjects;
    const hasOld = subs.some((s) => s.key === OLD);
    const hasNew = subs.some((s) => s.key === NEW);
    if (hasNew) { settingsAction = `⚠️ 설정에 이미 ${NEW} 존재 — 교체 중단`; collision += 1; }
    else if (hasOld) {
      newData = { ...row.data, operations: { ...row.data.operations, subjects: subs.map((s) => (s.key === OLD ? { ...s, key: NEW } : s)) } };
      settingsAction = `subjects: ${OLD} → ${NEW} (라벨 "${subs.find((s) => s.key === OLD).label}" 유지)`;
    } else settingsAction = `저장된 subjects에 ${OLD} 없음`;
  }
  console.log(`  tenant_settings: ${settingsAction}`);

  // 2) 테이블별 highmath 행 수 (subject 스칼라 컬럼)
  console.log("\n  영향 행 수 (subject = highmath):");
  const counts = {};
  for (const t of TABLES) {
    const [{ n }] = await sql`select count(*)::int n from ${sql(t)} where tenant_id = ${TENANT} and subject = ${OLD}`;
    counts[t] = n;
    console.log(`    ${t.padEnd(22)} ${n}`);
  }
  // users.subjects 는 text[] 배열(강사 담당 과목) — array_replace로 따로 처리.
  const [{ n: usersN }] = await sql`select count(*)::int n from users where tenant_id = ${TENANT} and ${OLD} = any(subjects)`;
  console.log(`    ${"users.subjects[]".padEnd(22)} ${usersN}`);
  const [{ n: usersNewN }] = await sql`select count(*)::int n from users where tenant_id = ${TENANT} and ${NEW} = any(subjects)`;
  if (usersNewN > 0) { console.log(`    ⚠️ users.subjects: 이미 ${NEW} ${usersNewN}행`); collision += usersNewN; }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) + usersN;
  console.log(`    ${"합계".padEnd(22)} ${total}`);

  if (collision > 0) { console.log("\n  ❌ 충돌 발견 — 마이그레이션 중단. subject_1이 이미 쓰이고 있습니다."); await sql.end(); return; }

  if (!APPLY) { console.log("\n  (dry-run — 변경 없음. 적용하려면 --apply)"); await sql.end(); return; }

  // 3) 적용
  if (newData) await sql`update tenant_settings set data = ${sql.json(newData)}, updated_at = now() where tenant_id = ${TENANT}`;
  for (const t of TABLES) {
    if (counts[t] === 0) continue;
    await sql`update ${sql(t)} set subject = ${NEW} where tenant_id = ${TENANT} and subject = ${OLD}`;
  }
  if (usersN > 0) await sql`update users set subjects = array_replace(subjects, ${OLD}, ${NEW}) where tenant_id = ${TENANT} and ${OLD} = any(subjects)`;

  // 4) 검증
  console.log("\n  적용 후 잔여 highmath:");
  let left = 0;
  for (const t of TABLES) {
    const [{ n }] = await sql`select count(*)::int n from ${sql(t)} where tenant_id = ${TENANT} and subject = ${OLD}`;
    left += n;
    if (n > 0) console.log(`    ⚠️ ${t}: ${n}`);
  }
  const [{ n: leftUsers }] = await sql`select count(*)::int n from users where tenant_id = ${TENANT} and ${OLD} = any(subjects)`;
  left += leftUsers;
  if (leftUsers > 0) console.log(`    ⚠️ users.subjects: ${leftUsers}`);
  console.log(left === 0 ? "  ✅ 완료 — highmath 잔여 0" : `  ⚠️ 잔여 ${left}`);
  await sql.end();
})().catch((e) => { console.error(e); process.exit(1); });
