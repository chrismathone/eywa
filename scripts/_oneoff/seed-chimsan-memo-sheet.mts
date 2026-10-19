/**
 * 침산 영어 시간표 오른쪽 메모 시트 — 구글 시트 '퇴원생 명단'을 **글자·서식 그대로** 옮긴다(원장 2026-10-19
 * *"텍스트 및 서식은 사진과 동일하게"* · *"침산 지점만 적용시키고 다른 지점은 그냥 빈 엑셀 같은 뷰"*).
 *
 *   ENV_FILE=<.env.local 경로> npx tsx scripts/_oneoff/seed-chimsan-memo-sheet.mts [--out=<파일.json>] [--apply] [--force]
 *
 * 원본 = `2026 영어시간표_인재원 본원` › ` 통합영어시간표(10월)` 탭 BR5:DD60(명단 1~10월 + 오른쪽·아래 회색 여백).
 * 🔴 기본은 미리 보기(구글·DB 읽기만) — 칸·병합·서식 수를 찍고 `--out`이면 저장 모양(JSON)을 파일로 남긴다.
 * 🔴 `--apply` = 0374a 적용 뒤에만 · 침산(cs) 영어 시트가 **아직 없을 때만** 넣는다. `--force`면 덮는다
 *    (그새 화면에서 고친 내용이 사라진다 — 원장에게 묻고 쓸 것). 넣으면 감사로그 한 줄.
 */
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
import { google } from "googleapis";
import postgres from "postgres";
import { docFromGoogle, type GoogleGrid, type GoogleMerge } from "../../src/features/timetable-memo/google";
import { packSheet, packedSheetSchema } from "../../src/features/timetable-memo/pack";

config({ path: process.env.ENV_FILE ?? ".env.local", quiet: true });

const SPREADSHEET_ID = "1-1JHCw36iWPku782DXMhqYbEMBUFL7bElfJjSQekoWA";
const TAB = " 통합영어시간표(10월)";
const RANGE = "BR5:DD60";
/** BR5 = 0부터 센 (4행, 69열) · BR..DD = 39열 · 5..60행 = 56행. */
const AREA = { row0: 4, col0: 69, rows: 56, cols: 39 };
const TENANT_SLUG = "cs";
const SUBJECT = "english";
// 감사로그의 행위자 = 지시한 원장(다른 일회성 스크립트와 같은 계정).
const ACTOR = { id: "94007db7-12d3-4b5d-97f2-39071446536b", name: "원일" };

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

function serviceAccount() {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? "").trim();
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY가 없습니다(ENV_FILE 확인)");
  return JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) as { client_email: string; private_key: string };
}

const creds = serviceAccount();
const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
const sheets = google.sheets({ version: "v4", auth });
const { data } = await sheets.spreadsheets.get({
  spreadsheetId: SPREADSHEET_ID,
  ranges: [`'${TAB.replace(/'/g, "''")}'!${RANGE}`],
  includeGridData: true,
  fields:
    "sheets(merges,data(rowMetadata(pixelSize),columnMetadata(pixelSize),rowData(values(formattedValue,userEnteredValue,effectiveFormat(backgroundColor,backgroundColorStyle,borders,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)))))",
});
const sheet = data.sheets?.[0];
const grid = sheet?.data?.[0];
if (!sheet || !grid) throw new Error("시트 구역을 읽지 못했습니다");

const doc = docFromGoogle(grid as GoogleGrid, (sheet.merges ?? []) as GoogleMerge[], AREA);
const packed = packSheet(doc);
const check = packedSheetSchema.safeParse(packed);
if (!check.success) throw new Error(`저장 검증 실패: ${check.error.message.slice(0, 400)}`);
const texts = packed.cells.filter((c) => c[2]).length;
console.log(`판 ${doc.rows}행 × ${doc.cols}열 · 칸 ${packed.cells.length}(글자 ${texts}) · 병합 ${packed.merges.length} · 서식 ${packed.styles.length}벌 · ${JSON.stringify(packed).length.toLocaleString()}바이트`);
const out = arg("out");
if (out) {
  writeFileSync(out, JSON.stringify(packed));
  console.log(`저장 모양 → ${out}`);
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL이 없습니다");
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  const [tenant] = await sql`select id, name from tenants where slug = ${TENANT_SLUG}`;
  if (!tenant) throw new Error("침산 지점을 찾지 못했습니다");
  let existing: { version: number; updated_at: string } | undefined;
  let tableReady = true;
  try {
    [existing] = await sql<{ version: number; updated_at: string }[]>`select version, updated_at from timetable_memo_sheets where tenant_id = ${tenant.id} and subject = ${SUBJECT}`;
  } catch (e) {
    if (APPLY) throw e;
    tableReady = false;
  }
  console.log(`대상 지점: ${tenant.name} · 지금 시트: ${!tableReady ? "표 없음(0374a 미적용)" : existing ? `있음(version ${existing.version}, ${existing.updated_at})` : "없음"}`);
  if (!APPLY) {
    console.log("미리 보기만 했습니다(--apply 없음).");
  } else if (existing && !FORCE) {
    console.log("이미 시트가 있어 넣지 않았습니다(덮으려면 --force — 화면에서 고친 내용이 사라진다).");
  } else {
    await sql.begin(async (tx) => {
      const [row] = await tx`
        insert into timetable_memo_sheets (tenant_id, subject, doc, version, updated_at, updated_by)
        values (${tenant.id}, ${SUBJECT}, ${tx.json(packed as never)}, 1, now(), ${ACTOR.id})
        on conflict (tenant_id, subject) do update
          set doc = excluded.doc, version = timetable_memo_sheets.version + 1, updated_at = now(), updated_by = excluded.updated_by
        returning version`;
      await tx`
        insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
        values (${tenant.id}, ${ACTOR.id}, ${ACTOR.name}, 'timetable_memo_sheet_save', 'timetable_memo_sheet', '시간표 메모 시트',
          ${tx.json({ subject: SUBJECT, version: row!.version, rows: packed.rows, cols: packed.cols, cells: packed.cells.length, source: "google_sheet_import" })})`;
      console.log(`넣었습니다 — version ${row!.version}`);
    });
  }
} finally {
  await sql.end();
}
