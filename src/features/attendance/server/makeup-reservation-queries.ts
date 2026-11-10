import "server-only";
import { attendanceDb } from "./read-context";

/**
 * 보강 예약(0264a) **조회** — 규칙은 순수부 [`makeup-reservation.ts`](../makeup-reservation.ts).
 *
 * 🔴 **fail-soft**([[#95]]) — 0264a가 아직 안 돌았으면(PGRST205/42P01) 빈 목록 = "예약 없음". 이 표는 부가 표시라
 *    조회 실패로 출석부·시간표·원스크린을 죽이지 않는다(원스크린은 강사 전원이 매일 여는 hot path다).
 *    그 밖의 실패는 서버 로그에만 남기고 역시 빈 목록이다 — 예약이 안 보이는 것이 화면이 안 열리는 것보다 낫다.
 * 🔴 읽기는 **세션 클라이언트**(RLS select 정책 = 테넌트 격리). 예외는 게이트 판정(`hasReservedMakeup`)과
 *    이행 훅 — 그건 admin + 명시 `tenant_id`([[#104]]).
 * ⚠️ 상태 `reserved`만 화면에 선다 — `done`은 그날 출결 행이 이미 칸을 채우고 있다(이력으로만 남는다).
 */
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { weekBoundsOf } from "@/features/timetable/lib/week";
import { isMakeupReportMode, type MakeupReservation } from "../makeup-reservation";
import { loadNativeParticipants } from "@/features/makeups/server/adapters/participants";
import { featureLive } from "@/features/makeups/types";
import { getTenantSettings } from "@/features/owner/server/queries";

type Sb = Awaited<ReturnType<typeof createClient>>;

/** 0264a 미적용 판별 — PostgREST는 없는 표를 PGRST205(스키마 캐시) 또는 42P01로 돌려준다. */
export function isMissingReservationTable(e: { code?: string; message?: string } | null | undefined): boolean {
  return (
    e?.code === "PGRST205" ||
    e?.code === "42P01" ||
    /makeup_reservations/.test(e?.message ?? "") && /not find|does not exist|schema cache/i.test(e?.message ?? "")
  );
}

const SELECT =
  "id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end, period_label, note, status, created_by";

type Row = {
  id: string;
  student_id: string;
  class_id: string;
  absence_date: string;
  makeup_date: string;
  slot_start: string;
  slot_end: string;
  period_label: string | null;
  note: string | null;
  status: string;
  created_by: string | null;
  /** 0438a — 이 칸을 읽는 조회(`getRosterReservationsOn`)에서만 실린다. */
  report_mode?: string | null;
  /** 0440a 결석난 반 — 결석일 칸을 다루는 조회(예약 단건·이행)에서만 실린다. */
  absence_class_id?: string | null;
  /** 0458a 보강 확인 — 원스크린 명단 조회(`getRosterReservationsOn`)에서만 실린다. */
  checked_at?: string | null;
};

type ClassRef = { class_name?: string | null };

/** 학생 상세 '예정된 변경' 배너가 읽는 한 줄 — 예약 + **원반 이름**(모르면 null, 지어내지 않는다). */
export type StudentUpcomingReservation = MakeupReservation & {
  className: string | null;
  origin?: "reservation" | "native" | "additional";
  caseId?: string | null;
};

const hhmm = (t: string | null | undefined) => String(t ?? "").slice(0, 5);

export function toReservation(r: Row): MakeupReservation {
  return {
    id: r.id,
    studentId: r.student_id,
    classId: r.class_id,
    absenceDate: String(r.absence_date).slice(0, 10),
    makeupDate: String(r.makeup_date).slice(0, 10),
    slotStart: hhmm(r.slot_start),
    slotEnd: hhmm(r.slot_end),
    periodLabel: r.period_label ?? null,
    note: r.note ?? null,
    status: r.status === "done" ? "done" : "reserved",
    createdBy: r.created_by ?? null,
    ...(r.report_mode !== undefined ? { reportMode: isMakeupReportMode(r.report_mode) ? r.report_mode : null } : {}),
    ...(r.absence_class_id !== undefined ? { absenceClassId: r.absence_class_id ?? null } : {}),
    ...(r.checked_at !== undefined ? { checkedAt: r.checked_at ?? null } : {}),
  };
}

/** 조회 실패를 빈 목록으로 접되 **원문은 서버 로그에** — 미적용은 조용히(매 요청 로그가 쌓이지 않게). */
function soft(where: string, error: { code?: string; message?: string } | null): MakeupReservation[] {
  if (error && !isMissingReservationTable(error)) console.error(`[makeup-reservation] ${where} 조회 실패`, error.message);
  return [];
}

/**
 * 한 반의 기간 예약(월별 출석부). 예약 상태만.
 * 🔴 반 × 기간이라 페이지네이션 없이 받는다 — 한 반의 한 달 예약이 1000건을 넘을 수 없다(명단 수십 × 결석).
 */
export async function getClassReservationsInRange(
  classId: string,
  from: string,
  to: string,
): Promise<MakeupReservation[]> {
  // 로그인 없는 출석부 조립 문맥이면 관리 클라이언트(반 id로 좁히는 조회 — read-context.ts).
  const { db: supabase } = await attendanceDb();
  const { data, error } = await supabase
    .from("makeup_reservations")
    .select(SELECT)
    .eq("class_id", classId)
    .eq("status", "reserved")
    .gte("makeup_date", from)
    .lte("makeup_date", to)
    .order("makeup_date")
    .order("slot_start");
  if (error) return soft("반·기간", error);
  return ((data ?? []) as Row[]).map(toReservation);
}

/**
 * 여러 반의 **한 날짜** 예약(일별 출석부·오늘 출결·원스크린·ECS). 반 id는 청크로(B3).
 * 요청당 1회 캐시 — 같은 페이지의 여러 조각이 같은 날짜를 묻는다.
 */
export const getReservationsOn = cache(async function getReservationsOn(
  date: string,
  classIds: readonly string[],
): Promise<MakeupReservation[]> {
  if (classIds.length === 0) return [];
  const supabase = await createClient();
  try {
    const rows = await fetchInChunks<Row>([...classIds], (chunk) =>
      supabase
        .from("makeup_reservations")
        .select(SELECT)
        .eq("makeup_date", date)
        .eq("status", "reserved")
        .in("class_id", chunk)
        .order("slot_start"),
    );
    return rows.map(toReservation);
  } catch (e) {
    return soft("날짜", e as { code?: string; message?: string });
  }
});

/**
 * `report_mode` 칸이 아직 없을 때의 오류(0438a 미적용) — 42703 "column … does not exist" / 스키마 캐시.
 * ⚠️ `fetchInChunks`는 코드를 버리고 문구만 넘기므로 문구로 판정한다.
 */
export function isMissingColumn(e: { message?: string } | null | undefined, column: string): boolean {
  const msg = e?.message ?? "";
  return msg.includes(column) && /does not exist|not find|schema cache/i.test(msg);
}
const isMissingReportMode = (e: { message?: string } | null | undefined) => isMissingColumn(e, "report_mode");

/**
 * 원스크린 명단용 **한 날짜 예약 — 예약·이행 둘 다 + 보고서 발송 방식**(원장 2026-10-22 전주율 건).
 * 이행(`done`)까지 읽는 까닭: 출석을 찍는 순간 예약이 `done`이 되는데, 그때 '정규+보강' 표시와 따로 낸 '(보강)' 줄이 새로고침에
 * 사라지면 보고서가 정규로만 저장된다. 표식은 `done`이고 예약 끝 시각이 지나야 '보강 완료'로 바뀐다(`reservedShownDone`, 원장 2026-10-27).
 * 🔴 fail-soft([[#95]]) — 표가 없으면 빈 목록, `report_mode` 칸이 없으면 그 칸 없이 다시 읽는다(방식 = null).
 *    보강 확인(`checked_at`, 0458a)도 같다 — 칸이 없으면 그 칸 없이 읽어 확인을 요구하지 않는다(원장 2026-10-27).
 *    🔴 보강관리(신규)가 켜진 지점(on·draining)도 읽지 않는다 — 연결 예약은 확인('했음/못 했음')을 쓸 수 없어(연결 게이트·0349a 트리거)
 *       표식·발송이 영영 막힌다(적대 리뷰 2026-10-27). 그 지점은 보강관리의 실시 기록이 확인이다.
 */
export const getRosterReservationsOn = cache(async function getRosterReservationsOn(
  date: string,
  classIds: readonly string[],
): Promise<MakeupReservation[]> {
  if (classIds.length === 0) return [];
  const supabase = await createClient();
  const read = (select: string) =>
    fetchInChunks<Row>([...classIds], (chunk) =>
      supabase
        .from("makeup_reservations")
        .select(select)
        .eq("makeup_date", date)
        .in("status", ["reserved", "done"])
        .in("class_id", chunk)
        .order("slot_start")
        // 동적 select 문자열이라 행 모양을 추론하지 못한다 — 실은 모양을 적는다.
        .returns<Row[]>(),
    );
  try {
    const live = featureLive((await getTenantSettings()).makeups.mode);
    return (await read(`${SELECT}, report_mode${live ? "" : ", checked_at"}`)).map(toReservation);
  } catch (e) {
    if (!isMissingColumn(e as { message?: string }, "checked_at") && !isMissingReportMode(e as { code?: string; message?: string })) {
      return soft("원스크린 날짜", e as { code?: string; message?: string });
    }
  }
  try {
    return (await read(`${SELECT}, report_mode`)).map(toReservation);
  } catch (e) {
    if (!isMissingReportMode(e as { code?: string; message?: string })) return soft("원스크린 날짜", e as { code?: string; message?: string });
  }
  try {
    return (await read(SELECT)).map(toReservation);
  } catch (e) {
    return soft("원스크린 날짜", e as { code?: string; message?: string });
  }
});

/**
 * **지점 전체**의 한 날짜 예약 — 반 집합 없이 날짜로만 읽는다(휴원일 입력 요약의 사무실 범위).
 *
 * `getReservationsOn`은 반 집합을 받는데, 호출부가 "그 요일에 수업이 있는 반"만 넘기면 정규 교시가 없는 날·시각에
 * 잡힌 보강이 빠진다. 사무실 범위는 반으로 좁힐 이유가 없으므로 날짜 하나로 읽는다(RLS = 지점 격리).
 * 🔴 강사 범위에서는 쓰지 않는다 — 남의 반 예약이 섞인다. 강사는 자기 반 집합을 `getReservationsOn`에 넘긴다(#77).
 * 페이징(B2 — 건수를 세는 데 쓴다) · fail-soft(표 없음·조회 실패 = 예약 없음, 위 규약 그대로).
 */
export async function getReservationsOnDate(date: string): Promise<MakeupReservation[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const supabase = await createClient();
  try {
    const rows = await fetchAllPaged<Row>((from, to) =>
      supabase
        .from("makeup_reservations")
        .select(SELECT)
        .eq("makeup_date", date)
        .eq("status", "reserved")
        .order("slot_start")
        .order("id")
        .range(from, to),
    );
    return rows.map(toReservation);
  } catch (e) {
    return soft("날짜(지점 전체)", e as { code?: string; message?: string });
  }
}

/**
 * 여러 반의 **기간** 예약 — 시간표 '보강' 탭(주)과 운영실 '보강예정' 카드(오늘부터 한 달 + 지난 미이행)가 **같은 조회**를 쓴다
 * (원장 2026-09-16 *"배선 오류 없이 아주 모든 곳에서 일치하도록"* — 기간만 다르고 세는 법은 한 벌).
 * `classIds`는 **그 화면이 보는 반**(강사 스코프 뒤)만 넘긴다 — 예약 표를 따로 스코핑하지 않고 화면의 반 집합을 그대로 쓴다
 * (남의 반 예약이 새지 않게, #77). 반 id 청크 × 페이지(B2·B3) — 기간이 석 달이면 한 청크가 1,000행을 넘을 수 있다.
 */
export async function getReservationsInRange(
  from: string,
  to: string,
  classIds: readonly string[],
): Promise<MakeupReservation[]> {
  if (classIds.length === 0) return [];
  const supabase = await createClient();
  try {
    const rows = await fetchAllPagedInChunks<Row>([...classIds], (chunk, pageFrom, pageTo) =>
      supabase
        .from("makeup_reservations")
        .select(SELECT)
        .eq("status", "reserved")
        .gte("makeup_date", from)
        .lte("makeup_date", to)
        .in("class_id", chunk)
        .order("makeup_date")
        .order("slot_start")
        .order("id")
        .range(pageFrom, pageTo),
    );
    return rows.map(toReservation);
  } catch (e) {
    return soft("기간", e as { code?: string; message?: string });
  }
}

/** 시간표 '보강' 탭 — 기준일이 든 주(월~일)의 예약. 조회는 `getReservationsInRange` 한 벌(운영실 카드와 같다). */
export async function getReservationsInWeek(
  referenceDate: string,
  classIds: readonly string[],
): Promise<MakeupReservation[]> {
  const { start, end } = weekBoundsOf(referenceDate);
  return getReservationsInRange(start, end, classIds);
}

/**
 * 한 학생의 **앞으로의** 예약(학생 상세 '예정된 변경' 배너). 오늘 포함 이후, 예약 상태만.
 * ⚠️ 원반 이름을 함께 받는다 — 배너 한 줄이 "어느 반의 보강인지"를 말해야 한다. 임베드는 **컬럼 이름**으로
 *    건다(`class:class_id`) — 관계 이름으로 걸면 남이 FK를 하나 더 추가하는 날 PGRST201로 죽는다([[#94]]).
 */
export async function getStudentUpcomingReservations(
  studentId: string,
  today: string,
): Promise<StudentUpcomingReservation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("makeup_reservations")
    .select(`${SELECT}, class:class_id ( class_name )`)
    .eq("student_id", studentId)
    .eq("status", "reserved")
    .gte("makeup_date", today)
    .order("makeup_date")
    .order("slot_start")
    .limit(50);
  // ⚠️ `soft`는 예약 배열(이름 없음)을 돌려주므로 여기선 **로그만** 빌리고 빈 목록으로 떨어진다.
  if (error) {
    soft("학생", error);
    return [];
  }
  const legacy = ((data ?? []) as (Row & { class?: ClassRef | ClassRef[] | null })[]).map((r) => ({
    ...toReservation(r),
    className: (Array.isArray(r.class) ? r.class[0] : r.class)?.class_name ?? null,
    origin: "reservation" as const,
    caseId: null as string | null,
  }));
  const nativeOutcome = await loadNativeParticipants({ student_id: studentId, date_from: today }, { sharedRead: true });
  if (nativeOutcome.status === "off" || nativeOutcome.status === "schema_missing") return legacy;
  if (nativeOutcome.status === "ok") {
    for (const map of nativeOutcome.value.legacyMaps) {
      const row = legacy.find((item) => item.id === map.legacyReservationId);
      if (row && map.caseId) row.caseId = map.caseId;
    }
  }
  if (nativeOutcome.status === "failed" || nativeOutcome.value.truncated) {
    throw new Error(nativeOutcome.status === "failed" ? nativeOutcome.error : "보강 참여 목록이 잘렸습니다");
  }
  const seen = new Set(legacy.map((row) => `${row.classId}|${row.makeupDate}|${row.slotStart}`));
  const native = nativeOutcome.value.participants.flatMap((row) => {
    if (row.status === "cancelled" || row.sessionDate < today) return [];
    const slotStart = (row.startTime ?? "").slice(0, 5);
    const key = `${row.classId ?? ""}|${row.sessionDate}|${slotStart}`;
    if (seen.has(key)) return [];
    return [{
      id: row.id, studentId: row.studentId, classId: row.classId ?? "", absenceDate: row.originalDate ?? "",
      makeupDate: row.sessionDate, slotStart, slotEnd: (row.endTime ?? "").slice(0, 5),
      periodLabel: null, note: null, status: "reserved" as const, createdBy: null, className: null,
      origin: "native" as const, caseId: row.caseIds[0] ?? null,
    }];
  });
  return [...legacy, ...native];
}

/**
 * 그 (학생·반·날짜)에 **예약이 있나** — 출결 저장 게이트가 "수강생도 아니고 기록도 없는 칸"을 열어 주는 근거
 * (예약된 학생은 그날 그 반에 오기로 한 사람이다 = 새 행까지 쓸 근거, `writeEligibility` — write-eligibility.ts).
 * 🔴 admin + 명시 `tenant_id`([[#104]]). 실패·미적용은 false(문을 넓히는 쪽으로 실패하지 않는다).
 */
export async function hasReservedMakeup(
  tenantId: string,
  key: { studentId: string; classId: string; date: string },
): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from("makeup_reservations")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("student_id", key.studentId)
      .eq("class_id", key.classId)
      .eq("makeup_date", key.date)
      .eq("status", "reserved");
    if (error) return false;
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

/** (학생·반·날짜) 칸 키 — 일괄·범위 게이트가 `reservedCellKeys` 결과와 대조한다. */
export const reservedCellKey = (c: { studentId: string; classId: string; date: string }) =>
  `${c.studentId}::${c.classId}::${c.date}`;

/**
 * 여러 칸 중 **예약(reserved)이 걸린 칸**의 키 집합 — 일괄·범위 저장의 강사 게이트용(`hasReservedMakeup`의 다건판).
 * 단건 게이트와 같은 뜻으로 문을 연다(수강행이 없어도 그날 그 반에 오기로 한 학생). 반 id 청크(B3) × 날짜 구간 한 번.
 * 🔴 fail-soft — 실패·미적용은 빈 집합(= 예약 없음 → 종전 게이트 그대로).
 */
export async function reservedCellKeys(
  tenantId: string,
  cells: readonly { studentId: string; classId: string; date: string }[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const valid = cells.filter((c) => !!c.studentId && !!c.classId && /^\d{4}-\d{2}-\d{2}$/.test(c.date));
  if (valid.length === 0) return out;
  const classIds = [...new Set(valid.map((c) => c.classId))];
  const dates = [...new Set(valid.map((c) => c.date))].sort();
  try {
    const admin = createAdminClient();
    const rows = await fetchInChunks<{ student_id: string; class_id: string; makeup_date: string }>(classIds, (chunk) =>
      admin
        .from("makeup_reservations")
        .select("student_id, class_id, makeup_date")
        .eq("tenant_id", tenantId)
        .eq("status", "reserved")
        .in("class_id", chunk)
        .gte("makeup_date", dates[0]!)
        .lte("makeup_date", dates[dates.length - 1]!),
    );
    for (const r of rows) {
      out.add(reservedCellKey({ studentId: r.student_id, classId: r.class_id, date: String(r.makeup_date).slice(0, 10) }));
    }
  } catch (e) {
    if (!isMissingReservationTable(e as { code?: string; message?: string })) {
      console.error("[makeup-reservation] 예약 칸 조회 실패", e instanceof Error ? e.message : e);
    }
  }
  return out;
}

/** 예약 행 하나(admin, 테넌트 필터) — 취소·이행이 읽는다. 없거나 실패면 null. */
export async function loadReservationById(tenantId: string, id: string): Promise<MakeupReservation | null> {
  try {
    const admin = createAdminClient();
    // 결석난 반(0440a)까지 — 취소가 결석일 칸을 되돌린다. 칸이 없으면(적용 전) 칸 없이 다시 읽는다(= 기록할 반과 같은 반).
    const read = (select: string) =>
      admin.from("makeup_reservations").select(select).eq("tenant_id", tenantId).eq("id", id).maybeSingle<Row>();
    let { data, error } = await read(`${SELECT}, absence_class_id`);
    if (error && isMissingColumn(error, "absence_class_id")) ({ data, error } = await read(SELECT));
    if (error || !data) return null;
    return toReservation(data);
  } catch {
    return null;
  }
}

/** 예약을 만든 사람 이름(감사·툴팁) — 같은 학원 직원만. 실패는 빈 맵. */
export async function getReservationCreatorNames(
  supabase: Sb,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  try {
    const rows = await fetchInChunks<{ id: string; display_name: string | null }>(ids, (chunk) =>
      supabase.from("users").select("id, display_name").in("id", chunk),
    );
    return new Map(rows.map((r) => [r.id, r.display_name ?? ""]));
  } catch {
    return new Map();
  }
}
