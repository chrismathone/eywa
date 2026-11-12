/**
 * 원장님 마스터 시트(`2026 영어시간표_인재원 본원`) 강사별 탭 → aywa 배치 **temporal 컷오버**.
 *
 * 배경: 앱의 '시트에서 가져오기'는 **aywa 전용 시트**(`[Aywa 2.0] 영어 시간표`)만 읽는다. 원장님이 실제로
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
import type { ImportDiff } from "../../src/features/timetable/import/types";
import { canonicalSlotTeacherLabel } from "../../src/features/timetable/lib/teacher-label";
import {
  blocksApply,
  conflictChecklist,
  describeConflict,
} from "../../src/features/timetable/import/structure/conflicts";
import { parseIntegratedRoster } from "../../src/features/timetable/import/roster/parse-roster";
import { matchRosterStudent, type RosterStudentRef } from "../../src/features/timetable/import/roster/match-roster";
import {
  computeRosterDiff,
  type RosterDesiredRow,
  type RosterEnrollmentRow,
} from "../../src/features/timetable/import/roster/roster-diff";
import { norm } from "../../src/features/timetable/import/match";
import { enrollmentOnHoldForStatus } from "../../src/features/enrollments/eligibility";
import { resolveSettings } from "../../src/features/owner/resolve";
import { isModuleEnabled } from "../../src/lib/modules";
import { eieTrackWriteError } from "../../src/features/classes/english-track";

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
/**
 * **반별 학생 명단이 있는 탭**(원장 2026-08-29 *"통합영어시간표(9월)에 학생 명단이 있음.
 * 학생 명단을 보고 학생도 전부 이동시켜야함."*). 주면 배치 컷오버에 이어 **명단 이동**까지 한다.
 * 안 주면 종전과 완전히 같다(배치만).
 */
const ROSTER_TAB = opt("roster");
/**
 * 🔴 **명단에서 사라진 학생의 수강 종료는 기본으로 하지 않는다.** 시트에서 빠진 이유가 퇴원인지
 *    누락인지 시트만으론 모르고, 잘못 종료하면 그 학생이 출석부에서 사라진다. 드라이런이 목록을
 *    보여 주고, 사람이 확인한 뒤에만 이 플래그로 연다.
 */
const APPLY_REMOVES = args.includes("--apply-removes");
/**
 * **명단만** 다시 맞춘다 — 배치·비수업 블록·반 이름은 건드리지 않는다(스냅샷도 명단 것 하나만 생긴다).
 *
 * 쓰임새: 컷오버를 이미 걸어 둔 뒤 **한두 명이 늦게 확정될 때**(복학·신규). 컷오버 전체를 다시 돌리면
 * 배치 변경이 0건이라 중단되고, 이름 변경은 이미 예약돼 있어 두 번 걸린다.
 * 🔑 그래도 `--rename`은 **같이 넘겨야 한다** — 시트엔 새 이름(JP3)이 적혀 있는데 DB는 아직 옛 이름
 *    (JP2)이라, 그 다리가 없으면 그 반이 "없는 반"이 되어 명단이 통째로 제외된다.
 * ⚠️ 적용일이 같으면 스냅샷이 같은 날짜 묶음에 붙어 **툴바 배지 × 한 번에 함께** 되돌아간다.
 */
const ROSTER_ONLY = args.includes("--roster-only");
/**
 * 컷오버가 오늘 이하인가 — **미리보기 문구 전용**(예약인지 즉시인지 사람에게 알려 주는 라벨).
 * ⚠️ 실제 판정에 쓰지 말 것: RPC는 UTC `current_date`로 가르는데 여기는 KST라 자정 근처에서 갈린다.
 *    적용 경로는 RPC가 돌려주는 `classUpdatesDeferred`를 본다(단일 소스).
 */
const IMMEDIATE = CUTOVER <= new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
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
 *   · 2026-09-01 컷오버: PL1b(EiE) · 중등E_초6 MED b(인재원)
 * 임시 추가는 `--new-class=A,B` 로도 가능(코드 수정 없이 1회성).
 *
 * 🔴 **이름 뒤에 `:eie` / `:injaewon`으로 프로그램 구분을 함께 적는다**(`--new-class=PL1b:eie`).
 *    안 적으면 `english_track`이 비고, 그 반은 ECS 반 목록·시간표 필터에서 **"EiE가 아닌 전부"** 쪽으로
 *    간다(미분류는 인재원 영어로 통과하는 비대칭 — english-track.ts). 2026-08-29 실측: 그래서 EiE 반
 *    `PL1b`가 '인재원 영어' 단에 서 있었다. 판정은 컬럼뿐이고 **이름으로 추측하지 않으므로**
 *    (반 이름을 고치면 분류가 조용히 뒤집힌다) 만들 때 사람이 적어 주는 것이 유일한 경로다.
 */
type NewClassSpec = { name: string; track: "eie" | "injaewon" | null };
/** 로그에 raw enum을 흘리지 않는다 — `ENGLISH_TRACK_LABEL`과 같은 말을 쓴다. */
const TRACK_LABEL = { eie: "EiE", injaewon: "인재원 영어" } as const;
/** `"PL1b:eie"` → `{ name: "PL1b", track: "eie" }`. 접미사가 없거나 모르는 값이면 이름 전체로 본다. */
function parseNewClass(entry: string): NewClassSpec {
  const i = entry.lastIndexOf(":");
  if (i < 0) return { name: entry.trim(), track: null };
  const t = entry.slice(i + 1).trim().toLowerCase();
  if (t !== "eie" && t !== "injaewon") return { name: entry.trim(), track: null };
  return { name: entry.slice(0, i).trim(), track: t };
}
const NEW_CLASSES_TO_CREATE = [
  "중고E_중2 최상위:injaewon",
  "중등E_중2 정규 D:injaewon",
  "DP6:eie", "JP2:eie", "KW2:eie", "LS3a:eie", "LS3b:eie", "LS6:eie", "LT3:eie", "LT5:eie",
  "MEC1-4:eie", "PJ1:eie", "PJ6:eie", "PL3:eie", "RTT4:eie", "PL1b:eie",
  "중등E_초6 MED b:injaewon",
];
const EXTRA_NEW_CLASSES = (args.find((a) => a.startsWith("--new-class="))?.split("=")[1] ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

/**
 * **반 이름 변경**(원장 2026-08-28 *"자동으로 반이름 변경되게 이력 남길 수 없나"* → *"반이름 변경도 9/1에
 * 예약되도록 시스템화"*). 형식 `--rename="구반:새반,구반2:새반2"` — **적은 순서대로** 적용된다.
 *
 * 🔴 왜 신설이 아니라 이름 변경인가: 레벨 승급은 **같은 아이들이 그대로 올라가는 것**이라, 신설하면 그 반의
 *    수강·성적·출결·보고서 이력이 통째로 끊긴다. 이름만 바꾸면 반 id가 유지돼 전부 그대로 붙어 있다.
 * 🔴 **순서가 중요하다** — 레벨 사다리는 회전한다(실측 2026-09: `LS6→LE1`로 이름을 비운 다음 `LS5→LS6`,
 *    `JP2→JP3` 다음 `PJ1→PJ2`). 거꾸로 하면 이미 쓰는 이름과 부딪친다. 그래서 정렬하지 않고 **입력 순서 보존**.
 * 🔴 매칭에는 **새 이름을 미리 반영**한다(아래 aliasing) — 시트엔 새 이름이 적혀 있는데 DB는 아직 옛 이름이라,
 *    그대로 두면 그 반이 "DB에 없는 이름"으로 버려지고 배치가 통째로 마감돼 버린다.
 * ⚠️ 미래 컷오버면 이름 변경도 **그날로 예약**된다(classUpdates에 실려 스냅샷에만 남고 cron이 재생).
 *    그래서 예약 취소(배지 ×)로 이름 변경까지 함께 없던 일이 된다. 오늘 컷오버면 여기서 즉시 바꾼다.
 */
const RENAMES: { from: string; to: string }[] = (opt("rename") ?? "")
  .split(",")
  .map((pair) => pair.trim())
  .filter(Boolean)
  .map((pair) => {
    const i = pair.lastIndexOf(":"); // 반 이름에 ':'이 들어갈 수 있어 **마지막** 콜론에서 가른다
    if (i <= 0 || i === pair.length - 1) {
      console.error(`--rename 형식이 올바르지 않습니다: "${pair}" (구반:새반)`);
      process.exit(1);
    }
    return { from: pair.slice(0, i).trim(), to: pair.slice(i + 1).trim() };
  });

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
    // 🔴 보관된 강의실은 후보에서 뺀다 — 앱 loadStructureContext와 **같은 규약**(그쪽 주석 참조).
    //    번호만 적힌 시트(`602`)가 폐강의실(`바른602`)에 붙는 사고를 막는다.
    sql`select id, name from classrooms where tenant_id = ${TENANT} and archived_at is null`,
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

/**
 * 마지막으로 읽을 열(A1 문자, 포함). 원장 2026-08-28: *"EU열 뒤로는 필요없어 버려"*.
 *
 * 🔴 왜 필요한가: 9월 탭 **EV2** 머리글이 `이주희 T LAB (603호) / 8/1~8/14` — **8월 구간 블록이
 *    통째로 남아 있다**. 그 안에 옛 반 이름 38칸(LS3a·DP6·JP2…)이 있어, 그대로 읽으면 8월 배치가
 *    9월로 흘러든다. 이름 변경(`--rename`) 뒤엔 대부분 매칭이 안 돼 무시되지만 **이름이 안 바뀐 반
 *    (RTT4·LS6)은 그 옛 블록에서 계속 매칭된다** — 잘라내는 편이 확실하다.
 * ⚠️ 기본값 없음(무제한) — 시트 구조가 바뀌면 이 값도 바뀌므로 **명령줄에 적어 보이게** 둔다.
 * ⚠️ merges·fills도 함께 잘라야 한다(cells만 자르면 색·병합이 없는 열을 가리켜 판정이 어긋난다).
 */
const MAX_COL = (() => {
  const v = opt("max-col");
  if (!v) return null;
  if (!/^[A-Za-z]{1,3}$/.test(v)) {
    console.error(`--max-col 형식이 올바르지 않습니다: "${v}" (A1 열 문자, 예: EU)`);
    process.exit(1);
  }
  let n = 0;
  for (const ch of v.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1; // 0-based, 포함
})();
function clipGrid(g: SheetGrid): SheetGrid {
  if (MAX_COL === null) return g;
  const end = MAX_COL + 1;
  const widest = g.cells.reduce((a, r) => Math.max(a, r.length), 0);
  if (widest > end) console.log(`  ${opt("max-col")!.toUpperCase()}열까지만 읽음 — 오른쪽 ${widest - end}열 무시(8월 잔재 블록).`);
  return {
    ...g,
    cells: g.cells.map((r) => r.slice(0, end)),
    merges: g.merges.filter((m) => m.startColumnIndex < end).map((m) => ({ ...m, endColumnIndex: Math.min(m.endColumnIndex, end) })),
    ...(g.fills ? { fills: g.fills.map((r) => r.slice(0, end)) } : {}),
  };
}
const grid = clipGrid(await readMasterGrid(TAB));
const raw = parseTeacherGrid(grid);
// 자리(LAB·JJ)는 담당자 이름이 아니라 **자리 이름으로 굳혀** 저장한다(원장 2026-08-04, canonicalSlotTeacherLabel).
// 시트가 `이주희`(LAB 아르바이트)로 그려도 aywa엔 `LAB` — 담당이 바뀌어도 자리는 그대로다.
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

// ── 1-b. 명단 파싱 + 인원 검산 — 🔴 **어떤 쓰기보다도 먼저** ────────────────────
// 적대 리뷰(2026-08-29)에서 잡힌 것: 검산 중단을 planRoster 안에 두면 그보다 **먼저** 도는
// 신설 반 생성(`insert into classes`)이 이미 써 버린 뒤에 멈춘다. 검산은 시트를 잘못 읽었다는
// 신호라, 그 상태로 만든 반이 남으면 사람이 치워야 한다. 그래서 읽기 단계에서 끝낸다.
const rosterParsed = ROSTER_TAB
  ? await (async () => {
      const rGrid = await readMasterGrid(ROSTER_TAB);
      const r = parseIntegratedRoster(rGrid.cells);
      const n = r.blocks.reduce((acc, b) => acc + b.entries.length, 0);
      console.log(`명단 탭 "${ROSTER_TAB}" — 반 ${r.blocks.length} · 학생 ${n}명`);
      if (r.mismatches.length) {
        console.error(`❌ 인원 검산 불일치 ${r.mismatches.length}건 — 중단합니다(아무것도 쓰지 않음):`);
        for (const m of r.mismatches)
          console.error(`   · ${m.className}: 파싱 ${m.parsed}명 ≠ 시트 '인원' ${m.declared}명`);
        await sql.end();
        process.exit(1);
      }
      return r;
    })()
  : null;

// ── 2. 신설 반 생성(화이트리스트만) ───────────────────────────────────────────
const sheetNames = new Set(parsed.slots.map((s) => s.className));
const newClassSpecs = (ROSTER_ONLY ? [] : [...NEW_CLASSES_TO_CREATE, ...EXTRA_NEW_CLASSES]).map(parseNewClass);
const requestedNewClasses = newClassSpecs.filter(({ name }) => sheetNames.has(name));
const requestedEieNames = requestedNewClasses.filter(({ track }) => track === "eie").map(({ name }) => name);
if (requestedEieNames.length > 0) {
  // 🔴 일반판 기본값은 저장 JSON에 `modules`가 없을 수 있다. raw 배열만 읽지 말고 앱과 같은 프리셋 병합을 거쳐야
  // `{ preset: "generic" }`인 지점을 침산(전부 켬)으로 잘못 판정하지 않는다.
  const [stored] = await sql<{ data: unknown }[]>`
    select data from tenant_settings where tenant_id = ${TENANT}`;
  const settings = resolveSettings(stored?.data ?? null, { name: "" });
  const trackError = eieTrackWriteError(isModuleEnabled(settings.modules.disabled, "eie"), "eie");
  if (trackError) {
    console.error(`❌ 대상 지점의 EiE 모듈이 꺼져 있어 :eie 반 구분을 적용할 수 없습니다(아무것도 쓰지 않음): ${requestedEieNames.join(" · ")}`);
    await sql.end();
    process.exit(1);
  }
}
// 드라이런에서 "만들었을 반" — 🔴 미리보기가 **사실을 말하게** 하려면 이게 필요하다. 신설 반은 --apply
// 에서만 실제로 생기므로, 넣지 않으면 드라이런의 ctx에 그 반이 없어 명단 블록이 통째로 제외되고
// (그 반으로 갈 학생들이 안 보인다) 원래 반에 남은 것으로 읽혀 **종료후보가 부풀려진다**(실측 9명·+9건).
const dryCreated: string[] = [];
const dryRevived: { id: string; name: string }[] = [];
/** 이번 실행이 **만들거나 되살린** 반 — 끝에서 빈 칸(담임·프로그램 구분)을 되짚는다. */
const touchedClassIds: string[] = [];
for (const w of parsed.warnings) console.log(`  · ${w}`);
// --roster-only는 반을 만들지 않는다 — 명단만 맞추는 모드에서 반이 새로 생기면 놀란다.
for (const { name, track } of newClassSpecs) {
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
    // ⚠️ 재활성도 --apply에서만 일어난다 — 미리보기에 안 넣으면 그 반 명단이 통째로 제외된다(신규 생성과 같은 함정).
    if (!APPLY) { console.log(`  [dry] 폐지 반 재활성: "${name}" (${dup.id}) — 과거 수강 이력 보존`); dryRevived.push({ id: dup.id, name }); continue; }
    // ⚠️ 되살린 반의 프로그램 구분은 **비어 있을 때만** 채운다 — 이미 값이 있으면 그게 사람이 정한 것이다.
    await sql`update classes set is_active = true, english_track = coalesce(english_track, ${track})
      where id = ${dup.id} and tenant_id = ${TENANT}`;
    console.log(`  ✓ 폐지 반 재활성: "${name}" (${dup.id})`);
    touchedClassIds.push(dup.id);
    continue;
  }
  if (!APPLY) {
    console.log(`  [dry] 반 신규 생성: "${name}"${track ? ` [${TRACK_LABEL[track]}]` : " ⚠️ 프로그램 구분 미지정"}`);
    dryCreated.push(name);
    continue;
  }
  const [row] = await sql<{ id: string }[]>`insert into classes (tenant_id, class_name, subject, is_active, english_track)
    values (${TENANT}, ${name}, ${SUBJECT}, true, ${track}) returning id`;
  console.log(`  ✓ 반 신규 생성: "${name}" (${row!.id})${track ? ` [${TRACK_LABEL[track]}]` : ""}`);
  touchedClassIds.push(row!.id);
}

// 🔴 **만들어 놓고 반쯤 빈 반을 조용히 남기지 않는다**(2026-08-29 원장 제보 *"9/1 미래주차 이동시에
//    담임미지정건은 왜 그렇지?"*). 시트엔 담임 줄이 없어 신설 반은 **항상** 담임이 빈 채로 태어나는데,
//    가져오기의 담임 자동채움(교시 강사 최빈값)은 자리 칸(LAB·JJ)까지 사람과 같이 세기 때문에
//    자리가 최다이거나 동률이면 "모호"로 떨어져 끝내 안 채워진다(PL1b = LAB 6칸 최다,
//    중등E_초6 MED b = Song 2 : JJ 2 동률). 그러면 그 반 학생들은 담임 없이 개강한다.
//    ⚠️ 여기서 담임을 **추측해 넣지는 않는다** — 이 학원은 담임과 교시 강사가 원래 다르고(실측: 자리
//    칸을 후보에서 빼면 기존 13개 반의 담임이 뒤집힌다), 담임은 사람이 정하는 자리다. 알리기만 한다.
if (APPLY && touchedClassIds.length > 0) {
  const gaps = await sql<{ class_name: string; teacher_id: string | null; english_track: string | null }[]>`
    select class_name, teacher_id, english_track from classes
     where tenant_id = ${TENANT} and id = any(${touchedClassIds}::uuid[])
       and (teacher_id is null or english_track is null)
     order by class_name`;
  if (gaps.length > 0) {
    console.log(`\n⚠️ 신설·재활성 반 ${gaps.length}개에 빈 칸이 있습니다 — 반 상세 → 수정에서 채우세요:`);
    for (const g of gaps) {
      const miss: string[] = [];
      if (!g.teacher_id) miss.push("담임");
      if (!g.english_track) miss.push("프로그램 구분");
      console.log(`   · ${g.class_name} — ${miss.join(" · ")} 없음`);
    }
    console.log(`   담임은 **한국인 강사 중 그 반에 가장 많이 들어가는 사람**으로 정합니다`);
    console.log(`   (원장 2026-08-29 — 원어민은 담임을 맡지 않습니다).`);
    console.log(`   담임이 비면 영어 강사 시트에서 '담임 미지정'으로 묶이고,`);
    console.log(`   프로그램 구분이 비면 EiE 반이라도 '인재원 영어' 쪽에 섭니다(미분류는 EiE가 아닌 쪽으로 갑니다).`);
  }
}

// ── 3. 매칭 + diff (반 생성 후 다시 읽어야 새 반이 해석된다) ──────────────────
const { ctx, existing, pendingLater } = await loadContext();
// 🔴 드라이런 전용 — 위에서 "만들었을" 반을 ctx에 가짜로 얹는다. id는 randomUUID라 만에 하나 쓰기
//    경로로 새면 FK 위반으로 **시끄럽게** 실패한다(조용히 엉뚱한 반에 넣히지 않는다). --apply는 이 분기를 안 탄다.
if (!APPLY && (dryCreated.length || dryRevived.length)) {
  for (const name of dryCreated)
    ctx.classes.push({ id: randomUUID(), className: name, subject: SUBJECT, teacherId: null, classroomId: null });
  for (const r of dryRevived)
    ctx.classes.push({ id: r.id, className: r.name, subject: SUBJECT, teacherId: null, classroomId: null });
  const names = [...dryCreated, ...dryRevived.map((r) => r.name)];
  console.log(`  (dry) 신설·재활성 예정 반 ${names.length}개를 미리보기에 반영: ${names.join(" · ")}`);
}

// ── 3-a. 반 이름 변경(--rename) — **매칭 전에 가상 적용**한다 ────────────────────
// 시트엔 새 이름(LS4a)이 적혀 있는데 DB는 아직 옛 이름(LS3a)이다. 그대로 매칭하면 그 반이
// "DB에 없는 이름"으로 버려지고 **옛 반의 배치가 통째로 마감**된다 — 이름만 바꾸려다 반을 비우는 셈.
// 그래서 여기서 ctx의 이름을 새 이름으로 갈아 끼워 매칭시키고, **실제 DB 변경은 뒤로 미룬다**
// (미래 컷오버면 cron이, 오늘 컷오버면 이 스크립트가 RPC 성공 뒤에).
const renamePlan: { classId: string; from: string; to: string }[] = [];
if (RENAMES.length) {
  // 순차 시뮬레이션 — 사다리 회전(LS6→LE1 뒤 LS5→LS6)이 정상 경로라 **적은 순서 그대로** 검사한다.
  const nameToId = new Map(ctx.classes.map((c) => [c.className, c.id]));
  // 🔴 **폐지된 반도 이름을 붙들고 있다**(2026-08-29 실측으로 확인). 유니크 인덱스
  //    `classes_tenant_name_subject_idx (tenant_id, class_name, subject)`엔 `WHERE is_active`가 **없어서**,
  //    지난 학기 종강 반이 쥔 이름으로는 개명이 **23505로 거절**된다. 그런데 이 검사가 활성 반만 보고
  //    있어서 예약은 성사되고, 정작 그날 cron이 그 항목에서만 실패한다 — 게다가 cron은 실패해도
  //    '적용함' 표식을 남겨 **다시 시도하지 않는다**(9/1 실측 시뮬: 17건 중 PJ1·KW2 영구 미적용).
  //    ⚠️ 이 학원은 레벨 사다리가 해마다 회전해 이름이 재활용된다 — 비활성이 쥔 영어 반 이름이 19개다.
  const heldByInactive = new Map(
    (
      await sql<{ id: string; class_name: string; closed_at: string | null }[]>`
        select id, class_name, closed_at::text from classes
         where tenant_id = ${TENANT} and subject = ${SUBJECT} and is_active = false`
    ).map((c) => [c.class_name, c]),
  );
  for (const r of RENAMES) {
    const id = nameToId.get(r.from);
    if (!id) {
      console.error(`--rename 중단: "${r.from}" 이라는 활성 영어 반이 없습니다(이미 바꿨거나 오타).`);
      await sql.end();
      process.exit(1);
    }
    const dead = heldByInactive.get(r.to);
    if (dead && dead.id !== id) {
      console.error(
        `--rename 중단: "${r.to}" 는 **폐지된 반**이 이미 쓰고 있습니다(id ${dead.id.slice(0, 8)}, 종강 ${dead.closed_at ?? "-"}).
` +
          `  반 이름 유니크 인덱스엔 is_active 조건이 없어 개명이 DB에서 거절됩니다.
` +
          `  그 폐지 반의 이름을 먼저 비우세요(예: "${r.to} (~${(dead.closed_at ?? "").slice(0, 7)})").`,
      );
      await sql.end();
      process.exit(1);
    }
    const taken = nameToId.get(r.to);
    if (taken && taken !== id) {
      console.error(
        `--rename 중단: "${r.to}" 는 이미 다른 반이 쓰고 있습니다. 그 반을 먼저 비우도록 순서를 바꾸세요` +
          ` (예: "${r.to}:다른이름"을 앞에 두기).`,
      );
      await sql.end();
      process.exit(1);
    }
    nameToId.delete(r.from);
    nameToId.set(r.to, id);
    renamePlan.push({ classId: id, from: r.from, to: r.to });
  }
  // 가상 적용 — ctx(매칭 대상)와 existing(충돌 메시지의 반 이름)을 함께 갈아 끼운다.
  const newNameById = new Map(renamePlan.map((r) => [r.classId, r.to]));
  for (const c of ctx.classes) {
    const n = newNameById.get(c.id);
    if (n) c.className = n;
  }
  for (const e of existing) {
    const n = newNameById.get(e.classId);
    if (n) e.className = n;
  }
  console.log(`
반 이름 변경 ${renamePlan.length}건 (${APPLY ? (IMMEDIATE ? "지금 적용" : `${CUTOVER} 예약`) : "dry-run"})`);
  for (const r of renamePlan) console.log(`  ${r.from} → ${r.to}`);
}

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

// ── 3-b. 명단 이동(--roster) ─────────────────────────────────────────────────
// 원장 2026-08-29: *"통합영어시간표(9월)에 학생 명단이 있음. 학생 명단을 보고 학생도 전부 이동시켜야함."*
//
// 🔴 쓰기는 **앱의 적용 경로와 같은 재료**를 쓴다 — 스냅샷(`timetable_snapshots`) + 반이동 RPC
//    (`move_enrollments_batch` 0228a/0235a) + 이력(`timetable_import_logs`). 직접 insert/update로
//    흉내 내면 `attendance_days`(분리등원)·`on_hold`(휴원) 승계와 **되돌리기**가 통째로 빠진다.
// 🔴 스냅샷 payload는 `ImportDiff` **그대로**여야 한다 — `groupScheduledImports`가 payload에 `kind`가
//    있으면 배치, 없으면 반이동으로 가른다. 그래야 툴바 배지 ×가 배치와 명단을 **함께** 되돌린다.
// ⚠️ 계획(읽기)과 적용(쓰기)을 나눈 이유: 명단이 이상하면 **배치를 쓰기 전에** 멈춰야 하기 때문이다.

type RosterPlan = {
  diff: ImportDiff;
  /** 적용하지 않고 사람에게 넘기는 것들(퇴원·미매칭·모호·반 미해석). */
  excluded: string[];
};

async function planRoster(): Promise<RosterPlan | null> {
  if (!ROSTER_TAB) return null;
  console.log(`\n── 명단 이동 — 탭 "${ROSTER_TAB}" ───────────────────────────────`);
  const roster = rosterParsed!;

  const [studentRows, enrollRows] = await Promise.all([
    sql<{ id: string; name: string; school: string | null; grade: string | null; status: string | null }[]>`
      select id, name, school, grade, status from students where tenant_id = ${TENANT}`,
    sql<{ id: string; student_id: string; class_id: string; class_name: string; student_name: string }[]>`
      select e.id, e.student_id, e.class_id, c.class_name, s.name as student_name
        from enrollments e
        join classes c on c.id = e.class_id
        join students s on s.id = e.student_id
       where e.tenant_id = ${TENANT} and c.subject = ${SUBJECT} and c.is_active = true
         and e.start_date <= ${CUTOVER}::date
         and (e.end_date is null or e.end_date > ${CUTOVER}::date)`,
  ]);
  const students: RosterStudentRef[] = studentRows.map((s) => ({
    studentId: s.id, name: s.name, school: s.school, grade: s.grade, status: s.status,
  }));
  const current: RosterEnrollmentRow[] = enrollRows.map((e) => ({
    enrollmentId: e.id, studentId: e.student_id, studentName: e.student_name,
    classId: e.class_id, className: e.class_name,
  }));
  console.log(`  DB: ${CUTOVER} 기준 영어 수강 ${current.length}건`);

  // 반 이름 → id. ⚠️ `ctx.classes`는 **이름 변경이 이미 가상 적용된** 상태다(3-a) — 시트엔 새 이름이,
  //    DB엔 아직 옛 이름이 있으므로 이 맵이 유일하게 옳은 다리다.
  const idByClassName = new Map<string, string>();
  for (const c of ctx.classes) idByClassName.set(norm(c.className), c.id);

  const desired: RosterDesiredRow[] = [];
  const excluded: string[] = [];
  const excludedStudentIds = new Set<string>();
  const removableClassIds = new Set<string>();
  const weakBasis: string[] = [];

  for (const block of roster.blocks) {
    const classId = idByClassName.get(norm(block.className));
    if (!classId) {
      // 🔴 반을 못 찾으면 그 블록 전원을 **건드리지 않는다**(removableClassIds에도 안 넣는다) —
      //    넣으면 그 반 학생들이 종료 후보가 된다.
      excluded.push(`반 "${block.className}"(${block.entries.length}명) — 활성 영어 반에 없음`);
      continue;
    }
    removableClassIds.add(classId);
    for (const entry of block.entries) {
      const m = matchRosterStudent(entry.name, entry.school, entry.grade, students);
      if (m.status === "none") {
        excluded.push(`${entry.name}(${entry.raw}) → ${block.className}: 학생 미매칭`);
        continue;
      }
      if (m.status === "ambiguous") {
        excluded.push(
          `${entry.name}(${entry.raw}) → ${block.className}: 동명이인 ${m.candidates.length}명 모호` +
            ` [${m.candidates.map((c) => `${c.name}/${c.school ?? "?"}${c.grade ?? ""}/${c.status ?? "?"}`).join(" · ")}]`,
        );
        // 🔴 후보 **전원**을 종료 대상에서 뺀다 — 누가 그 사람인지 모른다는 건 "그만뒀다"가 아니다.
        //    빼지 않으면 그 학생이 명단에 있는데도 수강이 끝난다(조용한 퇴출, [[#77]]의 결).
        for (const c of m.candidates) excludedStudentIds.add(c.studentId);
        continue;
      }
      const hit = students.find((s) => s.studentId === m.studentId)!;
      // 🔴 퇴원 학생은 **자동으로 되살리지 않는다**(원장 방침: 학생 상태를 자동으로 바꾸는 경로는 안 만든다).
      if (hit.status === "withdrawn") {
        excluded.push(`${entry.name}(${entry.raw}) → ${block.className}: DB 퇴원 상태 — 사람이 확인 후 복구`);
        excludedStudentIds.add(hit.studentId);
        continue;
      }
      if (m.basis !== "unique") weakBasis.push(`${entry.name}(${entry.raw}) → ${hit.name} [${m.basis}]`);
      desired.push({
        studentId: hit.studentId, studentName: entry.name,
        school: entry.school, grade: entry.grade,
        classId, className: block.className,
      });
    }
  }

  const diff = computeRosterDiff(desired, current, removableClassIds);
  // 퇴원·미매칭으로 뺀 학생이 종료 후보로 넘어가지 않게 한다 — 뺀 것이 곧 "그만둔다"는 뜻은 아니다.
  const dropped = diff.removes.filter((r) => {
    const row = current.find((c) => c.enrollmentId === r.enrollmentId);
    return row ? excludedStudentIds.has(row.studentId) : false;
  });
  if (dropped.length) {
    diff.removes = diff.removes.filter((r) => !dropped.includes(r));
    for (const r of dropped)
      diff.warnings.push(`"${r.studentName}"(${r.className})은 위 제외 목록에 있어 종료하지 않았습니다.`);
  }

  console.log(
    `\n  변경: 이동 ${diff.moves.length} · 추가 ${diff.adds.length} · 종료후보 ${diff.removes.length} · 그대로 ${diff.unchanged}`,
  );
  for (const m of diff.moves) console.log(`    ↪ ${m.studentName}: ${m.fromClassName} → ${m.toClassName}`);
  for (const a of diff.adds) console.log(`    ＋ ${a.studentName}(${a.school ?? "?"} ${a.grade ?? ""}) → ${a.className}`);
  for (const r of diff.removes) console.log(`    － ${r.studentName}: ${r.className} 수강 종료`);
  if (weakBasis.length) {
    console.log(`\n  ⚠️ 이름 완전일치가 아니어서 다른 근거로 고른 ${weakBasis.length}명 — 눈으로 확인하세요:`);
    for (const w of weakBasis) console.log(`     · ${w}`);
  }
  if (diff.warnings.length) {
    console.log(`\n  경고 ${diff.warnings.length}건:`);
    for (const w of diff.warnings) console.log(`     · ${w}`);
  }
  if (excluded.length) {
    console.log(`\n  ⛔ 적용 제외 ${excluded.length}건(사람이 처리):`);
    for (const e of excluded) console.log(`     · ${e}`);
  }
  if (diff.removes.length && !APPLY_REMOVES) {
    console.log(`\n  ℹ️ 종료후보 ${diff.removes.length}건은 **적용하지 않습니다**(기본값). 확인 후 --apply-removes 로 여세요.`);
  }
  // 🔴 제외가 남은 채로 종료를 열지 않는다 — 제외는 "시트와 DB를 아직 못 이었다"는 뜻이고,
  //    종료는 바로 그 미완성이 피해로 바뀌는 자리다(이름을 못 읽은 학생이 명단에 있는데도 잘린다).
  if (APPLY_REMOVES && excluded.length) {
    console.error(
      `
❌ 적용 제외 ${excluded.length}건이 남아 있어 --apply-removes 를 받지 않습니다(아무것도 쓰지 않음).` +
        `
   위 제외 목록을 시트나 학생 정보에서 먼저 해결한 뒤 다시 실행하세요.`,
    );
    await sql.end();
    process.exit(1);
  }
  return { diff, excluded };
}

/**
 * 계획을 실제로 쓴다 — 스냅샷 → 이동 RPC → (선택)종료 → 추가 → 스냅샷 id 되쓰기 → 이력.
 * 🔴 **스냅샷을 못 만들면 아무것도 쓰지 않는다**(applyDiff와 같은 규약) — 되돌릴 수 없는 적용 금지.
 */
async function applyRoster(plan: RosterPlan | null): Promise<void> {
  if (!plan || !APPLY) return;
  const diff: ImportDiff = { ...plan.diff, removes: APPLY_REMOVES ? plan.diff.removes : [] };
  if (diff.moves.length + diff.adds.length + diff.removes.length === 0) {
    console.log("\n명단 변경 없음 — 시트와 일치합니다.");
    return;
  }

  const [snap] = await sql<{ id: string }[]>`
    insert into public.timetable_snapshots (tenant_id, label, reference_date, summary, payload, created_by)
    values (${TENANT}, ${`영어 마스터시트 명단 ${CUTOVER}`}, ${CUTOVER}::date,
            ${sql.json({ moves: diff.moves.length, removes: diff.removes.length, adds: diff.adds.length } as never)}::jsonb,
            ${sql.json(diff as never)}::jsonb, ${ACTOR})
    returning id`;
  if (!snap?.id) {
    console.error("❌ 되돌리기용 스냅샷을 저장하지 못해 명단 적용을 중단합니다(명단 변경 없음).");
    return;
  }

  let failed = 0;
  // 1) 이동 — 분리등원(attendance_days) 승계는 RPC 인자로만 가능하다(미지정이면 전 요일이 된다).
  if (diff.moves.length) {
    const dayRows = await sql<{ id: string; attendance_days: string[] | null }[]>`
      select id, attendance_days from enrollments
       where tenant_id = ${TENANT} and id = any(${diff.moves.map((m) => m.enrollmentId)}::uuid[])`;
    const daysBy = new Map(dayRows.map((r) => [r.id, r.attendance_days ?? []]));
    const moves = diff.moves.map((m) => ({
      enrollmentId: m.enrollmentId,
      newClassId: m.toClassId,
      attendanceDays: daysBy.get(m.enrollmentId) ?? [],
    }));
    const [res] = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ACTOR, role: "authenticated" })}, true)`;
      // 🔴 **이름 지정 호출**(`=>`) — 0235a의 인자 순서는 `(p_moves, p_effective_date)`라 위치 인자로
      //    쓰면 뒤집힌다(실제로 뒤집혀 있었다). 날짜를 안 넘기면 기본값 `current_date`(UTC)로 떨어져
      //    **예약이 아니라 오늘 이동**이 된다 — 자리 순서에 기대지 않는다.
      return tx`select public.move_enrollments_batch(
        p_moves => ${sql.json(moves as never)}::jsonb,
        p_effective_date => ${CUTOVER}::date) as r`;
    });
    const results = (((res as { r: unknown }).r ?? []) as {
      enrollmentId: string; newEnrollmentId?: string; ok: boolean; error?: string;
    }[]);
    for (const r of results)
      if (!r.ok) { failed += 1; console.error(`  ✗ 이동 실패 ${r.enrollmentId}: ${r.error ?? ""}`); }
    // 🔑 0235a가 준 새 수강 id를 적어 둔다 — 되돌리기가 좌표 추측 없이 이 행만 지운다(0236a).
    const newIdBy = new Map(
      results.filter((r) => r.ok && r.newEnrollmentId).map((r) => [r.enrollmentId, r.newEnrollmentId!]),
    );
    for (const m of diff.moves) { const id = newIdBy.get(m.enrollmentId); if (id) m.newEnrollmentId = id; }
    console.log(`  ✓ 이동 ${results.filter((r) => r.ok).length}/${diff.moves.length}`);
  }

  // 2) 종료(--apply-removes 일 때만)
  let removeFailed = 0;
  for (const r of diff.removes) {
    const [row] = await sql<{ id: string }[]>`update public.enrollments
        set end_date = ${CUTOVER}::date, withdrawal_reason = '시트 명단 반영'
      where id = ${r.enrollmentId} and tenant_id = ${TENANT} returning id`;
    if (!row) { failed += 1; removeFailed += 1; console.error(`  ✗ 종료 실패 ${r.studentName}(${r.className})`); }
  }
  if (diff.removes.length) console.log(`  ✓ 종료 ${diff.removes.length - removeFailed}/${diff.removes.length}`);

  // 3) 추가 — 🔴 휴원 표식 승계(applyDiff와 같은 규약). 시트는 "어느 반인가"의 진실이지 "휴원인가"가 아니다.
  let heldAdds = 0;
  let addFailed = 0;
  if (diff.adds.length) {
    const statusRows = await sql<{ id: string; status: string | null }[]>`
      select id, status from students
       where tenant_id = ${TENANT} and id = any(${[...new Set(diff.adds.map((a) => a.studentId))]}::uuid[])`;
    const statusBy = new Map(statusRows.map((r) => [r.id, r.status]));
    for (const a of diff.adds) {
      const onHold = enrollmentOnHoldForStatus(statusBy.get(a.studentId));
      try {
        const [row] = await sql<{ id: string }[]>`
          insert into public.enrollments (tenant_id, student_id, class_id, start_date, on_hold)
          values (${TENANT}, ${a.studentId}, ${a.classId}, ${CUTOVER}::date, ${onHold})
          returning id`;
        if (row?.id) a.enrollmentId = row.id;
        if (onHold) heldAdds += 1;
      } catch (e) {
        failed += 1;
        addFailed += 1;
        console.error(`  ✗ 추가 실패 ${a.studentName} → ${a.className}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    console.log(`  ✓ 추가 ${diff.adds.length - addFailed}/${diff.adds.length}${heldAdds ? ` (휴원 승계 ${heldAdds})` : ""}`);
  }

  // 4) 스냅샷 payload 되쓰기 — 새 수강 id가 여기 있어야 되돌리기가 정확하다(실패해도 좌표 폴백은 남는다).
  await sql`update public.timetable_snapshots set payload = ${sql.json(diff as never)}::jsonb
             where id = ${snap.id} and tenant_id = ${TENANT}`;
  await sql`insert into public.timetable_import_logs (tenant_id, week_label, snapshot_id, result, details, actor_id)
    values (${TENANT}, ${CUTOVER}, ${snap.id},
            ${sql.json({ moved: diff.moves.length, removed: diff.removes.length, added: diff.adds.length, heldAdds, failed } as never)}::jsonb,
            ${sql.json(diff as never)}::jsonb, ${ACTOR})`;

  console.log(
    `\n✅ 명단 적용 완료 — 이동 ${diff.moves.length} · 추가 ${diff.adds.length} · 종료 ${diff.removes.length}${failed ? ` · 실패 ${failed}` : ""}`,
  );
  console.log(`   되돌리기: select public.rollback_enrollment_import('${snap.id}');`);
}

// 🔴 명단 계획은 **어떤 쓰기보다도 먼저** 세운다 — 인원 검산이 어긋나면
// 배치를 쓰기 전에 멈춰야 하기 때문이다(planRoster가 그 자리에서 process.exit한다).
const rosterPlan = await planRoster();

// --roster-only: 여기서 끝낸다(배치·블록·이름은 손대지 않는다).
if (ROSTER_ONLY) {
  if (!rosterPlan) {
    console.error("--roster-only 에는 --roster=<탭> 이 필요합니다.");
    await sql.end();
    process.exit(1);
  }
  console.log("\n(--roster-only) 배치·비수업 블록·반 이름은 건드리지 않습니다.");
  await applyRoster(rosterPlan);
  await sql.end();
  process.exit(0);
}

// ── 4. payload = applyStructureImport(server action)과 동일 구조 ──────────────
const changeItems = report.planItems.filter((p) => p.action !== "keep");
if (changeItems.length === 0) {
  // 🔴 이름 변경은 **스냅샷을 타고** 예약된다(classUpdates) — 배치 변경이 0건이면 RPC를 안 불러
  //    스냅샷이 안 생기고, 그러면 예약도 취소 수단도 없다. 조용히 넘기면 "바꿨는데 안 바뀌었다"가 된다.
  if (renamePlan.length) {
    console.error(
      `
중단: 배치 변경이 0건이라 스냅샷이 만들어지지 않습니다 — 이름 변경 ${renamePlan.length}건을 예약할 그릇이 없습니다.` +
        `
  시트가 이미 반영된 상태이니, 이름만 바꾸려면 반 관리 화면에서 직접 바꾸세요(감사로그는 동일하게 남습니다).`,
    );
    await sql.end();
    process.exit(1);
  }
  // 배치가 같아도 **비수업 블록은 따로** 갈아끼운다 — 수업은 그대로인데 감독만 바뀔 수 있다(독립).
  console.log("\n배치 변경 없음 — 시트와 일치합니다.");
  await syncBlocks();
  await applyRoster(rosterPlan);
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
// 반 이름 변경을 같은 레코드에 얹는다 — 미래 컷오버면 0234a가 classUpdates를 통째로 미뤄 스냅샷에만
// 남기므로 **이름 변경도 함께 예약**되고, 예약 취소(배지 ×)로 함께 없던 일이 된다.
// ⚠️ 배치가 안 바뀐 반은 buildClassUpdates가 항목을 안 만든다 → 이름만 바꾸는 반은 여기서 새로 넣는다.
if (renamePlan.length) {
  const byId = new Map(ctx.classes.map((c) => [c.id, c]));
  for (const r of renamePlan) {
    const prev = byId.get(r.classId);
    const hit = classUpdates.find((u) => u.classId === r.classId);
    if (hit) {
      hit.className = r.to;
      hit.prevClassName = r.from;
    } else {
      classUpdates.push({
        classId: r.classId,
        teacherId: null,
        classroomId: null,
        prevTeacherId: prev?.teacherId ?? null,
        prevClassroomId: prev?.classroomId ?? null,
        className: r.to,
        prevClassName: r.from,
      });
    }
  }
}
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
const r = (res as { r: { snapshotId: string; closed: number; inserted: number; classUpdated: number; classUpdatesDeferred: number } }).r;
console.log(`\n✅ 적용 완료 — 마감 ${r.closed} · 삽입 ${r.inserted} · 반 갱신 ${r.classUpdated}`);
console.log(`   되돌리기: select public.rollback_english_structure('${r.snapshotId}');`);

// ── 5-b. 반 이름 변경 ────────────────────────────────────────────────────────
// 🔴 RPC(0234a)는 `className`을 **읽지 않는다** — jsonb라 스냅샷엔 그대로 보존되고, 적용은
//    미래 컷오버면 cron(`apply-due-class-updates`)이, **오늘 컷오버면 여기서** 한다.
//    이 분기를 빼면 즉시 컷오버에서 이름이 조용히 안 바뀐다(가장 위험한 실패 모양).
if (renamePlan.length) {
  // 🔴 즉시/예약 판정은 **RPC가 알려준 값**을 쓴다 — 스크립트가 따로 계산하면 UTC(`current_date`)와
  //    KST 사이 경계에서 어긋나, 담임은 미뤄졌는데 이름만 지금 바뀌는 반쪽 적용이 난다.
  if (r.classUpdatesDeferred > 0) {
    console.log(`📅 반 이름 변경 ${renamePlan.length}건은 ${CUTOVER}에 적용됩니다(cron). 그 전엔 옛 이름 그대로이고,`);
    console.log("   시간표 툴바의 예약 배지 ×를 누르면 이름 변경까지 함께 취소됩니다.");
  } else {
    await sql.begin(async (tx) => {
      for (const rn of renamePlan) {
        // 사람이 그 사이 손댔으면 덮지 않는다 — cron의 shouldApplyName과 **같은 규칙**.
        const [row] = await tx<{ class_name: string }[]>`
          update public.classes set class_name = ${rn.to}
           where id = ${rn.classId} and tenant_id = ${TENANT} and class_name = ${rn.from}
          returning class_name`;
        if (!row) {
          console.log(`  ⏭ "${rn.from}" → "${rn.to}" 건너뜀 — 현재 이름이 예약 시점과 다릅니다(사람이 손댐).`);
          continue;
        }
        // 감사로그 — 화면 `class_update` 렌더와 같은 모양(field/from/to). 이름의 이력이 남는 유일한 자리.
        await tx`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
          values (${TENANT}, ${ACTOR}, '마스터시트 컷오버', 'class_update', 'class', ${rn.to},
                  ${sql.json({ classId: rn.classId, changed: ["반 이름"], changes: [{ field: "반 이름", from: rn.from, to: rn.to }], snapshotId: r.snapshotId } as never)}::jsonb)`;
        console.log(`  ✔ ${rn.from} → ${rn.to}`);
      }
    });
  }
}
await syncBlocks();
await applyRoster(rosterPlan);

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
