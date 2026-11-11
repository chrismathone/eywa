import "server-only";

/**
 * **수학 퇴원생 → '퇴원생 관리 차트' 구글시트 자동 기입**(원장 2026-10-07) — 규칙은 `../withdrawal-sheet-model.ts`.
 *
 * 부르는 곳(퇴원이 실제로 일어나는 문 전부): 학생 상태 '퇴원'(오늘·지난 날) · 학생 수정 폼의 퇴원 · 예약 퇴원 cron ·
 * 수강 종료(한 건 / 퇴원 창에서 고른 것). 대량 퇴원(데이터 정리 도구)은 일부러 뺐다 — 옛 데이터를 정리할 때 시트가 쏟아진다.
 *
 * 🔴 **던지지 않는다** — 퇴원 처리는 이미 끝났다. 시트를 못 쓰면 서버 로그(reportError)만 남긴다(퇴원을 되돌리지 않는다).
 *    서버 액션은 `after()`로 응답 뒤에 부른다(구글 호출로 퇴원 버튼이 느려지지 않게).
 * 🔴 **세션 없이 돈다**(after·cron) → admin 클라이언트 + 모든 조회에 `tenant_id`.
 * 🔑 대상 시트 = 원장이 준 '퇴원생 관리 차트'(`DEFAULT_SPREADSHEET_ID`, env `WITHDRAWAL_SHEET_SPREADSHEET_ID`로 바꿀 수 있다 ·
 *    `off`면 끈다). 시트는 서비스계정(학원 설정 › 연동에 보이는 주소)에 **편집자로 공유**돼 있어야 한다.
 * 🔑 지점 축: 시트엔 지점이 없다 — `WITHDRAWAL_SHEET_TENANT_ID` → 없으면 같은 학원 행정 시트인 직원명부의 `HR_ROSTER_TENANT_ID` →
 *    둘 다 없으면 지점이 정확히 하나일 때만(직원명부 시트와 같은 fail-closed 규약 — 남의 지점 학생 이름이 섞이지 않게).
 */
import { getSheetsApi, describeSheetsError } from "@/features/integrations/google-sheets";
import { tenantViewOutboundError } from "@/lib/auth/tenant-view-outbound";
import { BOARD_PREFIX } from "@/features/report-admin/notice-targets";
import { licenseBlockReason } from "@/lib/license/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { reportError } from "@/lib/observability/report-error";
import { loadExitCountDates, loadSubjectExitCountDates } from "./exit-month";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import {
  alreadyListed,
  colLetter,
  entryCells,
  findMonthTab,
  mathWithdrawalsOn,
  monthTabTitle,
  monthTitleText,
  nextRowOf,
  sheetLayoutOf,
  templateTabFor,
  campusOf,
  isSelfStudyClassName,
  type EnrollmentFact,
  type SheetEntry,
} from "../withdrawal-sheet-model";

/** 시트에 적는 과목 이름 — 이 시트는 수학 퇴원 전용이다. */
const SUBJECT_TEXT = "수학";
/** 수학 계열 과목 키 — ClassNote가 '(수학)' 보드로 보내는 과목과 같은 목록(단일 소스). */
const isMathKey = (k: string | null | undefined) => !!k && BOARD_PREFIX[k] === "(수학)";
const TIMEOUT_MS = 25_000;
/** 원장이 준 '퇴원생 관리 차트'(2026-10-07) — 비밀이 아니라 주소다. */
const DEFAULT_SPREADSHEET_ID = "1BvFQiUawZuyrhfJi14CK_AA_NpL7b-wbqaFVNZxoobU";

export function spreadsheetIdOf(): string | null {
  const v = process.env.WITHDRAWAL_SHEET_SPREADSHEET_ID?.trim();
  if (v?.toLowerCase() === "off") return null;
  return v || DEFAULT_SPREADSHEET_ID;
}

export async function isSheetTenant(tenantId: string): Promise<boolean> {
  const pinned = (process.env.WITHDRAWAL_SHEET_TENANT_ID ?? process.env.HR_ROSTER_TENANT_ID)?.trim();
  if (pinned) return pinned === tenantId;
  const { data, error } = await createAdminClient().from("tenants").select("id").limit(2);
  if (error || !data) return false;
  const mine = data.length === 1 && String(data[0]!.id) === tenantId;
  if (!mine) console.warn("[withdrawal-sheet] 지점이 여럿인데 WITHDRAWAL_SHEET_TENANT_ID가 없어 기입하지 않음");
  return mine;
}

type EnrollmentRow = {
  id: string;
  class_id: string;
  end_date: string | null;
  is_transferred: boolean | null;
  class: {
    class_name: string | null;
    subject: string | null;
    classroom_id: string | null;
    teacher: { display_name: string | null } | null;
  } | null;
};

/** 이 학생이 이 날 수학을 그만뒀다면 시트에 적을 줄들. 아니면 빈 배열. */
async function entriesFor(
  tenantId: string,
  studentId: string,
  date: string,
  only?: readonly string[],
): Promise<SheetEntry[]> {
  const db = createAdminClient();
  const [stu, enr] = await Promise.all([
    db.from("students").select("name, school, grade, enrolled_at").eq("tenant_id", tenantId).eq("id", studentId).maybeSingle(),
    db
      .from("enrollments")
      .select(
        "id, class_id, end_date, is_transferred, class:class_id ( class_name, subject, classroom_id, teacher:teacher_id ( display_name ) )",
      )
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId),
  ]);
  if (stu.error) throw stu.error;
  if (enr.error) throw enr.error;
  if (!stu.data) return [];
  const rows = (enr.data ?? []) as unknown as EnrollmentRow[];
  const facts: (EnrollmentFact & { row: EnrollmentRow })[] = rows.map((r) => ({
    id: r.id,
    endDate: r.end_date ? String(r.end_date).slice(0, 10) : null,
    isTransferred: r.is_transferred === true,
    isMath: isMathKey(r.class?.subject),
    isSelfStudy: isSelfStudyClassName(r.class?.class_name),
    row: r,
  }));
  const quit = mathWithdrawalsOn(facts, date, only ? new Set(only) : undefined) as typeof facts;
  const s = stu.data as { name: string; school: string | null; grade: string | null; enrolled_at: string | null };
  if (quit.length === 0) return [];
  const campusByClass = await campusByClassOf(
    db,
    tenantId,
    quit.map((f) => ({ classId: f.row.class_id, defaultRoomId: f.row.class?.classroom_id ?? null })),
    date,
  );
  return quit.map((f) => ({
    name: s.name,
    schoolGrade: schoolGradeLabel(s.school, s.grade) ?? "",
    className: f.row.class?.class_name ?? "",
    subject: SUBJECT_TEXT,
    teacher: f.row.class?.teacher?.display_name ?? "",
    campus: campusByClass.get(f.row.class_id) ?? "",
    enrolledAt: s.enrolled_at ? String(s.enrolled_at).slice(0, 10) : null,
    withdrawnAt: date,
  }));
}

/**
 * 반 → 재원캠퍼스. 강의실은 **수업 배치(교시)의 강의실**이 먼저다(한 반이 요일마다 방이 다를 수 있다) — 퇴원일에 살아 있던
 * 배치, 없으면 그 반의 가장 최근 배치, 배치에 방이 비면 반 기본 강의실(`classes.classroom_id`, 배치가 비면 이걸 상속한다).
 * 조회 실패는 빈 칸(캠퍼스 하나 때문에 기입을 막지 않는다).
 */
async function campusByClassOf(
  db: ReturnType<typeof createAdminClient>,
  tenantId: string,
  classes: { classId: string; defaultRoomId: string | null }[],
  date: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const ids = [...new Set(classes.map((c) => c.classId))];
    const { data: slots, error } = await db
      .from("class_schedules")
      .select("class_id, classroom_id, valid_from, valid_to")
      .eq("tenant_id", tenantId)
      .in("class_id", ids);
    if (error) throw error;
    const rows = (slots ?? []) as { class_id: string; classroom_id: string | null; valid_from: string; valid_to: string | null }[];
    const roomIdsByClass = new Map<string, (string | null)[]>();
    for (const c of classes) {
      const mine = rows.filter((r) => r.class_id === c.classId);
      const live = mine.filter((r) => String(r.valid_from) <= date && (!r.valid_to || String(r.valid_to) >= date));
      const latestFrom = mine.reduce((m, r) => (String(r.valid_from) > m ? String(r.valid_from) : m), "");
      const pick = live.length ? live : mine.filter((r) => String(r.valid_from) === latestFrom);
      roomIdsByClass.set(c.classId, pick.length ? pick.map((r) => r.classroom_id ?? c.defaultRoomId) : [c.defaultRoomId]);
    }
    const roomIds = [...new Set([...roomIdsByClass.values()].flat().filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (roomIds.length) {
      const { data: rooms, error: rErr } = await db.from("classrooms").select("id, name").eq("tenant_id", tenantId).in("id", roomIds);
      if (rErr) throw rErr;
      for (const r of (rooms ?? []) as { id: string; name: string | null }[]) names.set(r.id, r.name ?? "");
    }
    for (const [classId, ids2] of roomIdsByClass) out.set(classId, campusOf(ids2.map((id) => (id ? names.get(id) : null))));
  } catch (e) {
    reportError(e, { where: "withdrawal-sheet.campus" });
  }
  return out;
}

type Sheets = Awaited<ReturnType<typeof getSheetsApi>>;

async function readTab(sheets: Sheets, spreadsheetId: string, title: string): Promise<string[][]> {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${title}'` });
  return ((res.data.values ?? []) as unknown[][]).map((r) => r.map((c) => (c == null ? "" : String(c))));
}

/** 그 달 탭 — 없으면 직전 달 탭을 복사해 만들고(맨 앞에) 제목·내용을 비운다(번호 칸은 남긴다). */
async function ensureMonthTab(sheets: Sheets, spreadsheetId: string, date: string): Promise<string> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title,index)" });
  const tabs = (meta.data.sheets ?? [])
    .map((x) => x.properties)
    .filter((p): p is { sheetId: number; title: string; index?: number } => typeof p?.sheetId === "number" && !!p?.title)
    .map((p) => ({ gid: p.sheetId, title: p.title, index: p.index ?? 0 }));
  const have = findMonthTab(tabs, date);
  if (have) return have.title;
  const template = templateTabFor(tabs, date);
  if (!template) throw new Error("본보기로 복사할 'YY.M 퇴원' 탭이 하나도 없습니다");
  const title = monthTabTitle(date);
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          { duplicateSheet: { sourceSheetId: template.gid, newSheetName: title, insertSheetIndex: template.index } },
        ],
      },
    });
  } catch (e) {
    // 동시에 두 퇴원이 같은 탭을 만들려 한 경우 — 이미 생겼으면 그걸 쓴다.
    if (!/already exists/i.test((e as Error)?.message ?? "")) throw e;
    return title;
  }
  // 복사본 비우기 — 제목 글자만 새 달로, 머리줄 아래 값 칸은 비운다(A열 번호·서식은 그대로).
  const rows = await readTab(sheets, spreadsheetId, title);
  const layout = sheetLayoutOf(rows);
  if (!layout) throw new Error(`'${title}' 탭의 머리줄(최종퇴원일)을 찾지 못했습니다`);
  const titleRow = rows.slice(0, layout.headerRow).findIndex((r) => r.some((c) => c.includes("학습종료퇴원")));
  const data: { range: string; values: string[][] }[] = [];
  if (titleRow >= 0) {
    const col = rows[titleRow]!.findIndex((c) => c.includes("학습종료퇴원"));
    data.push({ range: `'${title}'!${colLetter(col)}${titleRow + 1}`, values: [[monthTitleText(date)]] });
  }
  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data } });
  }
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${title}'!${colLetter(layout.nameCol)}${layout.headerRow + 2}:${colLetter(layout.lastCol)}`,
  });
  return title;
}

/**
 * 기입을 **한 줄로 세운다** — 사무실이 퇴원을 연달아 누르면 `after()` 작업들이 나란히 돌아 같은 '첫 빈 줄'을 골라 서로 덮어쓴다
 * (적대 리뷰 2026-10-07). 같은 서버 인스턴스 안에서만 지켜진다(다른 인스턴스와 동시에 겹칠 확률은 감수 — 같은 퇴원은
 * `alreadyListed`가 다시 막는다).
 */
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

async function writeEntries(spreadsheetId: string, entries: SheetEntry[], date: string): Promise<number> {
  const sheets = await getSheetsApi();
  const title = await ensureMonthTab(sheets, spreadsheetId, date);
  const rows = await readTab(sheets, spreadsheetId, title);
  const layout = sheetLayoutOf(rows);
  if (!layout) throw new Error(`'${title}' 탭의 머리줄(최종퇴원일)을 찾지 못했습니다`);
  const taken = new Set<number>();
  const data: { range: string; values: string[][] }[] = [];
  for (const e of entries) {
    if (alreadyListed(rows, layout, e)) continue; // 같은 퇴원을 두 번 처리해도 한 줄만
    const { row, number } = nextRowOf(rows, layout, taken);
    taken.add(row);
    for (const [col, value] of entryCells(layout, e, number)) {
      data.push({ range: `'${title}'!${colLetter(col)}${row}`, values: [[value]] });
    }
  }
  if (data.length === 0) return 0;
  // RAW — `26.09.30`이 날짜로 바뀌지 않고 시트의 기존 글자 표기 그대로 남게.
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data } });
  return taken.size;
}

/**
 * 적을 탭의 달 = 퇴원월(수강료를 낸 마지막 달, 원장 2026-10-29 *"퇴원관리 시트 연동도 동일한 조건"*) — 10/1에 그만뒀어도 9월까지만 냈으면
 * '26.9 퇴원' 탭. '최종퇴원일' 칸은 실제 날짜 그대로다. 학생이 퇴원했으면 수업료 전체로, 수학만 그만두고 다른 과목을 계속 다니면(수강종료)
 * **수학 수업료**를 낸 마지막 달로 본다(원장 2026-10-29 *"9월 퇴원생 여전히 10월퇴원으로 뜨는데"* — 퇴원관리·운영실과 같은 판정).
 * 청구를 못 읽으면 퇴원일의 달(종전 규칙)로 적고 로그를 남긴다 — 시트 기입은 다시 돌지 않아 줄을 잃는 것이 더 나쁘다.
 */
async function sheetTabDate(tenantId: string, studentId: string, date: string): Promise<string> {
  try {
    const { data, error } = await createAdminClient().from("students").select("status").eq("tenant_id", tenantId).eq("id", studentId).maybeSingle();
    if (error) throw error;
    if ((data as { status?: string } | null)?.status !== "withdrawn") {
      const settings = await getTenantSettingsByTenantId(tenantId);
      const ends = [{ studentId, tenantId, subject: "math", endedAt: date }];
      return (await loadSubjectExitCountDates(ends, settings.operations.subjects)).get(`${studentId}|math`) ?? date;
    }
    return (await loadExitCountDates([{ id: studentId, tenantId, withdrawnAt: date }])).get(studentId) ?? date;
  } catch (e) {
    reportError(e, { where: "withdrawal-sheet.exit-month", studentId, date });
    return date;
  }
}

/**
 * 이 학생이 `date`에 수학을 그만뒀으면 그 달 탭에 적는다. `enrollmentIds`를 주면 그 수강들만(수강 종료 화면에서 고른 것).
 * 던지지 않는다 — 결과는 로그로만.
 */
export async function recordMathWithdrawalToSheet(args: {
  tenantId: string;
  studentId: string;
  date: string;
  enrollmentIds?: readonly string[];
}): Promise<void> {
  const spreadsheetId = spreadsheetIdOf();
  if (!spreadsheetId) return;
  // 운영 콘솔의 '지점 보기'(읽기 전용) 중에는 바깥 시트에 적지 않는다(tenant-view-outbound.ts). 이 함수는 던지지 않으므로 조용히 건너뛴다.
  if (await tenantViewOutboundError()) return;
  const job = (async () => {
    if (!(await isSheetTenant(args.tenantId))) return;
    if (await licenseBlockReason(args.tenantId, "google_sheets")) return;
    const entries = await entriesFor(args.tenantId, args.studentId, args.date, args.enrollmentIds);
    if (entries.length === 0) return;
    const tabDate = await sheetTabDate(args.tenantId, args.studentId, args.date);
    const n = await serialized(() => writeEntries(spreadsheetId, entries, tabDate));
    if (n > 0) console.info(`[withdrawal-sheet] ${monthTabTitle(tabDate)} 탭에 ${n}줄 기입(student ${args.studentId})`);
  })();
  job.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      job,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("구글시트 응답 지연")), TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    reportError(new Error(`퇴원 시트 기입 실패: ${describeSheetsError(e)}`), {
      where: "withdrawal-sheet",
      studentId: args.studentId,
      date: args.date,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
