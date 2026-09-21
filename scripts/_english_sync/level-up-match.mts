/**
 * 영어 반 **레벨업 짝짓기** — `통합영어시간표(8월)` 명단 ↔ aywa 옛 반 수강생 **이름 겹침**으로 짝을 찾는다.
 *
 * 왜 이름 규칙으로 안 하나: 레벨 사다리가 트랙을 넘나든다(시트 머리글 = Phonics → Pre Let's → Ready To
 * Talk → Let's Talk → Ready to Speak → Let's Speak → Let's Express → **Kopi Wang → Pre Junior** →
 * Junior Plus → Senior Plus). `DP5→DP6`처럼 자명한 것도 있지만 `KW6→PJ1`은 트랙이 바뀌고 `RTT2→RTT4`는
 * 번호가 둘 뛴다. **추측하면 남의 반 이력이 엉뚱한 이름으로 바뀐다** → 사람 명단이 진실.
 *
 * 읽기 전용(쓰기 0). 실행:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/_english_sync/level-up-match.mts
 */
import postgres from "postgres";
import { google } from "googleapis";

const MASTER_ID = "1-1JHCw36iWPku782DXMhqYbEMBUFL7bElfJjSQekoWA";
const TAB = process.argv.find((a) => !a.startsWith("--") && a.includes("월")) ?? "통합영어시간표(8월)";
const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";

function creds(): { client_email: string; private_key: string } {
  let s = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "").trim();
  if (!s.startsWith("{")) s = Buffer.from(s, "base64").toString("utf-8");
  return JSON.parse(s);
}

// ── 시트 읽기 ────────────────────────────────────────────────────────────────
const c = creds();
const auth = new google.auth.JWT({ email: c.client_email, key: c.private_key, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
const sheets = google.sheets({ version: "v4", auth });
const res = await sheets.spreadsheets.get({
  spreadsheetId: MASTER_ID, ranges: [TAB], includeGridData: true,
  fields: "sheets(properties(title),merges,data(rowData(values(formattedValue))))",
});
const sh = res.data.sheets![0]!;
const cells = (sh.data![0]!.rowData ?? []).map((r) => (r.values ?? []).map((v) => v.formattedValue ?? ""));
const merges = (sh.merges ?? []).map((m) => ({ r1: m.startRowIndex!, r2: m.endRowIndex! - 1, c1: m.startColumnIndex!, c2: m.endColumnIndex! - 1 }));
const at = (r: number, cc: number) => (cells[r]?.[cc] ?? "").trim();

// ── 반 블록 헤더 = 가로 병합 셀 중 첫 줄이 반 이름꼴인 것 ─────────────────────
// ⚠️ 헤더는 `DP6⏎매일 2:20~3:40⏎(Anna)` 같은 **여러 줄 병합 셀**이라 완전일치 검색으론 안 잡힌다.
const CLASS_RE = /^([A-Z]{2,4}\d[\w-]*|중등E_.+|중고E_.+|고등E_.+)$/;
type Block = { name: string; r: number; c: number };
const blocks: Block[] = [];
for (const m of merges) {
  if (m.c2 <= m.c1) continue; // 가로 병합만(헤더)
  const first = at(m.r1, m.c1).split("\n")[0]!.trim();
  if (CLASS_RE.test(first)) blocks.push({ name: first, r: m.r1, c: m.c1 });
}
// 같은 반이 여러 섹션에 나오면 위쪽 하나만
const seen = new Set<string>();
const uniq = blocks.sort((a, b) => a.r - b.r || a.c - b.c).filter((b) => (seen.has(b.name) ? false : (seen.add(b.name), true)));
const headerRows = [...new Set(uniq.map((b) => b.r))].sort((a, b) => a - b);

// ── 명단 = 헤더 아래, **이름 칸 + 옆칸 학교학년**이 함께 있는 행 ───────────────
// 학생 행은 시트에서 항상 `이름(영문명) | 학교학년` 두 칸 쌍이다. 이 쌍 조건이 강사 닉네임·시각·인원수
// 같은 잡음을 한 번에 걷어낸다(단독 값은 학생이 아니다).
const SCHOOL_RE = /(초|중|고)\s*\d?$/;
const rosters = new Map<string, { name: string; school: string }[]>();
for (const b of uniq) {
  const nextHeaderRow = headerRows.find((r) => r > b.r) ?? cells.length;
  const list: { name: string; school: string }[] = [];
  for (let r = b.r + 1; r < nextHeaderRow; r++) {
    const nm = at(r, b.c);
    if (!nm) continue;
    // 학교 칸은 바로 옆 또는 그 옆(블록 폭 5칸 안에서 탐색)
    let school = "";
    for (let k = 1; k <= 4; k++) {
      const v = at(r, b.c + k);
      if (v && SCHOOL_RE.test(v)) { school = v; break; }
    }
    if (!school) continue; // 쌍이 아니면 학생이 아니다
    list.push({ name: nm.replace(/\(.*?\)/g, "").trim(), school });
  }
  rosters.set(b.name, list);
}

// ── aywa 옛 반 수강생 ────────────────────────────────────────────────────────
const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });
const rows = await sql<{ class_name: string; slots: number; student: string; school: string | null; grade: string | null }[]>`
  select c.class_name,
         (select count(*)::int from class_schedules s where s.class_id = c.id and s.valid_to is null) slots,
         s.name as student, s.school, s.grade
    from classes c
    join enrollments e on e.class_id = c.id and (e.end_date is null or e.end_date >= current_date)
    join students s on s.id = e.student_id
   where c.tenant_id = ${TENANT} and c.subject = 'english' and c.is_active
   order by c.class_name, s.name`;
await sql.end();

const aywa = new Map<string, { names: Set<string>; slots: number }>();
for (const r of rows) {
  const e = aywa.get(r.class_name) ?? { names: new Set<string>(), slots: r.slots };
  e.names.add(r.student.replace(/\s+/g, ""));
  aywa.set(r.class_name, e);
}

// ── 짝짓기 ───────────────────────────────────────────────────────────────────
const orphan = [...aywa.entries()].filter(([, v]) => v.slots === 0); // 슬롯 0 = 이번에 이름이 바뀐 반
const fresh = [...rosters.keys()].filter((n) => !aywa.has(n) || aywa.get(n)!.names.size === 0);

console.log(`시트 반 블록 ${uniq.length}개 · 명단 있는 반 ${[...rosters.values()].filter((l) => l.length).length}개`);
console.log(`aywa 슬롯 0인 반(=이름이 바뀐 후보) ${orphan.length}개 · 시트에만 있는 새 이름 ${fresh.length}개\n`);

const key = (s: string) => s.replace(/\s+/g, "");
console.log("옛 반 → 새 반 후보 (명단 겹침순)");
for (const [oldName, v] of orphan.sort((a, b) => a[0].localeCompare(b[0]))) {
  const scored = fresh
    .map((n) => {
      const sheetNames = new Set((rosters.get(n) ?? []).map((s) => key(s.name)));
      const hit = [...v.names].filter((x) => sheetNames.has(x));
      return { n, hit: hit.length, of: sheetNames.size, miss: [...v.names].filter((x) => !sheetNames.has(x)) };
    })
    .filter((x) => x.hit > 0)
    .sort((a, b) => b.hit - a.hit);
  const best = scored[0];
  const rest = scored.slice(1, 3).map((x) => `${x.n}(${x.hit})`).join(" ");
  if (!best) { console.log(`  ${oldName.padEnd(9)} (${v.names.size}명) → ❓ 겹치는 명단 없음`); continue; }
  const pct = Math.round((best.hit / v.names.size) * 100);
  const flag = pct === 100 && (!scored[1] || scored[1].hit < best.hit) ? "✅" : "⚠️";
  console.log(`  ${oldName.padEnd(9)} (${v.names.size}명) → ${flag} ${best.n} — 겹침 ${best.hit}/${v.names.size}명(${pct}%), 새 반 명단 ${best.of}명${rest ? ` · 경쟁 ${rest}` : ""}`);
  if (best.miss.length) console.log(`       빠진 학생: ${best.miss.join(" ")}`);
}
const claimed = new Set<string>();
for (const [, v] of orphan) {
  for (const n of fresh) if ((rosters.get(n) ?? []).some((s) => v.names.has(key(s.name)))) claimed.add(n);
}
console.log(`\n짝을 못 찾은 새 이름: ${fresh.filter((n) => !claimed.has(n)).join(" ") || "(없음)"}`);

// ── 학생별 추적 — "이 학생은 8월 시트 어느 반에 있나" ─────────────────────────
// 반 단위 겹침이 0이어도 학생이 사라진 건 아니다. 여러 반으로 흩어졌거나, 시트 이름 표기가 다르거나,
// 정말 나갔거나 — 셋을 구분해야 반명 변경이 아니라 **학생 이동**으로 처리할지 판단할 수 있다.
const whereIs = new Map<string, string[]>();
for (const [cls, list] of rosters) for (const s of list) {
  const k = key(s.name);
  whereIs.set(k, [...(whereIs.get(k) ?? []), cls]);
}
console.log("\n── 학생별 8월 시트 소속 (겹침이 낮은 반만) ──");
for (const [oldName, v] of orphan.sort((a, b) => a[0].localeCompare(b[0]))) {
  const found = [...v.names].map((n) => ({ n, at: whereIs.get(n) ?? [] }));
  const scattered = new Set(found.flatMap((f) => f.at));
  // 깔끔한 1:1이면서 **그 상대가 신설 반**일 때만 생략 — 기존 반으로 통째 흡수된 경우(합반)는 보여야 한다.
  if (scattered.size === 1 && found.every((f) => f.at.length) && fresh.includes([...scattered][0]!)) continue;
  console.log(`  ${oldName} (${v.names.size}명):`);
  for (const f of found) console.log(`     ${f.n.padEnd(6)} → ${f.at.length ? f.at.join(", ") : "❌ 8월 시트 어디에도 없음"}`);
}
