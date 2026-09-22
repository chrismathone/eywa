/**
 * 통합뷰 **그룹(줄)** 을 `통합영어시간표(N월)` 탭 구조와 맞춘다(원장 2026-08-04 *"그룹 설정까지 시트와
 * 맞춰주면 좋겠어"*).
 *
 * 시트는 **시각 앵커(오후 2:20 / 3:00 / 4:20 …)마다 반 블록이 가로로 늘어선** 섹션 구조다.
 * → 섹션 하나 = 줄 하나, 줄 안 순서 = 시트 좌→우. aywa 통합뷰가 같은 모양으로 그려진다.
 *
 * ⚠️ 반 이름은 **개명(레벨업) 뒤에** 맞춰야 짝이 맞는다(level-up-rename.mts를 먼저).
 * ⚠️ 쓰기는 `tenant_settings.data`의 `operations.subjects[english]`에만, **섹션 머지**로 한다
 *    (다른 설정 보존). 트리거가 비-master 쓰기를 막으므로([[#59]]) 세션 클레임을 주입한다.
 *
 * 실행: node --env-file=.env.local node_modules/tsx/dist/cli.mjs \
 *         scripts/_english_sync/sync-integration-groups.mts ["통합영어시간표(9월)"] [옵션]
 *
 *   (없음)                지금 저장된 배치와 비교만(dry-run)
 *   --apply               지금 반영
 *   --as-of=YYYY-MM-DD    그 날짜 시점의 반 이름으로 시트와 맞춘다(예약된 개명 반영)
 *   --schedule=YYYY-MM-DD 그 날짜에 자동 반영되도록 **예약**(--as-of 기본값도 이 날짜) · 기록은 --apply
 */
import postgres from "postgres";
import { google } from "googleapis";
import {
  buildClassNameAsOfIndex,
  resolveClassNameAsOf,
  type PendingRename,
} from "../../src/features/classes/class-name-as-of";

const MASTER_ID = "1-1JHCw36iWPku782DXMhqYbEMBUFL7bElfJjSQekoWA";
const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const ACTOR = "fcf735fa-edf7-4095-8fa6-724285a018ed"; // 박소선(master) — tenant_settings 트리거 통과용
const SUBJECT = "english"; // 이 스크립트는 통합 **영어** 시간표 탭 전용
const args = process.argv.slice(2);
const TAB = args.find((a) => !a.startsWith("--")) ?? "통합영어시간표(8월)";
const APPLY = args.includes("--apply");
/**
 * `--as-of=YYYY-MM-DD` — **그 날짜 시점의 반 이름**으로 시트와 맞춘다(예약된 개명 반영).
 *
 * 🔴 왜 필요한가: 9월 탭은 **개명 뒤 이름**(PL1a·LT4·LS4a…)으로 적혀 있는데 개명은 9/1 cron이
 *    재생하므로 DB는 아직 옛 이름(DP6·LT3·LS3a…)이다. 오늘 이름으로 맞추면 44반 중 16반이 ❌로 빠져
 *    '기타' 줄로 떨어진다. 더 나쁜 건 **사슬 회전**이다 — 시트의 `LS6`은 9/1에 LS5가 될 이름인데
 *    오늘 DB에도 `LS6`(9/1에 LE1이 될 반)이 있어서, 이름으로 맞추면 **엉뚱한 반에 조용히 붙는다**.
 */
/**
 * `--schedule=YYYY-MM-DD` — 지금 덮어쓰지 않고 **그 날짜에 자동 반영되도록 예약**한다
 * (원장 2026-08-29 *"그룹설정까지 예약걸면 안되는거야? 시스템 새로 설계해서?"*).
 *
 * 그 날짜의 **배치 스냅샷 payload**(`apply.integrationGroups`)에 실어 두면 00:30 cron
 * (`/api/cron/apply-due-class-updates`)이 담임·반 이름과 함께 재생한다. 같은 스냅샷에 싣는 이유는
 * 시간표 툴바의 취소(×)가 그 스냅샷을 되돌리면 **이 예약도 함께 사라져야** 하기 때문이다.
 * `--as-of`를 따로 안 주면 이 날짜를 그대로 쓴다(그 시점 이름으로 시트를 맞춘다).
 */
const SCHEDULE = (args.find((a) => a.startsWith("--schedule="))?.slice("--schedule=".length) ?? "").trim();
if (SCHEDULE && !/^\d{4}-\d{2}-\d{2}$/.test(SCHEDULE)) {
  console.error("--schedule은 YYYY-MM-DD 형식이어야 합니다.");
  process.exit(1);
}
const AS_OF = (args.find((a) => a.startsWith("--as-of="))?.slice("--as-of=".length) ?? SCHEDULE).trim();
if (AS_OF && !/^\d{4}-\d{2}-\d{2}$/.test(AS_OF)) {
  console.error("--as-of는 YYYY-MM-DD 형식이어야 합니다.");
  process.exit(1);
}

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

// ── aywa 반 id ───────────────────────────────────────────────────────────────
const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });
const rawRows = await sql<{ id: string; class_name: string }[]>`
  select id, class_name from classes
   where tenant_id = ${TENANT} and subject = ${SUBJECT} and is_active = true`;

// ── `--as-of` 시점 이름으로 갈아끼우기 ────────────────────────────────────────
// 판정은 화면과 **같은 순수 모듈**을 쓴다(cron의 shouldApplyName과 같은 조건 — 사람이 그 사이 이름을
// 손으로 바꿨으면 사슬이 끊겨 그 반은 옛 이름 그대로다). 여기서 규칙을 새로 쓰면 화면과 갈린다.
let rows: { id: string; class_name: string }[] = rawRows;
if (AS_OF) {
  const snaps = await sql<{ id: string; reference_date: string; updates: unknown }[]>`
    select s.id, s.reference_date::text, s.payload->'apply'->'classUpdates' as updates
      from timetable_snapshots s
     where s.tenant_id = ${TENANT}
       and s.reference_date > current_date
       and s.reference_date <= ${AS_OF}::date
       and not exists (
         select 1 from timetable_import_logs l
          where l.snapshot_id = s.id and l.restored_at is not null)
     order by s.reference_date, s.created_at`;
  const pending: PendingRename[] = [];
  for (const snap of snaps) {
    for (const u of (Array.isArray(snap.updates) ? snap.updates : []) as {
      classId?: string; className?: string | null; prevClassName?: string | null;
    }[]) {
      if (!u?.classId || !u.className) continue; // 담임·강의실만 바뀌는 항목엔 이름이 없다
      pending.push({ classId: u.classId, from: u.prevClassName ?? null, to: u.className, date: String(snap.reference_date).slice(0, 10) });
    }
  }
  const index = buildClassNameAsOfIndex(pending);
  let moved = 0;
  rows = rawRows.map((r) => {
    const asOf = resolveClassNameAsOf(index, r.id, AS_OF, r.class_name);
    if (!asOf) return r;
    moved += 1;
    return { ...r, class_name: asOf.name };
  });
  console.log(`⏱ ${AS_OF} 시점 이름으로 맞춥니다 — 예약된 개명 ${pending.length}건 중 ${moved}건 반영\n`);
}

const idByName = new Map<string, string>();
const dupNames: string[] = [];
for (const r of rows) {
  const key = r.class_name.replace(/\s+/g, "");
  if (idByName.has(key)) dupNames.push(r.class_name);
  else idByName.set(key, r.id);
}
// 🔴 같은 이름이 둘이면 어느 반인지 못 가린다 — 조용히 하나를 고르면 남의 반이 그 줄에 들어간다.
if (dupNames.length > 0) {
  console.error(`중복된 반 이름 ${dupNames.length}건 — 중단합니다: ${dupNames.join(" · ")}`);
  await sql.end();
  process.exit(1);
}

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
console.log(`\n배정 ${placed.size}반 · 시트에만 있고 aywa에 없음 ${missing}건 · aywa에만 있고 줄에 없음 ${unplaced.length}건`);
if (unplaced.length) console.log(`  (기타 줄로 내려감): ${unplaced.map((r) => r.class_name).join(" · ")}`);

// ── 지금 저장된 배치와 무엇이 다른가 ─────────────────────────────────────────
// 🔴 이 설정은 `tenant_settings` **한 벌**이라 시간 축이 없다 — 미래 배치를 지금 적용하면 **오늘 화면이
//    바뀐다**. 그래서 쓰기 전에 "이번 주 화면에서 무엇이 달라지나"를 먼저 보여 준다.
const [cur] = await sql<{ groups: unknown }[]>`
  select (
    select s->'integrationGroups'
      from jsonb_array_elements(data->'operations'->'subjects') s
     where s->>'key' = 'english'
  ) as groups
    from tenant_settings where tenant_id = ${TENANT}`;
const curGroups = (Array.isArray(cur?.groups) ? cur.groups : []) as { title?: string; classIds?: string[] }[];
const nameOfId = new Map(rows.map((r) => [r.id, r.class_name]));
const lineOfId = (gs: readonly { title?: string; classIds?: string[] }[]) => {
  const m = new Map<string, string>();
  // 한 반이 여러 줄에 적혀 있으면 화면도 **먼저 나온 줄**만 인정한다(class-grid 규약) — 여기도 같게.
  for (const g of gs) for (const id of g.classIds ?? []) if (!m.has(id)) m.set(id, g.title ?? "");
  return m;
};
const before = lineOfId(curGroups);
const after = lineOfId(
  groups.map((g) => ({ title: g.title, classIds: g.items.filter((x) => x.id).map((x) => x.id!) })),
);
const moves: string[] = [];
for (const [id, to] of after) {
  const from = before.get(id);
  if (from !== to) moves.push(`    ${nameOfId.get(id) ?? id}: ${from ?? "(기타)"} → ${to}`);
}
const dropped = [...before.keys()].filter((id) => !after.has(id));
console.log();
console.log(`지금 저장된 배치(줄 ${curGroups.length}개) 대비 — 줄이 바뀌는 반 ${moves.length}개 · 줄에서 빠지는 반 ${dropped.length}개`);
if (moves.length) console.log(moves.join("\n"));
if (dropped.length) console.log(`    (기타로 내려감) ${dropped.map((id) => nameOfId.get(id) ?? id).join(" · ")}`);

const payload = groups.map((g) => ({
  id: g.id,
  title: g.title,
  classIds: g.items.filter((x) => x.id).map((x) => x.id!),
}));

// ── 예약(--schedule) ─────────────────────────────────────────────────────────
if (SCHEDULE) {
  const [row0] = await sql<{ today: string }[]>`select (current_date)::text as today`;
  const today = row0!.today;
  // 🔴 과거·오늘은 예약이 아니다 — cron은 미래 스냅샷만 재생하고 취소도 미래분만 된다.
  if (SCHEDULE <= today) {
    console.error(`\n--schedule=${SCHEDULE}은 미래 날짜가 아닙니다(오늘 ${today}). 지금 반영하려면 --apply를 쓰세요.`);
    await sql.end();
    process.exit(1);
  }
  // 그 날짜의 **배치 스냅샷** — 되돌려진 것은 제외(이미 취소된 예약에 실으면 영영 안 돈다).
  const snaps = await sql<{ id: string }[]>`
    select s.id from timetable_snapshots s
     where s.tenant_id = ${TENANT}
       and s.reference_date = ${SCHEDULE}::date
       and s.payload ? 'kind'
       and not exists (
         select 1 from timetable_import_logs l
          where l.snapshot_id = s.id and l.restored_at is not null)
     order by s.created_at`;
  if (snaps.length !== 1) {
    console.error(
      `\n${SCHEDULE}에 예약된 배치 스냅샷이 ${snaps.length}건입니다(1건이어야 함) — ` +
        `먼저 시간표 가져오기로 그 날짜 적용을 예약하세요.`,
    );
    await sql.end();
    process.exit(1);
  }
  // 🔴 빈 배치를 예약하면 그날 통합뷰가 '기타' 한 줄이 된다 — 시트 파싱이 무너진 것이므로 중단.
  if (payload.length === 0 || payload.every((g) => g.classIds.length === 0)) {
    console.error("\n줄이 하나도 없거나 전부 비어 있습니다 — 시트 탭 이름을 확인하세요(예약하지 않음).");
    await sql.end();
    process.exit(1);
  }
  const snapshotId = snaps[0]!.id;
  // `from` = **예약 시점의 배치**. cron이 이 값과 현재를 비교해 "그 사이 사람이 손댔나"를 본다.
  const plan = { subject: SUBJECT, groups: payload, from: curGroups, showOthers: true };
  console.log(`\n⏱ ${SCHEDULE} 예약 — 배치 스냅샷 ${snapshotId.slice(0, 8)}에 그룹 배치 ${payload.length}줄을 싣습니다.`);
  console.log(`   (그날 00:30 cron이 반 이름 변경과 함께 반영 · 시간표 툴바의 ×로 취소하면 함께 사라짐)`);
  if (!APPLY) {
    console.log("\n(dry-run — 쓰기 없음. 실제 예약은 --apply)");
    await sql.end();
    process.exit(0);
  }
  await sql`
    update timetable_snapshots
       set payload = jsonb_set(payload, '{apply,integrationGroups}', ${sql.json(plan as never)}::jsonb, true)
     where id = ${snapshotId} and tenant_id = ${TENANT}`;
  console.log(`\n✅ 예약 완료 — ${SCHEDULE} 00:30에 자동 반영됩니다.`);
  await sql.end();
  process.exit(0);
}

if (!APPLY) {
  console.log("\n(dry-run — 쓰기 없음. 실제 반영은 --apply)");
  await sql.end();
  process.exit(0);
}

// ── 즉시 저장 — operations.subjects[english]에 섹션 머지 ─────────────────────
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
