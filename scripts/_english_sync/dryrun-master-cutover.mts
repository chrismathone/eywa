/**
 * 원장님 마스터 시트(`2026 영어시간표_인재원 본원`)의 강사별 탭 → aywa 배치 컷오버 **dry-run**(읽기 전용).
 *
 * 앱의 '시트에서 가져오기'는 **aywa 전용 시트**(`[Aywa 2.0] 영어 시간표`)만 읽는다 — 원장님이 실제로
 * 편집하는 마스터는 탭 구조가 달라(블록형: 2행 강사·4행 요일·5행 앵커) 앱 경로로 못 읽는다.
 * 그래서 마스터 전용 파서(parse-grid.ts)로 읽고, 매칭·diff는 앱과 **같은 순수 모듈**을 그대로 쓴다.
 *
 * 실행:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs \
 *     scripts/_english_sync/dryrun-master-cutover.mts "강사별영어시간표(7/9~)"
 *
 * ⚠️ 쓰기 없음. 적용은 별도 스크립트(--apply)에서 temporal 컷오버로 수행한다.
 */
import postgres from "postgres";
import { google } from "googleapis";
import { parseTeacherGrid } from "../../src/features/timetable/import/structure/parse-grid";
import { matchStructure } from "../../src/features/timetable/import/structure/match";
import { computeStructureDiff } from "../../src/features/timetable/import/structure/diff";
import type {
  ExistingContext,
  ExistingSchedule,
  SheetGrid,
} from "../../src/features/timetable/import/structure/types";
import type { DayOfWeek } from "../../src/features/timetable/lib/periods";

const MASTER_ID = "1-1JHCw36iWPku782DXMhqYbEMBUFL7bElfJjSQekoWA";
const TAB = process.argv[2] ?? "강사별영어시간표(7/9~)";
const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const SUBJECT = "english";

function creds(): { client_email: string; private_key: string } {
  let s = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT_KEY || "").trim();
  if (!s.startsWith("{")) s = Buffer.from(s, "base64").toString("utf-8");
  return JSON.parse(s);
}

async function readMasterGrid(tab: string): Promise<SheetGrid> {
  const c = creds();
  const auth = new google.auth.JWT({
    email: c.client_email,
    key: c.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.get({
    spreadsheetId: MASTER_ID,
    ranges: [tab],
    includeGridData: true,
    fields: "sheets(properties(title),merges,data(rowData(values(formattedValue))))",
  });
  const sh = res.data.sheets![0]!;
  const rowData = sh.data![0]!.rowData ?? [];
  return {
    tabName: sh.properties!.title!,
    cells: rowData.map((r) => (r.values ?? []).map((v) => v.formattedValue ?? "")),
    merges: (sh.merges ?? []).map((m) => ({
      startRowIndex: m.startRowIndex!,
      endRowIndex: m.endRowIndex!,
      startColumnIndex: m.startColumnIndex!,
      endColumnIndex: m.endColumnIndex!,
    })),
  };
}

const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });
const hm = (t: unknown) => (t ? String(t).slice(0, 5) : null);

const grid = await readMasterGrid(TAB);
console.log(`시트 탭 "${grid.tabName}" — ${grid.cells.length}행 · 병합 ${grid.merges.length}`);

const parsed = parseTeacherGrid(grid);
console.log(`파싱: 강사블록 ${parsed.teachers.length} · 슬롯 ${parsed.slots.length} · 경고 ${parsed.warnings.length}`);

// ── 기존 레코드 스냅샷 ────────────────────────────────────────────────────────
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
        and cs.valid_to is null`,
]);

const ctx: ExistingContext = {
  classes: classes.map((c) => ({
    id: c.id, className: c.class_name, subject: c.subject,
    teacherId: c.teacher_id, classroomId: c.classroom_id,
  })),
  teachers: users.map((u) => ({
    id: u.id, englishName: u.english_name, displayName: u.display_name, systemRole: u.system_role,
  })),
  classrooms: rooms.map((r) => ({ id: r.id, name: r.name })),
};
const existing: ExistingSchedule[] = sched.map((s) => ({
  id: s.id, classId: s.class_id, className: s.class_name, day: s.day_of_week as DayOfWeek,
  startTime: hm(s.start_time)!, endTime: hm(s.end_time), teacherId: s.teacher_id,
  classroomId: s.classroom_id, slotTeacherLabel: s.slot_teacher_label,
  slotRoomLabel: s.slot_room_label, mergeGroup: s.merge_group,
  validFrom: s.valid_from, validTo: s.valid_to,
}));
await sql.end();

// ── 매칭 + diff (앱과 동일 순수 모듈) ─────────────────────────────────────────
const match = matchStructure(parsed, ctx);
const report = computeStructureDiff(match, existing);

console.log(`\n매칭: 반 ${match.matchedClasses} · 강사 ${match.matchedTeachers} · 방 ${match.matchedRooms}`);
if (match.newClassNames.length) console.log(`  ⚠️ 기존에 없는 반명 ${match.newClassNames.length}: ${match.newClassNames.join(" / ")}`);
if (match.newTeacherNames.length) console.log(`  ⚠️ 기존에 없는 강사 ${match.newTeacherNames.length}: ${match.newTeacherNames.join(" / ")}`);
if (match.newRoomNames.length) console.log(`  ⚠️ 기존에 없는 방 ${match.newRoomNames.length}: ${match.newRoomNames.join(" / ")}`);

console.log(`\n계획: 생성 ${report.plan.create} · 변경 ${report.plan.update} · 유지 ${report.plan.keep} · 마감 ${report.plan.remove}`);

const KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
const show = (act: string, limit = 200) =>
  report.planItems
    .filter((p) => p.action === act)
    .slice(0, limit)
    .forEach((p) =>
      console.log(
        `   ${p.className} · ${KO[p.day] ?? p.day} ${p.startTime}${p.endTime ? `~${p.endTime}` : ""}` +
          ` · ${p.teacherNames.join(",") || "—"}${p.room ? ` · ${p.room}` : ""}`,
      ),
    );
console.log("\n[생성]"); show("create");
console.log("\n[변경]"); show("update");
console.log("\n[마감]"); show("remove");

if (report.warnings.length) {
  console.log(`\n확인 필요 ${report.warnings.length}건`);
  report.warnings.forEach((w) => console.log(`   · ${w}`));
}
if (parsed.warnings.length) {
  console.log(`\n파서 경고 ${parsed.warnings.length}건(메모 셀 등 — 반으로 만들지 않음)`);
  parsed.warnings.slice(0, 40).forEach((w) => console.log(`   · ${w}`));
}

// ── 반 단위 영향 = "학생을 옮겨야 하는 반"이 어디인지 ──────────────────────────
// ⚠️ 학생 상세 '수업' 탭의 '지난 수업'은 class_schedules가 아니라 **enrollments.end_date** 기준이다.
// 배치(슬롯)만 컷오버하면 그 탭은 안 바뀐다 — 학생 이력이 생기려면 수강 자체가 끝나거나 옮겨져야 한다.
// 그래서 "새 시트에서 슬롯이 0이 되는 반"(= 사실상 종강) + 그 반의 재원생 수를 따로 뽑는다.
const sql2 = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });
const enrollCounts = await sql2<{ class_id: string; class_name: string; n: number }[]>`
  select e.class_id, c.class_name, count(*)::int as n
  from enrollments e join classes c on c.id = e.class_id
  where c.tenant_id = ${TENANT} and c.subject = ${SUBJECT} and c.is_active = true
    and e.end_date is null and coalesce(e.on_hold, false) = false
  group by 1, 2`;
await sql2.end();

const sheetSlotsByClass = new Map<string, number>();
for (const r of match.resolved) {
  if (!r.classId) continue;
  sheetSlotsByClass.set(r.classId, (sheetSlotsByClass.get(r.classId) ?? 0) + 1);
}
const dbSlotsByClass = new Map<string, number>();
for (const e of existing) dbSlotsByClass.set(e.classId, (dbSlotsByClass.get(e.classId) ?? 0) + 1);

const vanished = [...dbSlotsByClass.entries()]
  .filter(([id]) => !sheetSlotsByClass.has(id))
  .map(([id, was]) => {
    const ec = enrollCounts.find((x) => x.class_id === id);
    const name = existing.find((e) => e.classId === id)!.className;
    return { name, was, students: ec?.n ?? 0 };
  })
  .sort((a, b) => b.students - a.students);

console.log(`\n=== 새 시트에서 사라진 반 ${vanished.length}개 (슬롯 0 = 사실상 종강) ===`);
if (!vanished.length) console.log("   없음 — 모든 반이 새 시트에도 존재합니다.");
for (const v of vanished) {
  console.log(`   ${v.name} — 기존 슬롯 ${v.was} → 0 · 재원생 ${v.students}명${v.students ? "  ⚠️ 학생 처리 필요" : ""}`);
}
const totalMoved = vanished.reduce((s, v) => s + v.students, 0);
console.log(`   재원생 합계 ${totalMoved}명`);
