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
import { google } from "googleapis";
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

const MASTER_ID = "1-1JHCw36iWPku782DXMhqYbEMBUFL7bElfJjSQekoWA";
const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const SUBJECT = "english";
/** RPC는 security invoker + auth_tenant_id()(=auth.uid() 조회) — 스크립트 실행엔 세션 클레임 주입이 필요. */
const ACTOR = "fcf735fa-edf7-4095-8fa6-724285a018ed"; // 박소선(master)

const args = process.argv.slice(2);
const TAB = args.find((a) => !a.startsWith("--")) ?? "강사별영어시간표(7/9~)";
const CUTOVER = (args.find((a) => a.startsWith("--cutover="))?.split("=")[1] ?? "2026-07-09").trim();
const APPLY = args.includes("--apply");

/**
 * 시트엔 반명처럼 보이지만 실제 반이 아닌 셀(메모)이 섞여 있다 — 숫자·시각·"쉬는 시간"·사람 이름 등.
 * 원장 확인(2026-07-22): "메모라 넘겨도 된다". 그래서 **기존 반에 매칭되지 않는 이름은 기본적으로 버리고**,
 * 진짜 신설 반만 아래 화이트리스트로 **명시 생성**한다(자동 생성 금지 = 메모가 반으로 둔갑하는 걸 원천 차단).
 */
const NEW_CLASSES_TO_CREATE = ["중고E_중2 최상위", "중등E_중2 정규 D"];

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
  return {
    tabName: sh.properties!.title!,
    cells: (sh.data![0]!.rowData ?? []).map((r) => (r.values ?? []).map((v) => v.formattedValue ?? "")),
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

async function loadContext(): Promise<{ ctx: ExistingContext; existing: ExistingSchedule[] }> {
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
  return {
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
    existing: sched.map((s) => ({
      id: s.id, classId: s.class_id, className: s.class_name, day: s.day_of_week as DayOfWeek,
      startTime: hm(s.start_time)!, endTime: hm(s.end_time), teacherId: s.teacher_id,
      classroomId: s.classroom_id, slotTeacherLabel: s.slot_teacher_label,
      slotRoomLabel: s.slot_room_label, mergeGroup: s.merge_group,
      validFrom: s.valid_from, validTo: s.valid_to,
    })),
  };
}

// ── 1. 시트 파싱 ──────────────────────────────────────────────────────────────
const grid = await readMasterGrid(TAB);
const parsed = parseTeacherGrid(grid);
console.log(`시트 "${grid.tabName}" — 강사블록 ${parsed.teachers.length} · 슬롯 ${parsed.slots.length}`);
const dayBefore = new Date(`${CUTOVER}T00:00:00Z`);
dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
const CLOSE_AT = dayBefore.toISOString().slice(0, 10);
console.log(`컷오버: ~${CLOSE_AT} 옛 배치 마감 · ${CUTOVER}부터 새 배치  ${APPLY ? "【적용】" : "(dry-run)"}`);

// ── 2. 신설 반 생성(화이트리스트만) ───────────────────────────────────────────
const sheetNames = new Set(parsed.slots.map((s) => s.className));
for (const name of NEW_CLASSES_TO_CREATE) {
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
const { ctx, existing } = await loadContext();
const match = matchStructure(parsed, ctx);
const report = computeStructureDiff(match, existing);

console.log(`\n매칭: 반 ${match.matchedClasses} · 강사 ${match.matchedTeachers} · 방 ${match.matchedRooms}`);
const dropped = match.newClassNames;
if (dropped.length) console.log(`  버려진 이름 ${dropped.length}건(메모로 판단 — 반 생성 안 함): ${dropped.join(" / ")}`);
console.log(`계획: 생성 ${report.plan.create} · 변경 ${report.plan.update} · 유지 ${report.plan.keep} · 마감 ${report.plan.remove}`);

// ── 4. payload = applyStructureImport(server action)과 동일 구조 ──────────────
const changeItems = report.planItems.filter((p) => p.action !== "keep");
if (changeItems.length === 0) {
  console.log("\n변경 없음 — 시트와 배치가 이미 일치합니다.");
  await sql.end();
  process.exit(0);
}
const validToById = new Map(existing.map((e) => [e.id, e.validTo]));
const closes = report.planItems
  .filter((p) => (p.action === "update" || p.action === "remove") && p.scheduleId)
  .map((p) => ({ id: p.scheduleId!, prevValidTo: validToById.get(p.scheduleId!) ?? null }));
const inserts = report.planItems
  .filter((p) => (p.action === "create" || p.action === "update") && p.classId)
  .map((p) => ({
    id: randomUUID(),
    classId: p.classId!,
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
console.log(`쓰기 예정: 마감 ${closes.length}행 · 삽입 ${inserts.length}행 · 반 갱신 ${classUpdates.length}건`);

if (!APPLY) {
  console.log("\n(dry-run — 쓰기 없음. 실제 반영은 --apply)");
  await sql.end();
  process.exit(0);
}

// ── 5. 적용 (앱과 동일 RPC · 스냅샷/롤백 포함) ────────────────────────────────
// RPC는 security invoker + auth_tenant_id() → 스크립트 연결엔 JWT 클레임을 주입해야 테넌트가 잡힌다.
const [res] = await sql.begin(async (tx) => {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ACTOR, role: "authenticated" })}, true)`;
  // payload는 **객체**라 `JSON.stringify(...)::jsonb`가 정확히 1회 인코딩된다(텍스트 파라미터 → jsonb 파싱).
  // ⚠️ gotcha #82의 이중 인코딩은 **스칼라**(문자열)에 이 패턴을 쓸 때다 — 스칼라는 `to_jsonb(v::text)`.
  // (sql.json()은 postgres.js의 JSONValue 타입이 이 구조체를 거부해서 미사용.)
  return tx`select public.apply_english_structure(${JSON.stringify(payload)}::jsonb, ${CUTOVER}::date) as r`;
});
const r = (res as { r: { snapshotId: string; closed: number; inserted: number; classUpdated: number } }).r;
console.log(`\n✅ 적용 완료 — 마감 ${r.closed} · 삽입 ${r.inserted} · 반 갱신 ${r.classUpdated}`);
console.log(`   되돌리기: select public.rollback_english_structure('${r.snapshotId}');`);

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
