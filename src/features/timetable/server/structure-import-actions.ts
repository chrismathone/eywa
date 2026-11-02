"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { canManageSheetSync, SHEET_ACCESS_DENIED_MSG } from "@/features/integrations/server/sheet-access";
import { logAction } from "@/features/audit/server/log";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { shiftDays } from "@/features/timetable/lib/week";
import { sheetsProvider, supportsStructureImport } from "@/features/integrations/sheets-provider";
import { getTeacherLabelMapStrict } from "@/features/timetable/server/queries";
import { resolveTeacherLabel } from "@/features/timetable/lib/teacher-label";
import {
  claimSheetSyncLease,
  releaseSheetSyncLease,
  SHEET_SYNC_BUSY_MSG,
} from "@/features/integrations/server/sheet-sync-lease";
import { readSheetGridWithMerges } from "@/features/integrations/google-sheets";
import { TEACHER_SHEET_NAME } from "@/features/exports/english-timetable/teacher-grid-sheet";
import { normalizeEffectiveDate } from "@/features/timetable/import/effective-date";
import { parseAywaTeacherGrid } from "@/features/timetable/import/structure/parse-aywa-grid";
import { checkAywaGridShape } from "@/features/timetable/import/structure/aywa-grid-shape";
import { matchStructure } from "@/features/timetable/import/structure/match";
import { computeStructureDiff } from "@/features/timetable/import/structure/diff";
import { conflictChecklist, conflictKeys, describeConflict } from "@/features/timetable/import/structure/conflicts";
import { buildClassUpdates } from "@/features/timetable/import/structure/class-updates";
import type { DayOfWeek } from "@/features/timetable/lib/periods";
import type {
  DryRunReport,
  ExistingContext,
  ExistingSchedule,
  MatchResult,
  SchedulePlanItem,
} from "@/features/timetable/import/structure/types";

const SUBJECT = "english"; // 구조 import 지원 과목(현재 영어 전용).

/** 적용일보다 늦게 시작하도록 이미 예약된 슬롯 — 새로 넣는 행의 `valid_to` 상한이 된다. */
type PendingLaterSlot = { classId: string; day: DayOfWeek; startTime: string; validFrom: string };
const slotKey = (s: { classId: string; day: string; startTime: string }) => `${s.classId}|${s.day}|${s.startTime}`;
/** ⚠️ 화면에 나가는 문구엔 raw enum(`mon`)을 그대로 쓰지 않는다(UI 영문 코드 노출 금지). */
const KO_DAY: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
/** 슬롯키 → 가장 이른 예약 시작일(그 하루 전이 새 행의 valid_to가 된다). */
function pendingLaterByKey(rows: readonly PendingLaterSlot[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    const k = slotKey(r);
    const cur = m.get(k);
    if (cur === undefined || r.validFrom < cur) m.set(k, r.validFrom);
  }
  return m;
}

/**
 * 강사별 그리드 시트(마스터) + class_schedules(영어·활성)를 로드해 매칭 컨텍스트를 만든다.
 * RLS로 테넌트 자동 격리 + subject='english' 명시 스코프. `fetchAllPaged`(B2 절단 방지).
 *
 * 🔴 유효 판정은 오늘이 아니라 **적용일(asOf) 기준**이다. 미래 적용일로 한 번 가져오면 그 날짜부터
 *    유효한 행이 이미 들어가 있는데(valid_from=적용일), 컨텍스트를 오늘로 읽으면 그 행이 안 보여
 *    "아직 없다"고 판단해 **같은 슬롯을 한 벌 더 넣는다**(그날 칸이 두 번 그려진다). 같은 날짜로 다시
 *    가져오면 "변경 없음"이 나오는 것이 옳다.
 */
async function loadStructureContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  asOf: string,
): Promise<{ ctx: ExistingContext; existing: ExistingSchedule[]; pendingLater: PendingLaterSlot[] }> {
  const today = asOf;
  const hm = (t: string | null) => (t ? String(t).slice(0, 5) : null);

  // 🔴 라벨맵 = '시트 반영'(export)이 강사 밴드를 쓸 때 쓰는 것과 **같은 해석기**(queries.ts와 한 소스).
  //    안 태우면 시트엔 `추민아`가 적히는데 DB엔 `Jane`이 남아 비교가 전건 어긋난다(아래 slotTeacherDisplay).
  // 🔴 **종강일이 적용일 전인 반은 없는 반이다**(시간표가 그날부터 숨긴다 · 영어 시트 반영 master-sheet-store와 같은 기준).
  //    is_active만 보면 종강(closed_at)한 반의 남은 배치가 "시트에 없다 → 제거(종료)"로 떠서, 시간표에도 시트에도 없는 반을
  //    지운다고 나왔다(원장 2026-11-02 LS4b · *"없는 반인데 갑자기 삭제를 한다고?"*). 종강은 이제 배치도 닫지만 옛 기록이 남는다.
  const openOn = (closedAt: string | null | undefined) => !closedAt || String(closedAt).slice(0, 10) >= today;
  const [allClasses, users, rooms, allSched, labelMap] = await Promise.all([
    fetchAllPaged<{ id: string; class_name: string; subject: string; teacher_id: string | null; classroom_id: string | null; closed_at: string | null }>(
      (from, to) =>
        supabase.from("classes").select("id, class_name, subject, teacher_id, classroom_id, closed_at").eq("subject", SUBJECT).eq("is_active", true).range(from, to),
    ),
    fetchAllPaged<{ id: string; display_name: string; english_name: string | null; system_role: string }>(
      (from, to) => supabase.from("users").select("id, display_name, english_name, system_role").eq("status", "active").range(from, to),
    ),
    // 🔴 **보관된 강의실은 후보에서 뺀다**(원장 2026-08-31 *"바른602는 더이상 사용하지 않는 강의실임.
    //    절대 그럴일이 없어야함"*). 시트는 방을 **번호만으로** 적는데(`602`) 그 번호를 쓰는 방이 둘이면
    //    (`바른602`·`본원602`) 매칭 맵이 뒤엣것으로 덮여 **폐강의실에 배치가 붙는다** — 실측 2026-08-31:
    //    원장이 8/6에 보관해 둔 `바른602`에 9월 배치 6칸이 붙었다. 보관은 이미 눌러 두셨는데 가져오기만
    //    그 표시를 안 보고 있었다. ⚠️ 이름 조회(id→이름)에는 이 필터를 걸지 말 것 — 지난 배치가 쓰던
    //    보관 강의실 이름이 화면에서 빈칸이 된다(여긴 **후보 목록**이라 거른다).
    fetchAllPaged<{ id: string; name: string }>((from, to) =>
      supabase.from("classrooms").select("id, name").is("archived_at", null).range(from, to),
    ),
    fetchAllPaged<{
      id: string; class_id: string; day_of_week: string; start_time: string; end_time: string;
      teacher_id: string | null; classroom_id: string | null; slot_teacher_label: string | null;
      slot_room_label: string | null; merge_group: string | null; valid_from: string; valid_to: string | null;
      class?: { class_name?: string; subject?: string; is_active?: boolean; closed_at?: string | null } | { class_name?: string; closed_at?: string | null }[];
    }>((from, to) =>
      supabase
        .from("class_schedules")
        .select(
          "id, class_id, day_of_week, start_time, end_time, teacher_id, classroom_id, slot_teacher_label, slot_room_label, merge_group, valid_from, valid_to, class:class_id!inner ( class_name, subject, is_active, closed_at )",
        )
        .eq("class.subject", SUBJECT)
        .eq("class.is_active", true)
        // 🔴 valid_from 상한을 걸지 않는다 — **적용일보다 늦게 시작하는 예약 행**도 알아야 한다(아래 pendingLater).
        //    걸러 버리면 그 행이 안 보인 채 새 행을 valid_to=null로 넣어, 그 예약일부터 같은 칸이 두 번 그려진다.
        .or(`valid_to.is.null,valid_to.gte.${today}`)
        .range(from, to),
    ),
    getTeacherLabelMapStrict(),
  ]);
  const classes = allClasses.filter((c) => openOn(c.closed_at));
  const sched = allSched.filter((s) => openOn((Array.isArray(s.class) ? s.class[0] : s.class)?.closed_at));

  const ctx: ExistingContext = {
    classes: classes.map((c) => ({ id: c.id, className: c.class_name, subject: c.subject, teacherId: c.teacher_id, classroomId: c.classroom_id })),
    teachers: users.map((u) => ({ id: u.id, englishName: u.english_name, displayName: u.display_name, systemRole: u.system_role })),
    classrooms: rooms.map((r) => ({ id: r.id, name: r.name })),
  };
  // 적용일보다 **늦게** 시작하는 예약 행 — diff 대상이 아니라 "새 배치가 언제까지 유효한가"의 상한이다.
  const pendingLater: PendingLaterSlot[] = sched
    .filter((s) => String(s.valid_from).slice(0, 10) > today)
    .map((s) => ({
      classId: s.class_id,
      day: s.day_of_week as DayOfWeek,
      startTime: hm(s.start_time)!,
      validFrom: String(s.valid_from).slice(0, 10),
    }));
  const existing: ExistingSchedule[] = sched
    .filter((s) => String(s.valid_from).slice(0, 10) <= today)
    .map((s) => {
    const cl = (Array.isArray(s.class) ? s.class[0] : s.class) as { class_name?: string } | undefined;
    return {
      id: s.id, classId: s.class_id, className: cl?.class_name ?? "", day: s.day_of_week as DayOfWeek,
      startTime: hm(s.start_time)!, endTime: hm(s.end_time), teacherId: s.teacher_id, classroomId: s.classroom_id,
      slotTeacherLabel: s.slot_teacher_label,
      // 원문은 그대로 두고(저장·동기의 원본) **비교용 해석값만** 덧붙인다 — diff가 두 값 다 보고 판정한다.
      slotTeacherDisplay: resolveTeacherLabel(s.slot_teacher_label, labelMap),
      slotRoomLabel: s.slot_room_label, mergeGroup: s.merge_group,
      validFrom: s.valid_from, validTo: s.valid_to,
    };
  });
  return { ctx, existing, pendingLater };
}

/**
 * 시트+DB를 지금 다시 읽어 diff를 재계산(무쓰기). preview·apply의 단일 소스 —
 * apply는 이 결과의 hash를 클라 미리보기 hash와 대조하고, 이 결과로 payload를 만든다(클라 계획 불신).
 */
async function computeFresh(
  supabase: Awaited<ReturnType<typeof createClient>>,
  subject: string,
  asOf: string,
): Promise<
  | { error: string }
  | {
      report: DryRunReport;
      match: MatchResult;
      existing: ExistingSchedule[];
      ctx: ExistingContext;
      pendingLater: PendingLaterSlot[];
    }
> {
  const { data } = await supabase
    .from("user_integrations")
    .select("spreadsheet_id, sync_enabled")
    .eq("provider", sheetsProvider(subject))
    .maybeSingle();
  if (data?.sync_enabled !== true) return { error: "구글 시트 연동이 꺼져 있습니다(학원 설정 › 연동에서 켜세요)" };
  const spreadsheetId = data?.spreadsheet_id?.trim();
  if (!spreadsheetId) return { error: "대상 구글 시트가 설정되지 않았습니다(관리자에게 문의)" };

  const grid = await readSheetGridWithMerges(spreadsheetId, TEACHER_SHEET_NAME);
  // 🔴 파싱보다 먼저 **격자 모양**을 본다. 마스터 시트를 이 탭에 붙여넣으면 행이 맞아떨어져 파싱은
  //    성공하는데 A열이 12시간제라 모든 수업이 12시간 앞으로 들어간다(에러 없이 조용히 틀린다).
  const shape = checkAywaGridShape(grid);
  if (shape) return { error: shape };
  const parsed = parseAywaTeacherGrid(grid);
  if (parsed.slots.length === 0) return { error: `'${TEACHER_SHEET_NAME}' 탭에 데이터가 없습니다(시트를 확인하세요).` };
  const { ctx, existing, pendingLater } = await loadStructureContext(supabase, asOf);
  const match = matchStructure(parsed, ctx);
  const report = computeStructureDiff(match, existing);
  // 새 행이 **언제까지** 유효한지 사람에게 알린다 — 그 뒤로는 먼저 예약된 배치가 이긴다(아래 apply가 valid_to를 건다).
  const laterByKey = pendingLaterByKey(pendingLater);
  for (const p of report.planItems) {
    if (p.action !== "create" && p.action !== "update") continue;
    const until = p.classId ? laterByKey.get(slotKey({ classId: p.classId, day: p.day, startTime: p.startTime })) : undefined;
    if (until)
      report.warnings.push(
        `"${p.className}" ${KO_DAY[p.day] ?? p.day} ${p.startTime}은 ${until}부터 이미 다른 배치가 예약돼 있습니다 — 이번 변경은 그 전날까지만 유효합니다.`,
      );
  }
  return { report, match, existing, ctx, pendingLater };
}

export type PreviewStructureState = {
  error?: string;
  report?: DryRunReport;
  /** 이 미리보기가 기준으로 삼은 적용일(서버 확정값) — 화면이 "며칠부터"를 이 값으로 말한다. */
  effectiveDate?: string;
};

/**
 * 강사별 그리드 시트 → class_schedules 변경 **미리보기**(dry-run). **DB 미변경**.
 * ⚠️ master 전용(시트 전체를 읽음, syncSheetsNow와 대칭 B5). apply는 이 report를 신뢰하지 않고
 * 서버가 재계산(hash 대조)하므로, 이 액션은 순수 조회.
 */
export async function previewStructureImport(
  subject: string = SUBJECT,
  effectiveDateRaw?: string,
): Promise<PreviewStructureState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageSheetSync(user.systemRole))) return { error: SHEET_ACCESS_DENIED_MSG };
  if (!supportsStructureImport(subject)) return { error: "구조 가져오기는 영어 시간표만 지원합니다" };
  // 적용일 검증은 클라와 같은 순수 규칙으로 서버가 다시 한다(클라 값 불신 — apply와 동일 관문).
  const eff = normalizeEffectiveDate(effectiveDateRaw, kstToday());
  if ("error" in eff) return { error: eff.error };

  const supabase = await createClient();
  try {
    const fresh = await computeFresh(supabase, subject, eff.date);
    if ("error" in fresh) return { error: fresh.error };
    return { report: fresh.report, effectiveDate: eff.date };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "시트 읽기 실패" };
  }
}

/** apply payload — RPC apply_english_structure(p_payload)가 원자 실행. 서버 재계산 결과에서만 구성. */
interface ApplyInsert {
  id: string; classId: string; day: DayOfWeek; startTime: string; endTime: string | null;
  teacherId: string | null; classroomId: string | null; slotTeacherLabel: string | null; slotRoomLabel: string | null;
  /**
   * 이 행의 유효 종료일. 평소엔 `null`(무기한)이지만, **같은 칸에 더 늦은 날짜로 예약된 배치가 있으면**
   * 그 하루 전으로 닫는다 — 안 닫으면 그 예약일부터 옛/새 행이 둘 다 살아 같은 칸이 두 번 그려진다.
   */
  validTo: string | null;
}

export type ApplyStructureState = {
  error?: string;
  staleHash?: string; // hash 불일치 시 서버 재계산 hash(클라가 재미리보기 유도)
  /** 확인 목록이 어긋났을 때 서버가 재계산한 체크 대상 키 — 클라가 재미리보기로 유도한다. */
  staleConflicts?: string[];
  applied?: { closed: number; inserted: number; classUpdated: number };
  /** 실제로 적용된 날짜 — 화면이 "그 주 시간표 보기"로 안내하는 근거(예약이면 오늘과 다르다). */
  effectiveDate?: string;
  snapshotId?: string | null;
  noop?: boolean;
};

/**
 * 미리보기에서 확인한 변경 계획을 **적용**(class_schedules 쓰기). ⚠️ 프로덕션 반영.
 * 리뷰 3조건: ① 서버 재검증(시트+DB 재읽기·재계산, 클라 hash와 대조 — 불신), ② 원자 RPC,
 * ③ temporal(마감+삽입) + 스냅샷 + 롤백. tenant + subject='english' 스코프 밖 무변경.
 */
export async function applyStructureImport(
  expectedHash: string,
  subject: string = SUBJECT,
  effectiveDateRaw?: string,
  acknowledgedConflicts?: readonly string[],
): Promise<ApplyStructureState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageSheetSync(user.systemRole))) return { error: SHEET_ACCESS_DENIED_MSG };
  if (!(await canWriteTenant(user.systemRole, "classes"))) return { error: "시간표 관리 권한이 없습니다" };
  if (!supportsStructureImport(subject)) return { error: "구조 가져오기는 영어 시간표만 지원합니다" };
  // 🔴 적용일은 클라가 보낸 값을 그대로 쓰지 않는다 — 서버가 같은 순수 규칙으로 재검증(과거·상한 초과 거절).
  const eff = normalizeEffectiveDate(effectiveDateRaw, kstToday());
  if ("error" in eff) return { error: eff.error };

  const supabase = await createClient();

  // 동시 실행 직렬화 — '시트 반영'(DB→시트 통째 교체)과 같은 리스 공유. 재읽기(computeFresh)~RPC 사이에
  // 반영이 시트를 갈아치우거나, 반대로 apply 중 반영이 끼어드는 교차 실행을 서버에서 차단.
  const provider = sheetsProvider(subject);
  const lease = await claimSheetSyncLease(supabase, provider);
  if (lease === "busy") return { error: SHEET_SYNC_BUSY_MSG };

  try {
  let fresh;
  try {
    // 미리보기와 **같은 적용일 기준**으로 재계산해야 hash가 맞는다(날짜가 바뀌면 diff도 바뀔 수 있다).
    fresh = await computeFresh(supabase, subject, eff.date);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "시트 읽기 실패" };
  }
  if ("error" in fresh) return { error: fresh.error };
  const { report, match, existing, ctx, pendingLater } = fresh;

  // ① 서버 재검증 — 미리보기 이후 시트/시간표가 바뀌면 hash 불일치 → 중단(재미리보기 유도).
  if (report.hash !== expectedHash)
    return { error: "시트 또는 시간표가 미리보기 이후 변경되었습니다. 다시 미리보기 후 적용하세요.", staleHash: report.hash };

  // ①-b 충돌 확인 게이트(원장 2026-08-28 *"체크리스트가 만들어지고, 체크리스트 해제시에만 적용가능하게"*).
  // 🔴 화면에서 버튼을 잠그는 것만으로는 게이트가 아니다([[#77]]) — 서버가 **재계산한 목록**과 클라가
  //    확인했다고 보낸 목록이 **정확히 같아야** 통과시킨다. 그래야 ⓐ 확인 안 한 채로 부르는 호출과
  //    ⓑ 미리보기 이후 충돌이 새로 생긴 경우(hash가 같아도 가능하다)가 둘 다 막힌다.
  //    합반은 목록에 없다(경고일 뿐 적용을 막지 않는다 — conflictChecklist가 이미 걸러 준다).
  const needAck = conflictKeys(conflictChecklist(report.conflicts));
  const gotAck = [...new Set(acknowledgedConflicts ?? [])].sort();
  if (needAck.join(" ") !== gotAck.join(" ")) {
    const shown = conflictChecklist(report.conflicts).slice(0, 3).map(describeConflict).join(" / ");
    return {
      error:
        needAck.length === 0
          ? "확인이 필요한 충돌이 없어졌습니다 — 다시 불러온 뒤 적용하세요."
          : `확인이 필요한 충돌 ${needAck.length}건을 모두 확인해야 적용할 수 있습니다.${shown ? ` (${shown})` : ""}`,
      staleConflicts: needAck,
    };
  }

  const changeItems = report.planItems.filter((p) => p.action !== "keep");
  if (changeItems.length === 0)
    return { applied: { closed: 0, inserted: 0, classUpdated: 0 }, effectiveDate: eff.date, snapshotId: null, noop: true };

  // closes = update·remove 대상 기존 행(id + 이전 valid_to → 롤백 복원).
  const validToById = new Map(existing.map((e) => [e.id, e.validTo]));
  const closes = report.planItems
    .filter((p) => (p.action === "update" || p.action === "remove") && p.scheduleId)
    .map((p) => ({ id: p.scheduleId!, prevValidTo: validToById.get(p.scheduleId!) ?? null }));

  // inserts = create·update 신규 행(서버 생성 UUID — 롤백 식별). 신규 반(classId null)은 제외.
  const laterByKey = pendingLaterByKey(pendingLater);
  /** 같은 칸에 더 늦은 예약이 있으면 그 하루 전까지만 — 없으면 무기한(null). */
  const boundValidTo = (p: SchedulePlanItem): string | null => {
    const until = laterByKey.get(slotKey({ classId: p.classId!, day: p.day, startTime: p.startTime }));
    return until ? shiftDays(until, -1) : null;
  };
  const inserts: ApplyInsert[] = report.planItems
    .filter((p) => (p.action === "create" || p.action === "update") && p.classId)
    .map((p) => ({
      id: crypto.randomUUID(),
      classId: p.classId!,
      validTo: boundValidTo(p),
      day: p.day,
      startTime: p.startTime,
      endTime: p.endTime,
      teacherId: p.teacherId ?? null,
      classroomId: p.classroomId ?? null,
      slotTeacherLabel: p.teacherNames[0] ?? null,
      slotRoomLabel: p.room,
    }));

  // classes 담임/강의실 동기화는 **변경된 반만**(수학 가져오기와 동일 원칙 — 변경분만 건드림).
  const changedClassIds = new Set(
    report.planItems.filter((p) => p.action !== "keep" && p.classId).map((p) => p.classId!),
  );
  const classUpdates = buildClassUpdates(match, ctx, changedClassIds);
  // 🔴 RPC의 `p_today`는 "오늘"이 아니라 **적용 기준일**이다(옛 행 valid_to=기준일-1, 새 행 valid_from=기준일).
  const today = eff.date;
  const payload = {
    label: "영어 시트 구조 import",
    hash: report.hash,
    summary: report.plan,
    closes,
    inserts,
    classUpdates,
    planItems: report.planItems,
  };

  const { data, error } = await supabase.rpc("apply_english_structure", { p_payload: payload, p_today: today });
  if (error) return { error: error.message };
  const res = (data ?? {}) as { snapshotId?: string; closed?: number; inserted?: number; classUpdated?: number };

  // 감사로그 — 한 번에 수백 칸의 배치와 담임이 바뀌는 동작이라, 되돌릴 근거(`snapshotId`)와 언제부터인지
  // (`effectiveDate`)를 한 줄로 남긴다(건별 계획은 스냅샷 payload에 있다). 🔴 `acknowledgedConflicts`도
  // 싣는다 — 차단 충돌을 **누가 확인하고 밀어붙였는지**가 나중에 "왜 이 반이 겹쳤나"의 유일한 답이다.
  await logAction({
    action: "timetable_structure_apply",
    targetType: "timetable",
    targetLabel: "영어 시트 구조",
    metadata: {
      subject,
      effectiveDate: eff.date,
      // 예약 적용(오늘이 아님)이면 실제 반영은 그날 일어난다 — 감사로그에서 둘을 구분할 수 있어야 한다.
      scheduled: eff.date > kstToday(),
      closed: res.closed ?? 0,
      inserted: res.inserted ?? 0,
      classUpdated: res.classUpdated ?? 0,
      acknowledgedConflicts: needAck.length,
      snapshotId: res.snapshotId ?? null,
    },
  });

  revalidatePath("/timetable");
  return {
    applied: { closed: res.closed ?? 0, inserted: res.inserted ?? 0, classUpdated: res.classUpdated ?? 0 },
    effectiveDate: eff.date,
    snapshotId: res.snapshotId ?? null,
  };
  } finally {
    if (lease === "claimed") await releaseSheetSyncLease(supabase, provider);
  }
}

export type RollbackStructureState = {
  error?: string;
  reverted?: { deleted: number; restored: number; classReverted: number };
};

/** 구조 import 적용을 스냅샷으로 되돌린다(삽입행 삭제 + 마감행 valid_to 복원 + classes prev 복원). */
export async function rollbackStructureImport(snapshotId: string): Promise<RollbackStructureState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageSheetSync(user.systemRole))) return { error: SHEET_ACCESS_DENIED_MSG };
  if (!(await canWriteTenant(user.systemRole, "classes"))) return { error: "시간표 관리 권한이 없습니다" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rollback_english_structure", { p_snapshot_id: snapshotId });
  if (error) return { error: error.message };
  const res = (data ?? {}) as { deleted?: number; restored?: number; classReverted?: number };

  // 🔴 되돌리기는 반드시 남긴다 — 적용만 기록하면 "적용은 있는데 지금 시간표엔 없다"가 되어, 되돌린
  //    사람을 찾을 방법이 0이 된다(적용 로그의 snapshotId와 같은 값으로 짝이 맞춰진다).
  await logAction({
    action: "timetable_structure_rollback",
    targetType: "timetable",
    targetLabel: "영어 시트 구조",
    metadata: {
      snapshotId,
      deleted: res.deleted ?? 0,
      restored: res.restored ?? 0,
      classReverted: res.classReverted ?? 0,
    },
  });

  revalidatePath("/timetable");
  return { reverted: { deleted: res.deleted ?? 0, restored: res.restored ?? 0, classReverted: res.classReverted ?? 0 } };
}
