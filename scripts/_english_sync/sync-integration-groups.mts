/**
 * 통합뷰 **그룹(줄)** 을 `통합영어시간표(N월)` 탭 구조와 맞춘다(원장 2026-08-04 *"그룹 설정까지 시트와
 * 맞춰주면 좋겠어"*).
 *
 * 시트는 **시각 앵커(오후 2:20 / 3:00 / 4:20 …)마다 반 블록이 가로로 늘어선** 섹션 구조다.
 * → 섹션 하나 = 줄 하나, 줄 안 순서 = 시트 좌→우. eywa 통합뷰가 같은 모양으로 그려진다.
 *
 * ⚠️ 반 이름은 **개명(레벨업) 뒤에** 맞춰야 짝이 맞는다(level-up-rename.mts를 먼저).
 * ⚠️ 쓰기는 `tenant_settings.data`의 `operations.subjects[english]`에만, **섹션 머지**로 한다
 *    (다른 설정 보존). 트리거가 비-master 쓰기를 막으므로([[#59]]) 세션 클레임을 주입한다.
 *
 * 실행: node --env-file=.env.local node_modules/tsx/dist/cli.mjs \
 *         scripts/_english_sync/sync-integration-groups.mts ["통합영어시간표(8월)"] [--apply]
 */
import postgres from "postgres";
import { google } from "googleapis";

const MASTER_ID = "1-1JHCw36iWPku782DXMhqYbEMBUFL7bElfJjSQekoWA";
const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const ACTOR = "fcf735fa-edf7-4095-8fa6-724285a018ed"; // 박소선(master) — tenant_settings 트리거 통과용
const args = process.argv.slice(2);
const TAB = args.find((a) => !a.startsWith("--")) ?? "통합영어시간표(8월)";
const APPLY = args.includes("--apply");

function creds(): { client_email: string; private_key: string } {
  let s = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "").trim();
  if (!s.startsWith("{")) s = Buffer.from(s, "base64").toString("utf-8");
  return JSON.parse(s);
}

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

// ── 반 블록 헤더 = 가로 병합 셀 중 첫 줄이 반 이름꼴 ──────────────────────────
// 헤더는 `DP6⏎매일 2:20~3:40⏎(Anna)` 형태의 여러 줄 병합 셀이라 완전일치로는 안 잡힌다.
const CLASS_RE = /^([A-Z]{2,4}[\w-]*|중등E_.+|중고E_.+|고등E_.+)$/;
type Hdr = { name: string; r: number; c: number };
const headers: Hdr[] = [];
for (const m of merges) {
  if (m.c2 <= m.c1) continue;
  const first = at(m.r1, m.c1).split("\n")[0]!.trim();
  if (CLASS_RE.test(first)) headers.push({ name: first, r: m.r1, c: m.c1 });
}
// 섹션 = 같은 행에서 시작하는 헤더들. 행 순서 = 위→아래(시각 순), 열 순서 = 좌→우.
const byRow = new Map<number, Hdr[]>();
for (const h of headers) byRow.set(h.r, [...(byRow.get(h.r) ?? []), h]);
const sections = [...byRow.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([r, hs]) => ({ row: r, classes: hs.sort((a, b) => a.c - b.c).map((h) => h.name) }));

/** 섹션 제목 = 그 행 왼쪽(A~B열)의 시각 라벨. 없으면 "N번째 줄". */
function sectionTitle(row: number, idx: number): string {
  for (let r = row; r <= row + 3; r++) {
    for (let cc = 0; cc <= 2; cc++) {
      const v = at(r, cc);
      if (/\d{1,2}:\d{2}/.test(v)) return v.replace(/\s+/g, " ").trim();
    }
  }
  return `${idx + 1}번째 줄`;
}

// ── eywa 반 id ───────────────────────────────────────────────────────────────
const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });
const rows = await sql<{ id: string; class_name: string }[]>`
  select id, class_name from classes
   where tenant_id = ${TENANT} and subject = 'english' and is_active = true`;
const idByName = new Map(rows.map((r) => [r.class_name.replace(/\s+/g, ""), r.id]));

// 같은 시각 라벨이 두 줄에 걸릴 수 있다(실측 8월: '오후 4:20'이 EiE 줄과 중등 줄 둘). 제목이 겹치면
// 화면에서 어느 줄인지 못 가리므로 번호를 붙인다 — 이름은 설정 화면에서 바로 고칠 수 있다.
const titleCount = new Map<string, number>();
const groups = sections.map((s, i) => {
  const raw = sectionTitle(s.row, i);
  const seen = (titleCount.get(raw) ?? 0) + 1;
  titleCount.set(raw, seen);
  const title = seen === 1 ? raw : `${raw} (${seen})`;
  const hit = s.classes.map((n) => ({ n, id: idByName.get(n.replace(/\s+/g, "")) ?? null }));
  return { id: `sheet-${i + 1}`, title, items: hit };
});

console.log(`시트 "${sh.properties!.title}" — 섹션 ${sections.length}개 · 반 블록 ${headers.length}개  ${APPLY ? "【적용】" : "(dry-run)"}\n`);
let missing = 0;
for (const g of groups) {
  const names = g.items.map((x) => (x.id ? x.n : `❌${x.n}`)).join(" · ");
  missing += g.items.filter((x) => !x.id).length;
  console.log(`  [${g.title}] ${g.items.length}반 — ${names}`);
}
const placed = new Set(groups.flatMap((g) => g.items.filter((x) => x.id).map((x) => x.id!)));
const unplaced = rows.filter((r) => !placed.has(r.id));
console.log(`\n배정 ${placed.size}반 · 시트에만 있고 eywa에 없음 ${missing}건 · eywa에만 있고 줄에 없음 ${unplaced.length}건`);
if (unplaced.length) console.log(`  (기타 줄로 내려감): ${unplaced.map((r) => r.class_name).join(" · ")}`);

if (!APPLY) {
  console.log("\n(dry-run — 쓰기 없음. 실제 반영은 --apply)");
  await sql.end();
  process.exit(0);
}

// ── 저장 — operations.subjects[english]에 섹션 머지 ───────────────────────────
const payload = groups.map((g) => ({
  id: g.id,
  title: g.title,
  classIds: g.items.filter((x) => x.id).map((x) => x.id!),
}));
await sql.begin(async (tx) => {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ACTOR, role: "authenticated" })}, true)`;
  await tx`
    update tenant_settings
       set data = jsonb_set(
             data,
             '{operations,subjects}',
             (
               select jsonb_agg(
                 case when s->>'key' = 'english'
                   then s || ${sql.json({ integrationGroupsEnabled: true, integrationGroups: payload, integrationShowOthers: true })}::jsonb
                   else s end
                 order by ord
               )
               from jsonb_array_elements(data->'operations'->'subjects') with ordinality t(s, ord)
             )
           )
     where tenant_id = ${TENANT}`;
});
console.log(`\n✅ 적용 완료 — 줄 ${payload.length}개 · 배정 ${payload.reduce((a, g) => a + g.classIds.length, 0)}반`);
await sql.end();
