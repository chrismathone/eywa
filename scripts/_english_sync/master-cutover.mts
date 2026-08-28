/**
 * 원장님 마스터 시트(`2026 영어시간표_인재원 본원`) 강사별 탭 → eywa 배치 **temporal 컷오버**.
 *
 * 배경: 앱의 '시트에서 가져오기'는 **eywa 전용 시트**(`[Eywa 2.0] 영어 시간표`)만 읽는다. 원장님이 실제로
 * 편집하는 마스터는 탭 구조가 다르고(블록형: 2행 강사·4행 요일·5행 시각앵커) 탭이 월마다 늘어나
 * 앱 경로로 못 읽는다. 그래서 **마스터 전용 파서(parse-grid.ts)로 읽고, 매칭·diff·쓰기는 앱과 동일한
 * 순수 모듈 + 동일 RPC(`apply_english_structure`)** 를 그대로 쓴다 = 스냅샷·롤백까지 앱과 같은 보장.
 *
 * 컷오버 = "7/8까지는 옛 배치, 7/9부터 새 배치"(원장 지시 2026-07-22):
 *   RPC가 `p_today`를 받아 **마감 valid_to = p_today − 1 · 신규 valid_from = p_today** 로 처리하므로
 *   `--cutover=2026-07-09` 하나로 정확히 그 의미가 된다. 기존 행은 **삭제하지 않는다**(타임머신 보존).
 *
 * 실행:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/_english_sync/master-cutover.mts \
 *     "강사별영어시간표(7/9~)" [--cutover=2026-07-09] [--apply]
 *
 * ⚠️ 기본은 dry-run(쓰기 0). `--apply`에서만 쓴다. 되돌리기 = `rollback_english_structure(<snapshotId>)`.
 */
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { parseTeacherGrid } from "../../src/features/timetable/import/structure/parse-grid";
import { matchStructure } from "../../src/features/timetable/import/structure/match";
import { computeStructureDiff } from "../../src/features/timetable/import/structure/diff";
import { buildClassUpdates } from "../../src/features/timetable/import/structure/class-updates";
import type {
  ExistingContext,
  ExistingSchedule,
  SheetGrid,
} from "../../src/features/timetable/import/structure/types";
import type { DayOfWeek } from "../../src/features/timetable/lib/periods";
import { canonicalSlotTeacherLabel } from "../../src/features/timetable/lib/teacher-label";
import {
  blocksApply,
  conflictChecklist,
  describeConflict,
} from "../../src/features/timetable/import/structure/conflicts";

/** 기본 마스터(`2026 영어시간표_인재원 본원`) — `--sheet`로 다른 스프레드시트를 넣을 수 있다. */
const DEFAULT_MASTER_ID = "1-1JHCw36iWPku782DXMhqYbEMBUFL7bElfJjSQekoWA";
const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const SUBJECT = "english";
/** RPC는 security invoker + auth_tenant_id()(=auth.uid() 조회) — 스크립트 실행엔 세션 클레임 주입이 필요. */
const ACTOR = "fcf735fa-edf7-4095-8fa6-724285a018ed"; // 박소선(master)

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)?.trim();
/**
 * URL이면 `/d/<id>/`에서 뽑고, 아니면 id 그대로. 주소를 통째로 붙여넣을 수 있게 하는 것이 목적.
 * 🔴 주소를 줬는데 id를 못 뽑으면 **기본 시트로 떨어뜨리지 않고 중단**한다 — 그대로 진행하면
 *    "내가 준 시트"가 아니라 엉뚱한 시트를 읽고, 그 결과로 `--apply`가 남의 배치를 갈아엎는다.
 */
function sheetIdOf(v: string | undefined): string {
  if (!v) return DEFAULT_MASTER_ID;
  if (!/^https?:/i.test(v)) return v;
  const id = /\/d\/([A-Za-z0-9_-]+)/.exec(v)?.[1];
  if (!id) {
    console.error(`--sheet 주소에서 스프레드시트 id를 찾지 못했습니다: ${v}`);
    process.exit(1);
  }
  return id;
}
/** URL의 `gid=`(쿼리든 해시든). 탭 이름을 안 줬을 때 이 값으로 탭을 찾는다. */
function gidOf(v: string | undefined): number | null {
  const raw = opt("gid") ?? (v ? /[?#&]gid=(\d+)/.exec(v)?.[1] : undefined);
  return raw === undefined ? null : Number(raw);
}
const SHEET_ARG = opt("sheet");
const MASTER_ID = sheetIdOf(SHEET_ARG);
const GID = gidOf(SHEET_ARG);
const XLSX = opt("xlsx");
const LIST = args.includes("--list");
const ACK_CONFLICTS = args.includes("--ack-conflicts");
const TAB_ARG = opt("tab") ?? args.find((a) => !a.startsWith("--"));
const CUTOVER = (opt("cutover") ?? "2026-07-09").trim();
const APPLY = args.includes("--apply");
if (!/^\d{4}-\d{2}-\d{2}$/.test(CUTOVER)) {
  console.error(`--cutover 형식이 올바르지 않습니다: "${CUTOVER}" (YYYY-MM-DD)`);
  process.exit(1);
}

/**
 * 시트엔 반명처럼 보이지만 실제 반이 아닌 셀(메모)이 섞여 있다 — 숫자·시각·"쉬는 시간"·사람 이름 등.
 * 원장 확인(2026-07-22): "메모라 넘겨도 된다". 그래서 **기존 반에 매칭되지 않는 이름은 기본적으로 버리고**,
 * 진짜 신설 반만 아래 화이트리스트로 **명시 생성**한다(자동 생성 금지 = 메모가 반으로 둔갑하는 걸 원천 차단).
 *
 * ⚠️ 색 규칙(parse-grid 3패스)이 메모 대부분을 이미 걸러내지만 **칠해진 메모**가 남는다(실측 1건:
 *   Elsa "7, 8월만 4시 반 출근"). 그래서 화이트리스트는 색 규칙이 있어도 여전히 필요하다.
 * 누적 기록(컷오버별로 무엇이 신설됐는지 git에 남긴다 — 이미 활성인 이름은 자동 skip이라 지울 필요 없음):
 *   · 2026-07-09 컷오버: 중고E_중2 최상위 · 중등E_중2 정규 D
 *   · 2026-08-03 컷오버: EiE 레벨 진급 13개(DP6·JP2·KW2·LS3a·LS3b·LS6·LT3·LT5·MEC1-4·PJ1·PJ6·PL3·RTT4)
 * 임시 추가는 `--new-class=A,B` 로도 가능(코드 수정 없이 1회성).
 */
const NEW_CLASSES_TO_CREATE = [
  "중고E_중2 최상위",
  "중등E_중2 정규 D",
  "DP6", "JP2", "KW2", "LS3a", "LS3b", "LS6", "LT3", "LT5", "MEC1-4", "PJ1", "PJ6", "PL3", "RTT4",
];
const EXTRA_NEW_CLASSES = (args.find((a) => a.startsWith("--new-class="))?.split("=")[1] ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

function creds(): { client_email: string; private_key: string } {
  let s = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT_KEY || "").trim();
  if (!s.startsWith("{")) s = Buffer.from(s, "base64").toString("utf-8");
  return JSON.parse(s);
}

/**
 * ⚠️ `googleapis`는 **여기서만 지연 로드**한다 — `--xlsx` 경로는 구글 키도 이 패키지도 필요 없는데,
 * 최상위 import면 그 경로에서도 통째로 로드된다(2026-08-28 실측: 이 PC의 pnpm 스토어에 있는
 * `googleapis/.../storagebatchoperations/index.js`가 NUL로 깨져 있어 xlsx 드라이런까지 못 돌았다).
 */
async function sheetsApi() {
  const { google } = await import("googleapis");
  const c = creds();
  const auth = new google.auth.JWT({
    email: c.client_email,
    key: c.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

/** 그 스프레드시트의 탭 목록(gid → 이름). `--list`와 "탭 못 찾음" 안내에 쓴다. */
async function listTabs(): Promise<{ gid: number; title: string }[]> {
  if (XLSX) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(XLSX);
    // xlsx엔 gid가 없다 — 순서를 대신 보여준다(탭은 이름으로 고른다).
    return wb.worksheets.map((w, i) => ({ gid: i, title: w.name }));
  }
  const res = await (await sheetsApi()).spreadsheets.get({
    spreadsheetId: MASTER_ID,
    fields: "sheets.properties(sheetId,title)",
  });
  return (res.data.sheets ?? []).map((sh) => ({
    gid: sh.properties!.sheetId!,
    title: sh.properties!.title!,
  }));
}

/**
 * 내려받은 `.xlsx`에서 그리드를 만든다 — **구글 서비스계정 키가 없을 때의 경로**.
 * 🔴 ExcelJS는 **병합에 덮인 셀에도 대표값을 복제**해 돌려준다(Sheets API는 좌상단에만 값이 있다).
 *    그대로 두면 한 반이 10분 조각으로 쪼개지고 강사 블록이 열 수만큼 생긴다(실측: 17블록 → 180블록).
 *    그래서 덮인 칸을 직접 비운다.
 * ⚠️ 색은 신뢰하지 않는다 — 밴딩·조건부 서식이 xlsx에 셀별로 굳지 않아 실제 칠해진 칸이 통째로 빠진다
 *    (실측 9월 탭: 색 규칙을 켜면 406슬롯 중 60개만 남았다). 메모 방어는 색이 아니라 아래
 *    "DB에 없는 이름은 버린다"가 맡는다(NEW_CLASSES_TO_CREATE 화이트리스트만 생성).
 */
/**
 * 셀 값 → Sheets API `formattedValue`에 준하는 문자열.
 * 🔴 모르는 모양은 **빈 문자열**로 떨어뜨린다 — `String(obj)`로 두면 `[object Object]`가 반 이름 후보로
 *    올라와 "슬롯 65칸짜리 반"으로 보인다(2026-08-28 실측). 이름이 아닌 건 없는 것이 정직하다.
 * 🔴 시각 셀은 Date로 온다 — 그대로 문자열화하면 `Sat Dec 30 1899 …`가 되므로 `HH:MM`으로 맞춘다
 *    (엑셀의 시각은 1899-12-30 기준 날짜라 연/월/일은 의미가 없다).
 */
function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date)
    return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((x) => x.text ?? "").join("");
    if ("result" in o) return cellText(o.result);
    if ("text" in o) return cellText(o.text);
    if ("error" in o) return ""; // #REF! 등 — 이름이 아니다
  }
  return "";
}

async function readXlsxGrid(tab: string | undefined): Promise<SheetGrid> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX!);
  const ws = tab ? wb.worksheets.find((w) => w.name === tab) : wb.worksheets[0];
  if (!ws) throw new Error(`xlsx에 탭 "${tab}"이 없습니다`);
  const cells: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      row.push(cellText(ws.getCell(r, c).value));
    }
    cells.push(row);
  }
  const merges = ((ws.model as unknown as { merges?: string[] }).merges ?? []).map((m) => {
    const at = (ref: string) => {
      const mm = /^([A-Z]+)(\d+)$/.exec(ref)!;
      let col = 0;
      for (const ch of mm[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
      return { r: Number(mm[2]) - 1, c: col - 1 };
    };
    const [a, b] = m.split(":");
    const A = at(a!), B = at(b ?? a!);
    return { startRowIndex: A.r, endRowIndex: B.r + 1, startColumnIndex: A.c, endColumnIndex: B.c + 1 };
  });
  for (const mg of merges)
    for (let r = mg.startRowIndex; r < mg.endRowIndex; r++)
      for (let c = mg.startColumnIndex; c < mg.endColumnIndex; c++)
        if (!(r === mg.startRowIndex && c === mg.startColumnIndex) && cells[r]) cells[r]![c] = "";
  // fills 미지정 = parse-grid가 색 규칙을 건너뛴다(위 ⚠️).
  return { tabName: ws.name, cells, merges };
}

async function readMasterGrid(tab: string): Promise<SheetGrid> {
  if (XLSX) return readXlsxGrid(tab);
  const res = await (await sheetsApi()).spreadsheets.get({
    spreadsheetId: MASTER_ID,
    ranges: [tab],
    includeGridData: true,
    // 배경색까지 — 원장 규칙 "색 없는 건 다 수업이 아님"(parse-grid 3패스)이 이 값을 쓴다.
    fields:
      "sheets(properties(title),merges,data(rowData(values(formattedValue,effectiveFormat(backgroundColor,backgroundColorStyle)))))",
  });
  const sh = res.data.sheets![0]!;
  const rowData = sh.data![0]!.rowData ?? [];
  return {
    tabName: sh.properties!.title!,
    cells: rowData.map((r) => (r.values ?? []).map((v) => v.formattedValue ?? "")),
    fills: rowData.map((r) => (r.values ?? []).map((v) => isFilled(v.effectiveFormat))),
    merges: (sh.merges ?? []).map((m) => ({
      startRowIndex: m.startRowIndex!,
      endRowIndex: m.endRowIndex!,
      startColumnIndex: m.startColumnIndex!,
      endColumnIndex: m.endColumnIndex!,
    })),
  };
}

/**
 * 셀에 배경색이 **칠해져 있는가**. 구글은 기본(무색)을 두 가지로 준다 — 테마색 `BACKGROUND` 또는
 * 순백 `rgb(1,1,1)`. 둘 다 "안 칠함"으로 본다(실측 8월 탭: 무색 33칸 전부 메모).
 */
type CellFormatish = {
  backgroundColor?: { red?: number | null; green?: number | null; blue?: number | null } | null;
  backgroundColorStyle?: { themeColor?: string | null } | null;
} | null | undefined;
function isFilled(ef: CellFormatish): boolean {
  const theme = ef?.backgroundColorStyle?.themeColor;
  if (theme) return theme !== "BACKGROUND";
  const bg = ef?.backgroundColor;
  if (!bg) return false;
  const r = bg.red ?? 0, g = bg.green ?? 0, b = bg.blue ?? 0;
  return !(r >= 0.999 && g >= 0.999 && b >= 0.999);
}

const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });
const hm = (t: unknown) => (t ? String(t).slice(0, 5) : null);

/** 컷오버보다 늦게 시작하도록 이미 예약된 슬롯 — 새로 넣는 행의 `valid_to` 상한(앱과 같은 규약). */
type PendingLater = { classId: string; day: DayOfWeek; startTime: string; validFrom: string };
const slotKey = (x: { classId: string; day: string; startTime: string }) => `${x.classId}|${x.day}|${x.startTime}`;

async function loadContext(): Promise<{
  ctx: ExistingContext;
  existing: ExistingSchedule[];
  pendingLater: PendingLater[];
}> {
  const [classes, users, rooms, sched] = await Promise.all([
    sql`select id, class_name, subject, teacher_id, classroom_id from classes
        where tenant_id = ${TENANT} and subject = ${SUBJECT} and is_active = true`,
    sql`select id, display_name, english_name, system_role from users
        where tenant_id = ${TENANT} and status = 'active'`,
    sql`select id, name from classrooms where tenant_id = ${TENANT}`,
    sql`select cs.id, cs.class_id, cs.day_of_week, cs.start_time, cs.end_time, cs.teacher_id,
               cs.classroom_id, cs.slot_teacher_label, cs.slot_room_label, cs.merge_group,
               cs.valid_from::text as valid_from, cs.valid_to::text as valid_to, c.class_name
        from class_schedules cs join classes c on c.id = cs.class_id
        where c.tenant_id = ${TENANT} and c.subject = ${SUBJECT} and c.is_active = true
          and (cs.valid_to is null or cs.valid_to >= ${CUTOVER}::date)`,
  ]);
  // 🔴 유효 판정은 "지금 열려 있나"가 아니라 **컷오버 시점 기준**이다(앱 loadStructureContext와 같은 규약).
  //    옛 코드(`valid_to is null`)는 ① 컷오버 뒤에 끝나도록 이미 마감된 행을 놓쳐 같은 슬롯을 또 만들고,
  //    ② 컷오버보다 늦게 시작하는 예약 행을 마감 대상에 넣어 0231a가 그걸 **삭제**하게 만든다.
  const asOf = (v: unknown) => String(v).slice(0, 10);
  const live = sched.filter((s) => asOf(s.valid_from) <= CUTOVER);
  const pendingLater: PendingLater[] = sched
    .filter((s) => asOf(s.valid_from) > CUTOVER)
    .map((s) => ({
      classId: s.class_id, day: s.day_of_week as DayOfWeek,
      startTime: hm(s.start_time)!, validFrom: asOf(s.valid_from),
    }));
  return {
    pendingLater,
    ctx: {
      classes: classes.map((c) => ({
        id: c.id, className: c.class_name, subject: c.subject,
        teacherId: c.teacher_id, classroomId: c.classroom_id,
      })),
      teachers: users.map((u) => ({
        id: u.id, englishName: u.english_name, displayName: u.display_name, systemRole: u.system_role,
      })),
      classrooms: rooms.map((r) => ({ id: r.id, name: r.name })),
    },
    existing: live.map((s) => ({
      id: s.id, classId: s.class_id, className: s.class_name, day: s.day_of_week as DayOfWeek,
      startTime: hm(s.start_time)!, endTime: hm(s.end_time), teacherId: s.teacher_id,
      classroomId: s.classroom_id, slotTeacherLabel: s.slot_teacher_label,
      slotRoomLabel: s.slot_room_label, mergeGroup: s.merge_group,
      validFrom: s.valid_from, validTo: s.valid_to,
    })),
  };
}

// ── 0. 대상 탭 확정 — 이름(--tab/위치인자) > 주소의 gid > 안내 후 중단 ─────────
const tabs = await listTabs();
if (LIST) {
  console.log(`스프레드시트 ${XLSX ? XLSX : MASTER_ID} — 탭 ${tabs.length}개`);
  for (const t of tabs) console.log(`  ${XLSX ? "" : `gid=${String(t.gid).padStart(10)} `}"${t.title}"`);
  await sql.end();
  process.exit(0);
}
function resolveTab(): string {
  if (TAB_ARG) {
    if (tabs.some((t) => t.title === TAB_ARG)) return TAB_ARG;
    console.error(`탭 "${TAB_ARG}"을 찾을 수 없습니다. --list 로 목록을 확인하세요.`);
    process.exit(1);
  }
  if (GID !== null && !XLSX) {
    const hit = tabs.find((t) => t.gid === GID);
    if (hit) return hit.title;
    console.error(`gid=${GID} 탭이 없습니다. --list 로 목록을 확인하세요.`);
    process.exit(1);
  }
  console.error("대상 탭을 정하지 못했습니다 — --tab=\"이름\" 또는 gid가 있는 --sheet 주소를 주세요(--list로 확인).");
  process.exit(1);
}
const TAB = resolveTab();

// ── 1. 시트 파싱 ──────────────────────────────────────────────────────────────
const grid = await readMasterGrid(TAB);
const raw = parseTeacherGrid(grid);
// 자리(LAB·JJ)는 담당자 이름이 아니라 **자리 이름으로 굳혀** 저장한다(원장 2026-08-04, canonicalSlotTeacherLabel).
// 시트가 `이주희`(LAB 아르바이트)로 그려도 eywa엔 `LAB` — 담당이 바뀌어도 자리는 그대로다.
// ⚠️ **diff 전에** 정규화해야 한다. 삽입 직전에 바꾸면 diff가 `이주희`(시트) = `이주희`(DB)로 보고
//    'keep' 처리해 새 행 자체를 안 만들어 라벨이 영영 안 바뀐다.
const parsed = {
  ...raw,
  slots: raw.slots.map((s) => ({ ...s, teacherName: canonicalSlotTeacherLabel(s.teacherName) ?? s.teacherName })),
  blocks: raw.blocks.map((b) => ({ ...b, teacherName: canonicalSlotTeacherLabel(b.teacherName) ?? b.teacherName })),
};
const relabeled = raw.slots.filter((s, i) => s.teacherName !== parsed.slots[i]!.teacherName).length;
console.log(`시트 "${grid.tabName}" — 강사블록 ${parsed.teachers.length} · 슬롯 ${parsed.slots.length}`);
if (relabeled) console.log(`  자리 라벨 정규화: ${relabeled}슬롯(담당자 이름 → LAB/JJ)`);
const dayBefore = new Date(`${CUTOVER}T00:00:00Z`);
dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
const CLOSE_AT = dayBefore.toISOString().slice(0, 10);
console.log(`컷오버: ~${CLOSE_AT} 옛 배치 마감 · ${CUTOVER}부터 새 배치  ${APPLY ? "【적용】" : "(dry-run)"}`);

// ── 2. 신설 반 생성(화이트리스트만) ───────────────────────────────────────────
const sheetNames = new Set(parsed.slots.map((s) => s.className));
for (const w of parsed.warnings) console.log(`  · ${w}`);
for (const name of [...NEW_CLASSES_TO_CREATE, ...EXTRA_NEW_CLASSES]) {
  if (!sheetNames.has(name)) {
    console.log(`  ⏭ 신설 예정 반 "${name}"이 이 탭에 없음 — 건너뜀`);
    continue;
  }
  // ⚠️ 폐지된(is_active=false) 동명 반이 있으면 **되살린다** — 새로 만들면 그 반의 과거 수강·성적이
  //    새 id와 갈라져 이력이 끊긴다(실측: "중고E_중2 최상위"는 과거 수강 7건을 가진 폐지 반이었다).
  const [dup] = await sql<{ id: string; is_active: boolean }[]>`select id, is_active from classes
    where tenant_id = ${TENANT} and subject = ${SUBJECT} and replace(class_name, ' ', '') = replace(${name}, ' ', '')`;
  if (dup?.is_active) { console.log(`  ⏭ 반 "${name}" 이미 활성 — 건너뜀`); continue; }
  if (dup) {
    if (!APPLY) { console.log(`  [dry] 폐지 반 재활성: "${name}" (${dup.id}) — 과거 수강 이력 보존`); continue; }
    await sql`update classes set is_active = true where id = ${dup.id} and tenant_id = ${TENANT}`;
    console.log(`  ✓ 폐지 반 재활성: "${name}" (${dup.id})`);
    continue;
  }
  if (!APPLY) { console.log(`  [dry] 반 신규 생성: "${name}"`); continue; }
  const [row] = await sql`insert into classes (tenant_id, class_name, subject, is_active)
    values (${TENANT}, ${name}, ${SUBJECT}, true) returning id`;
  console.log(`  ✓ 반 신규 생성: "${name}" (${row!.id})`);
}

// ── 3. 매칭 + diff (반 생성 후 다시 읽어야 새 반이 해석된다) ──────────────────
const { ctx, existing, pendingLater } = await loadContext();
const match = matchStructure(parsed, ctx);
const report = computeStructureDiff(match, existing);

console.log(`\n매칭: 반 ${match.matchedClasses} · 강사 ${match.matchedTeachers} · 방 ${match.matchedRooms}`);
// 버려진 이름 = 색은 칠해졌는데 DB에 없는 이름. 슬롯 수를 함께 보여준다 — **메모는 보통 1~2칸,
// 진짜 반은 6칸 이상**(주 6교시)이라 사람이 한눈에 가려낼 수 있다. 진짜 반이면 NEW_CLASSES_TO_CREATE에.
const slotsByName = parsed.slots.reduce<Map<string, number>>((m, s) => m.set(s.className, (m.get(s.className) ?? 0) + 1), new Map());
const dropped = match.newClassNames;
if (dropped.length) {
  console.log(`  버려진 이름 ${dropped.length}건(DB에 없어 반 생성 안 함 — 슬롯 6칸+면 진짜 반일 수 있으니 확인):`);
  console.log(`    ${dropped.map((n) => `${n}(${slotsByName.get(n) ?? 0})`).join(" / ")}`);
}
console.log(`계획: 생성 ${report.plan.create} · 변경 ${report.plan.update} · 유지 ${report.plan.keep} · 마감 ${report.plan.remove}`);

// ── 3-b. 적용 후 배치가 물리적으로 성립하는가 — 앱 '시트에서 가져오기'와 **같은 판정**(conflicts.ts).
//    자리(LAB·JJ)는 제외되고, 합반(같은 강사·같은 방)은 경고일 뿐 막지 않는다(원장 2026-08-28).
const mustAck = conflictChecklist(report.conflicts);
if (report.conflicts.length) {
  console.log(`
충돌 ${report.conflicts.length}건 (확인 필요 ${mustAck.length}건)`);
  for (const c of report.conflicts) {
    const tag = !blocksApply(c.kind) ? "합반(경고)" : c.touched ? "확인필요" : "옛충돌";
    console.log(`  [${tag}] ${describeConflict(c)}`);
  }
}
if (APPLY && mustAck.length > 0 && !ACK_CONFLICTS) {
  console.error(
    `
중단: 이번 변경이 만든 물리적 충돌 ${mustAck.length}건을 확인해야 적용할 수 있습니다.` +
      `
  시트를 고쳐 다시 돌리거나, 의도한 배치라면 --ack-conflicts 를 붙이세요.` +
      `
  (배치는 하나도 안 썼습니다. 위의 반 생성·재활성만 이미 반영됐을 수 있습니다.)`,
  );
  await sql.end();
  process.exit(1);
}

// ── 비수업 블록(감독·준비·회의·연차) — 반이 아니라 teacher_schedule_blocks(0138a) ─────────────
// 수업 슬롯과 **같은 날짜 경계**로 갈아끼운다: 기존 유효행 마감(valid_to=컷오버−1) + 신규 삽입(valid_from=컷오버).
// 삭제하지 않아 타임머신 보존. 강사뷰 렌더 전용이라 수강·청구·급여 어디에도 영향 없다.
// ⚠️ 배치 변경이 0건이어도 블록은 따로 갈아끼운다 — 둘은 독립이다(수업은 그대로인데 감독만 바뀔 수 있다).
async function syncBlocks(): Promise<void> {
  const byKind = parsed.blocks.reduce<Record<string, number>>((a, b) => ({ ...a, [b.kind]: (a[b.kind] ?? 0) + 1 }), {});
  const summary = Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(" · ") || "없음";
  if (!APPLY) {
    console.log(`  [dry] 비수업 블록 ${parsed.blocks.length}건 교체 예정 — ${summary}`);
    return;
  }
  const labelToId = new Map<string, string>();
  for (const t of ctx.teachers) {
    if (t.englishName) labelToId.set(t.englishName.toLowerCase(), t.id);
    labelToId.set(t.displayName.toLowerCase(), t.id);
  }
  await sql.begin(async (tx) => {
    // ⚠️ 같은 컷오버 날짜로 **재실행**할 수 있어야 한다(파서 고치고 다시 돌리는 게 정상 경로다).
    // ① 이번 컷오버가 만든 행(valid_from >= CUTOVER)은 **삭제** — 재생성 대상이다. 마감으로 처리하면
    //    valid_to(=CUTOVER−1) < valid_from 이라 valid_order 제약에 걸려 트랜잭션이 통째로 터진다
    //    (2026-07-22 실측: 재실행이 여기서 죽었다). ② 그 이전 행만 마감한다.
    const [del] = await tx<{ count: number }[]>`
      with d as (
        delete from public.teacher_schedule_blocks
         where tenant_id = ${TENANT} and subject = ${SUBJECT} and valid_from >= ${CUTOVER}::date
        returning 1
      ) select count(*)::int as count from d`;
    const [row] = await tx<{ count: number }[]>`
      with upd as (
        update public.teacher_schedule_blocks
           set valid_to = ${CLOSE_AT}::date
         where tenant_id = ${TENANT} and subject = ${SUBJECT}
           and valid_from < ${CUTOVER}::date
           and (valid_to is null or valid_to >= ${CUTOVER}::date)
        returning 1
      ) select count(*)::int as count from upd`;
    if (del!.count > 0) console.log(`  (재실행) 같은 컷오버로 만든 블록 ${del!.count}건 삭제 후 재생성`);
    for (const b of parsed.blocks) {
      await tx`insert into public.teacher_schedule_blocks
        (tenant_id, subject, teacher_label, teacher_id, day_of_week, start_time, end_time, kind, label, valid_from)
        values (${TENANT}, ${SUBJECT}, ${b.teacherName},
                ${labelToId.get(b.teacherName.toLowerCase()) ?? null},
                ${b.day}::public.day_of_week, ${b.startTime}::time, ${b.endTime}::time,
                ${b.kind}, ${b.label}, ${CUTOVER}::date)`;
    }
    console.log(`  비수업 블록 — 마감 ${row!.count} · 삽입 ${parsed.blocks.length}  (${summary})`);
  });
}

// ── 4. payload = applyStructureImport(server action)과 동일 구조 ──────────────
const changeItems = report.planItems.filter((p) => p.action !== "keep");
if (changeItems.length === 0) {
  // 배치가 같아도 **비수업 블록은 따로** 갈아끼운다 — 수업은 그대로인데 감독만 바뀔 수 있다(독립).
  console.log("\n배치 변경 없음 — 시트와 일치합니다.");
  await syncBlocks();
  await sql.end();
  process.exit(0);
}
const validToById = new Map(existing.map((e) => [e.id, e.validTo]));
const closes = report.planItems
  .filter((p) => (p.action === "update" || p.action === "remove") && p.scheduleId)
  .map((p) => ({ id: p.scheduleId!, prevValidTo: validToById.get(p.scheduleId!) ?? null }));
// 같은 칸에 **더 늦은 날짜로 예약된 배치**가 있으면 새 행을 그 하루 전까지만 연다 — 안 닫으면 그
// 예약일부터 옛/새 행이 둘 다 살아 같은 칸이 두 번 그려진다(앱 applyStructureImport와 같은 규약, 0231a).
const laterByKey = new Map<string, string>();
for (const r of pendingLater) {
  const k = slotKey(r);
  const cur = laterByKey.get(k);
  if (cur === undefined || r.validFrom < cur) laterByKey.set(k, r.validFrom);
}
const dayBeforeOf = (d: string) => {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
};
const inserts = report.planItems
  .filter((p) => (p.action === "create" || p.action === "update") && p.classId)
  .map((p) => ({
    id: randomUUID(),
    classId: p.classId!,
    validTo: (() => {
      const until = laterByKey.get(slotKey({ classId: p.classId!, day: p.day, startTime: p.startTime }));
      return until ? dayBeforeOf(until) : null;
    })(),
    day: p.day,
    startTime: p.startTime,
    endTime: p.endTime,
    teacherId: p.teacherId ?? null,
    classroomId: p.classroomId ?? null,
    slotTeacherLabel: p.teacherNames[0] ?? null,
    slotRoomLabel: p.room,
  }));
const changedClassIds = new Set(
  report.planItems.filter((p) => p.action !== "keep" && p.classId).map((p) => p.classId!),
);
const classUpdates = buildClassUpdates(match, ctx, changedClassIds);
const payload = {
  label: `영어 마스터시트 컷오버 ${CUTOVER} (${grid.tabName})`,
  hash: report.hash,
  summary: report.plan,
  closes,
  inserts,
  classUpdates,
  planItems: report.planItems,
};
console.log(`쓰기 예정: 마감 ${closes.length}행 · 삽입 ${inserts.length}행 · 반 갱신 ${classUpdates.length}건 · 비수업 블록 ${parsed.blocks.length}건`);

if (!APPLY) {
  console.log("\n(dry-run — 쓰기 없음. 실제 반영은 --apply)");
  await sql.end();
  process.exit(0);
}

// ── 5. 적용 (앱과 동일 RPC · 스냅샷/롤백 포함) ────────────────────────────────
// RPC는 security invoker + auth_tenant_id() → 스크립트 연결엔 JWT 클레임을 주입해야 테넌트가 잡힌다.
const [res] = await sql.begin(async (tx) => {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ACTOR, role: "authenticated" })}, true)`;
  // ⚠️ **반드시 `sql.json(...)`** — gotcha #82. `${JSON.stringify(payload)}::jsonb`로 바꿨더니 postgres.js가
  // jsonb **문자열**로 넣어 `payload->'inserts'`가 null이 됐고, RPC 세 루프가 전부 0회 돌아 **조용히 아무것도
  // 안 썼다**(2026-07-22 실측: 마감 0·삽입 0·반갱신 0인데 에러는 없음). 객체라도 예외가 아니다.
  // 타입만 안 맞아 캐스팅한다(런타임은 검증됨 — 이 경로로 마감 108·삽입 64가 실제로 적용됐다).
  return tx`select public.apply_english_structure(${sql.json(payload as never)}::jsonb, ${CUTOVER}::date) as r`;
});
const r = (res as { r: { snapshotId: string; closed: number; inserted: number; classUpdated: number } }).r;
console.log(`\n✅ 적용 완료 — 마감 ${r.closed} · 삽입 ${r.inserted} · 반 갱신 ${r.classUpdated}`);
console.log(`   되돌리기: select public.rollback_english_structure('${r.snapshotId}');`);
await syncBlocks();

// ⚠️ 소급 컷오버의 부작용 점검 — 컷오버 이후에 만들어진 행(valid_from > 마감일)을 마감하면
// valid_to < valid_from 인 **역전 범위**가 된다. 조회식이 둘 다 만족할 수 없어 화면엔 안 보이지만(무해),
// 데이터로는 기형이라 남겨두면 헷갈린다. 자동 삭제는 하지 않는다 — 지우면 스냅샷 롤백이 그 행을 복원 못 한다.
const inverted = await sql<{ id: string; class_name: string; vf: string; vt: string }[]>`
  select cs.id, c.class_name, cs.valid_from::text vf, cs.valid_to::text vt
  from class_schedules cs join classes c on c.id = cs.class_id
  where c.tenant_id = ${TENANT} and c.subject = ${SUBJECT} and cs.valid_to < cs.valid_from`;
if (inverted.length) {
  console.log(`\n⚠️ 역전 범위 ${inverted.length}행 — 컷오버(${CUTOVER}) 뒤에 생성됐던 행을 소급 마감한 결과입니다.`);
  console.log("   화면엔 안 나옵니다(조회식 불만족). 롤백 가능성을 위해 자동 정리하지 않았습니다.");
  for (const x of inverted) console.log(`   · ${x.class_name} (${x.vf} → ${x.vt}) ${x.id}`);
}
await sql.end();
