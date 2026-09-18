import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { resolveTenantReadUrls } from "@/lib/storage/media-storage";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { specialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { isMissingTextbookTable } from "./access";
import type {
  ClassSlotChoice,
  ClassTextbookPlanRow,
  TextbookDetail,
  TextbookListItem,
  TextbookLessonRow,
  TextbookRow,
  TextbookTableStatus,
} from "../types";
import { slotPickKey } from "../lesson-schedule";
import type { LessonPace, SlotAxis } from "../lesson-schedule";

/**
 * 교재목록 조회 — **admin 클라이언트 + `tenant_id` 명시 필터**.
 * 표는 select 정책이 있어 세션 클라이언트로도 읽히지만, 쓰기 액션과 같은 경로를 쓰면 "읽을 땐 되는데
 * 쓸 땐 0행"류의 비대칭이 안 생긴다(ECS `class_sheet_*`와 같은 결). 🔴 admin은 RLS 우회라 tenant 필터 필수.
 */

const PAGE_SIZE = 50;

export type TextbookListResult = {
  status: TextbookTableStatus;
  rows: TextbookListItem[];
  /** 전체 건수(필터 적용). 조회 실패면 null — **0을 쓰지 않는다**(0은 "없다"는 거짓말). */
  total: number | null;
  page: number;
  pageSize: number;
};

function classify(error: { code?: string; message?: string } | null): TextbookTableStatus {
  if (!error) return "ok";
  return isMissingTextbookTable(error) ? "missing-table" : "failed";
}

type TextbookDbRow = {
  id: string;
  subject: string;
  skill_area: string | null;
  title: string;
  page_time: string | null;
  session_count: number;
  cover_path: string | null;
  updated_at: string;
};

function toRow(r: TextbookDbRow): TextbookRow {
  return {
    id: r.id,
    subject: r.subject,
    skillArea: r.skill_area,
    title: r.title,
    pageTime: r.page_time,
    sessionCount: Number(r.session_count ?? 0),
    coverPath: r.cover_path,
    updatedAt: r.updated_at,
  };
}

// ⚠️ `is_active`는 읽지 않는다 — 폐지를 삭제로 바꿔(원장 2026-09-16) 아무도 false로 만들지 않는다.
//    컬럼은 0266a에 그대로 남기고(이미 적용된 표라 건드릴 이유가 없다) 화면은 그 칸을 보지 않는다.
const LIST_COLS = "id, subject, skill_area, title, page_time, session_count, cover_path, updated_at";

export async function getTextbooks(opts: {
  subject?: string | null;
  skillArea?: string | null;
  q?: string | null;
  page?: number;
}): Promise<TextbookListResult> {
  const user = await getCurrentUser();
  const page = Math.max(1, opts.page ?? 1);
  const empty: TextbookListResult = { status: "ok", rows: [], total: 0, page, pageSize: PAGE_SIZE };
  if (!user) return empty;

  const admin = createAdminClient();
  let query = admin
    .from("textbooks")
    .select(LIST_COLS, { count: "exact" })
    .eq("tenant_id", user.tenantId);
  if (opts.subject) query = query.eq("subject", opts.subject);
  if (opts.skillArea) query = query.eq("skill_area", opts.skillArea);
  // ⚠️ `is_active`로 거르지 않는다 — 폐지(감추기)는 폐기된 개념이라(원장 2026-09-16 "폐지말고 삭제로")
  //    거르면 그렇게 남은 옛 행이 **영영 안 보이고 지울 수도 없다**(게다가 이름을 계속 점유한다).
  const term = (opts.q ?? "").trim();
  // ⚠️ 콤마·괄호는 PostgREST 필터 문법에서 구분자라 떼어낸다(`PL (NTA)` 같은 실제 교재명 대응).
  //    `%`·`_`는 LIKE 와일드카드라 그대로 두면 `100%`가 아무거나 잡는다 — 문자로 escape한다.
  if (term) {
    const safe = term
      .replace(/[,()]/g, " ")
      .replace(/[%_\\]/g, (c) => `\\${c}`)
      .trim();
    if (safe) query = query.ilike("title", `%${safe}%`);
  }

  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await query
    .order("skill_area", { ascending: true, nullsFirst: false })
    .order("title", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);

  // ⚠️ 오래된 즐겨찾기(`?page=3`)로 범위 밖을 요청하면 PostgREST가 `PGRST103`을 준다 — 그건 **실패가
  //    아니라 빈 페이지**다. 실패로 보면 붉은 배너가 뜨고 등록·배정 버튼까지 잠긴다.
  if (error?.code === "PGRST103") {
    return { status: "ok", rows: [], total: count ?? null, page, pageSize: PAGE_SIZE };
  }
  const status = classify(error);
  if (status !== "ok" || !data) return { status, rows: [], total: null, page, pageSize: PAGE_SIZE };

  const rows = (data as unknown as TextbookDbRow[]).map(toRow);
  const ids = rows.map((r) => r.id);

  // 이 **페이지의 교재만** 센다 — 전건 lessons를 끌어오면 (교재 250 × 차수 20)에서 1000행 절단(B2).
  // 🔴 건수 조회가 실패하면 **0이 아니라 null**을 준다([[#89]]·이 파일 `total` 주석과 같은 규약) —
  //    `0/20`·`—`는 "하나도 안 적었다"는 거짓말이고, 그걸 보고 사람이 다시 적는다.
  const [lessonRows, planRows, coverUrls] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([] as { textbook_id: string; progress: string | null; homework: string | null }[])
      : fetchAllPagedInChunks<{ textbook_id: string; progress: string | null; homework: string | null }>(
          ids,
          (chunk, f, t) =>
            admin
              .from("textbook_lessons")
              .select("textbook_id, progress, homework")
              .eq("tenant_id", user.tenantId)
              .in("textbook_id", chunk)
              .order("textbook_id", { ascending: true })
              .order("lesson_no", { ascending: true })
              .range(f, t),
        ).catch(() => null),
    ids.length === 0
      ? Promise.resolve([] as { textbook_id: string }[])
      : fetchAllPagedInChunks<{ textbook_id: string }>(ids, (chunk, f, t) =>
          admin
            .from("class_textbook_plans")
            .select("textbook_id, id")
            .eq("tenant_id", user.tenantId)
            .eq("is_active", true)
            .in("textbook_id", chunk)
            .order("id", { ascending: true })
            .range(f, t),
        ).catch(() => null),
    resolveTenantReadUrls(
      rows.map((r) => r.coverPath).filter((p): p is string => !!p),
      "textbook_cover",
      user.tenantId,
    ).catch(() => ({}) as Record<string, string>),
  ]);

  const filled = new Map<string, number>();
  for (const l of lessonRows ?? []) {
    if (!(l.progress ?? "").trim() && !(l.homework ?? "").trim()) continue;
    filled.set(l.textbook_id, (filled.get(l.textbook_id) ?? 0) + 1);
  }
  const plans = new Map<string, number>();
  for (const p of planRows ?? []) plans.set(p.textbook_id, (plans.get(p.textbook_id) ?? 0) + 1);

  return {
    status: "ok",
    total: count ?? null,
    page,
    pageSize: PAGE_SIZE,
    rows: rows.map((r) => ({
      ...r,
      coverUrl: r.coverPath ? (coverUrls[r.coverPath] ?? null) : null,
      filledLessons: lessonRows === null ? null : (filled.get(r.id) ?? 0),
      planCount: planRows === null ? null : (plans.get(r.id) ?? 0),
    })),
  };
}

export async function getTextbookDetail(
  id: string,
): Promise<{ status: TextbookTableStatus; detail: TextbookDetail | null }> {
  const user = await getCurrentUser();
  if (!user) return { status: "ok", detail: null };
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("textbooks")
    .select(LIST_COLS)
    .eq("tenant_id", user.tenantId)
    .eq("id", id)
    .maybeSingle();
  const status = classify(error);
  if (status !== "ok") return { status, detail: null };
  if (!data) return { status: "ok", detail: null };

  const textbook = toRow(data as unknown as TextbookDbRow);
  const [lessonsRes, coverUrls] = await Promise.all([
    admin
      .from("textbook_lessons")
      .select("lesson_no, progress, homework")
      .eq("tenant_id", user.tenantId)
      .eq("textbook_id", id)
      .order("lesson_no", { ascending: true })
      // 차수 상한이 200이라 한 번에 들어온다(1000행 한도 밖).
      .range(0, 199),
    textbook.coverPath
      ? resolveTenantReadUrls([textbook.coverPath], "textbook_cover", user.tenantId).catch(
          () => ({}) as Record<string, string>,
        )
      : Promise.resolve({} as Record<string, string>),
  ]);

  const stored = new Map<number, TextbookLessonRow>();
  for (const l of (lessonsRes.data ?? []) as { lesson_no: number; progress: string | null; homework: string | null }[]) {
    stored.set(Number(l.lesson_no), {
      lessonNo: Number(l.lesson_no),
      progress: l.progress,
      homework: l.homework,
    });
  }
  // 🔑 차수 표는 **1..sessionCount 전부**를 세운다 — 저장된 행이 없어도 빈 칸으로 보여야
  //    "10차수 모두 작성"이 가능하다(행이 있어야만 보이면 아무것도 못 적는다).
  const lessons: TextbookLessonRow[] = [];
  for (let n = 1; n <= textbook.sessionCount; n += 1) {
    lessons.push(stored.get(n) ?? { lessonNo: n, progress: null, homework: null });
  }
  // 차수 수를 줄인 뒤에도 남아 있는 옛 행은 **감추지 않고** 뒤에 붙인다(쓴 게 조용히 사라지지 않게).
  for (const [n, row] of [...stored].sort((a, b) => a[0] - b[0])) {
    if (n > textbook.sessionCount) lessons.push(row);
  }

  return {
    status: "ok",
    detail: {
      textbook,
      coverUrl: textbook.coverPath ? (coverUrls[textbook.coverPath] ?? null) : null,
      lessons,
    },
  };
}

/**
 * ECS 계획 줄의 교재 칸이 쓰는 제안 목록 한 줄.
 * ⚠️ **구분은 싣지 않는다** — 교재를 골라도 줄의 구분을 자동으로 안 바꾸기 때문에(그 결정은 `plan-row.tsx`
 *    주석 참조) 아무도 안 읽는 값이고, 이 배열은 ECS 화면마다 RSC payload로 실려 나간다.
 */
export type TextbookOption = { title: string; pageTime: string | null };

/**
 * 제안 목록 상한 — 지금 실데이터는 교재명 372종이고 가져오기가 174권을 넣는다.
 * ⚠️ 여기에 닿으면 **조용히 잘린다** — 넘을 만큼 늘면 상한을 올리거나 검색형 picker로 바꿀 것.
 */
const TEXTBOOK_OPTION_CAP = 800;

/**
 * ECS 시트가 쓰는 **경량 제안 목록**.
 *
 * 🔴 창(iframe)마다 셸이 다시 도는 구조라(B6) 테넌트 단위 read-mostly 데이터는 `unstable_cache`로
 *    cross-request 공유한다 — 캐시 안엔 쿠키 없이 admin 클라이언트 + 신뢰 tenantId 키.
 * 🔴 **절대 throw하지 않는다** — 0266a 미적용이어도 ECS 시트는 그대로 떠야 한다([[#95]]).
 *    영어 강사 전원이 매일 여는 화면이라 여기서 죽으면 시트가 통째로 먹통이 된다.
 */
export async function getTextbookOptions(tenantId: string, subject: string): Promise<TextbookOption[]> {
  return unstable_cache(
    async () => {
      const { data, error } = await createAdminClient()
        .from("textbooks")
        .select("title, page_time")
        .eq("tenant_id", tenantId)
        .eq("subject", subject)
        .order("title", { ascending: true })
        .range(0, TEXTBOOK_OPTION_CAP - 1);
      // 🔴 **실패는 throw한다 — 절대 빈 배열로 캐시하지 말 것.** `unstable_cache`는 반환값만 저장하고
      //    던진 오류는 저장하지 않는다. 빈 배열을 돌려주면 0266a 적용 **전에** 한 번 열린 화면 때문에
      //    "제안 없음"이 5분간 굳고, 원장이 SQL을 적용해도 그동안 아무 일도 안 일어난 것처럼 보인다.
      //    삼키는 자리는 여기가 아니라 호출부(`loadEcsTextbookOptions`)다.
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({ title: r.title as string, pageTime: (r.page_time as string | null) ?? null }));
    },
    ["textbook-options", tenantId, subject],
    { tags: [textbookOptionsTag(tenantId)], revalidate: 300 },
  )();
}

/** 교재 마스터가 바뀌면 서버 액션이 `updateTag(...)`로 이 태그를 깬다(read-your-writes). */
export function textbookOptionsTag(tenantId: string): string {
  return `textbook-options:${tenantId}`;
}

const PLAN_COLS_BASE =
  "id, class_id, textbook_id, slot_axis, pace, term_mode, start_date, start_lesson_no, is_active, last_applied_at";
/**
 * 🔴 **컬럼 폴백**([[#95]]) — `slot_picks`는 0268a가 더한 칸이고 SQL은 손으로 적용한다. 적용 전에
 *    이 이름을 select에 넣으면 PostgREST가 `42703`으로 400을 주고 화면이 통째로 죽는다.
 *    그래서 **한 번 더 시도**한다: 있으면 쓰고, 없으면 옛 축 방식(slot_picks=null)으로 읽는다.
 */
const PLAN_COLS = `${PLAN_COLS_BASE}, slot_picks`;

/** `42703`(컬럼 없음)·PGRST204인가 — 0268a 미적용 신호. */
function isMissingSlotStarts(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  // 🔴 **코드만** — 메시지 substring은 이 칸의 CHECK 이름(`..._slot_picks_len`)과 부딪혀
  //    제약 위반까지 "컬럼 없음"으로 삼킨다(적대적 리뷰 P2).
  return error.code === "42703" || error.code === "PGRST204";
}

type PlanDbRow = {
  id: string;
  class_id: string;
  textbook_id: string;
  slot_axis: string;
  pace: string;
  term_mode: string;
  start_date: string;
  start_lesson_no: number;
  is_active: boolean;
  last_applied_at: string | null;
  slot_picks?: string[] | null;
};

/** 반 배정 목록. `classId`를 주면 그 반만. */
export async function getClassTextbookPlans(opts: {
  classId?: string | null;
  includeInactive?: boolean;
}): Promise<{ status: TextbookTableStatus; rows: ClassTextbookPlanRow[] }> {
  const user = await getCurrentUser();
  if (!user) return { status: "ok", rows: [] };
  const admin = createAdminClient();

  // 🔴 목록도 **ECS 스코프**로 좁힌다 — 안 좁히면 강사가 담당하지도 않는 반의 배정을 통째로 본다
  //    (열어도 서버가 거절하지만, 보이면 안 되는 건 애초에 안 보내는 게 맞다). 저장·기입 게이트와
  //    같은 세 갈래(`ecsVisibleClassFilter`)라 "목록엔 뜨는데 열면 거절"도 안 생긴다.
  const { ecsVisibleClassFilter } = await import("@/features/class-sheets/server/access");
  const scope = await ecsVisibleClassFilter();
  if (scope.classIds !== null && scope.classIds.length === 0) return { status: "ok", rows: [] };

  /** 한 배정 줄의 재료. 청크·단건 두 경로가 **같은 컬럼**을 받도록 한 곳에 둔다. */
  const base = (cols: string) => {
    let q = admin.from("class_textbook_plans").select(cols).eq("tenant_id", user.tenantId);
    if (!opts.includeInactive) q = q.eq("is_active", true);
    return q;
  };

  // 0268a 적용 전이면 `slot_picks` 없이 한 번 더 — 그 경우 옛 축 방식으로 읽힌다.
  let cols = PLAN_COLS;
  {
    const probe = await admin
      .from("class_textbook_plans")
      .select(PLAN_COLS)
      .eq("tenant_id", user.tenantId)
      .limit(1);
    if (probe.error && isMissingSlotStarts(probe.error)) cols = PLAN_COLS_BASE;
  }

  let plans: PlanDbRow[];
  if (opts.classId) {
    const { data, error } = await base(cols)
      .eq("class_id", opts.classId)
      .order("start_date", { ascending: false })
      .order("id")
      .range(0, 499);
    const status = classify(error);
    if (status !== "ok" || !data) return { status, rows: [] };
    plans = data as unknown as PlanDbRow[];
  } else if (scope.classIds === null) {
    // 사무실 — 스코프가 없다(전 반).
    const { data, error } = await base(cols).order("start_date", { ascending: false }).order("id").range(0, 499);
    const status = classify(error);
    if (status !== "ok" || !data) return { status, rows: [] };
    plans = data as unknown as PlanDbRow[];
  } else {
    // ⚠️ 스코프는 담당 ∪ 부담임 ∪ 위임 합집합이라 수십 개까지 간다 — 거대 `.in()`은 URL 414로 실패한다(B3).
    try {
      plans = await fetchAllPagedInChunks<PlanDbRow>(
        scope.classIds,
        // 동적 select라 supabase-js가 행 타입을 못 좁힌다 — 모양은 `PlanDbRow`가 정본이다.
        (chunk, f, t) =>
          base(cols).in("class_id", chunk).order("start_date", { ascending: false }).order("id").range(f, t) as unknown as
            PromiseLike<{ data: PlanDbRow[] | null; error: { message: string } | null }>,
      );
    } catch (e) {
      // 표가 없는 것과 그냥 실패를 여기서도 가른다(`fetchInChunks`는 메시지를 감싸 던진다).
      return { status: classify({ message: e instanceof Error ? e.message : "" }), rows: [] };
    }
  }
  if (plans.length === 0) return { status: "ok", rows: [] };

  const classIds = [...new Set(plans.map((p) => p.class_id))];
  const bookIds = [...new Set(plans.map((p) => p.textbook_id))];
  // 🔴 이름 조회가 **실패**하면 목록을 실패로 돌린다 — 빈 배열로 삼키면 잠깐의 네트워크 문제가
  //    `(삭제된 반)`·`(삭제된 교재)`라는 **데이터 소실 문구**로 보인다(사람이 실제로 지운 줄 안다).
  let classes: { id: string; class_name: string }[];
  let books: { id: string; title: string; skill_area: string | null; session_count: number }[];
  try {
    [classes, books] = await Promise.all([
      fetchAllPagedInChunks<{ id: string; class_name: string }>(classIds, (chunk, f, t) =>
        admin.from("classes").select("id, class_name").eq("tenant_id", user.tenantId).in("id", chunk).order("id").range(f, t),
      ),
      fetchAllPagedInChunks<{ id: string; title: string; skill_area: string | null; session_count: number }>(
        bookIds,
        (chunk, f, t) =>
          admin
            .from("textbooks")
            .select("id, title, skill_area, session_count")
            .eq("tenant_id", user.tenantId)
            .in("id", chunk)
            .order("id")
            .range(f, t),
      ),
    ]);
  } catch {
    return { status: "failed", rows: [] };
  }
  const classNameById = new Map(classes.map((c) => [c.id, c.class_name]));
  const bookById = new Map(books.map((b) => [b.id, b]));

  return {
    status: "ok",
    rows: plans.map((p) => {
      const book = bookById.get(p.textbook_id);
      return {
        id: p.id,
        classId: p.class_id,
        className: classNameById.get(p.class_id) ?? "(삭제된 반)",
        textbookId: p.textbook_id,
        textbookTitle: book?.title ?? "(삭제된 교재)",
        skillArea: book?.skill_area ?? null,
        sessionCount: Number(book?.session_count ?? 0),
        slotAxis: (p.slot_axis === "jj" ? "jj" : "class") as SlotAxis,
        slotPicks: Array.isArray(p.slot_picks) && p.slot_picks.length > 0 ? p.slot_picks.map(String) : null,
        pace: (p.pace === "day" ? "day" : "period") as LessonPace,
        termMode: p.term_mode === "exam" ? "exam" : "regular",
        startDate: p.start_date,
        startLessonNo: Number(p.start_lesson_no ?? 1),
        isActive: p.is_active,
        lastAppliedAt: p.last_applied_at,
      };
    }),
  };
}

/** 배정 다이얼로그의 교재 선택지(구분 있음·차수 ≥ 1인 것만 — 나머지는 어차피 배정이 거절된다). */
export async function getAssignableTextbooks(): Promise<{
  status: TextbookTableStatus;
  rows: { id: string; title: string; skillArea: string | null; sessionCount: number }[];
}> {
  const user = await getCurrentUser();
  if (!user) return { status: "ok", rows: [] };
  const { data, error } = await createAdminClient()
    .from("textbooks")
    .select("id, title, skill_area, session_count")
    .eq("tenant_id", user.tenantId)
    .eq("subject", "english")
    .gte("session_count", 1)
    .not("skill_area", "is", null)
    .order("title", { ascending: true })
    .range(0, 499);
  const status = classify(error);
  if (status !== "ok" || !data) return { status, rows: [] };
  return {
    status: "ok",
    rows: data.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      skillArea: (r.skill_area as string | null) ?? null,
      sessionCount: Number(r.session_count ?? 0),
    })),
  };
}

/**
 * 배정 다이얼로그가 고르는 **교시 목록** — 그 반이 실제로 도는 시각(중복 제거).
 *
 * 🔑 원장 2026-09-16: *"16시 수업 클릭 17시 수업 클릭"* — 사람이 고르는 단위는 축이 아니라 **시각**이다.
 * 🔴 **LAB은 목록에 안 올린다** — ECS가 표시·집계에서 언제나 빼는 자리라, 고를 수 있게 두면 아무도 안 보는
 *    칸에 기록이 쌓인다(스케줄러도 한 번 더 막는다).
 * ⚠️ 기준일은 **오늘**이다(지난 배치로 고르지 않게) — 앞으로 깔 것을 고르는 화면이라 축이 미래다.
 */
export async function getClassSlotChoices(
  classId: string,
): Promise<{ status: TextbookTableStatus; rows: ClassSlotChoice[] }> {
  const user = await getCurrentUser();
  if (!user) return { status: "ok", rows: [] };

  const [
    { requireEcsClassAccess },
    { getTenantSettings },
    { settingsToPeriodsConfig, weekdayTableFor },
    periodLabel,
    gridRows,
    { getTeacherLabelMap },
    { resolveTeacherLabel },
  ] = await Promise.all([
    import("@/features/class-sheets/server/access"),
    import("@/features/owner/server/queries"),
    import("@/features/timetable/lib/periods"),
    import("@/features/class-sheets/lib/period-label"),
    import("@/features/class-sheets/lib/grid-rows"),
    import("@/features/timetable/server/queries"),
    import("@/features/timetable/lib/teacher-label"),
  ]);

  const gate = await requireEcsClassAccess(classId);
  if (!gate.ok) return { status: "ok", rows: [] };

  const today = kstToday();
  const admin = createAdminClient();
  // 🔴 담당 이름은 **시트 달력과 같은 해석기**를 탄다 — 시간표에 저장된 건 닉네임(`Jane`)이고 달력은
  //    `추민아`로 보여 준다. 칩만 원문을 적으면 같은 칸이 두 이름으로 불려 "내 교시가 어느 거지"가 된다.
  const [schedRes, settings, labelMap] = await Promise.all([
    admin
      .from("class_schedules")
      .select("day_of_week, start_time, end_time, valid_from, valid_to, slot_teacher_label")
      .eq("tenant_id", gate.access.tenantId)
      .eq("class_id", classId)
      .lte("valid_from", today)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .order("start_time", { ascending: true })
      .range(0, 299),
    getTenantSettings(),
    // ⚠️ 이름 해석은 **표시용**이다 — 실패해도 칩은 떠야 한다(원문 닉네임으로 폴백). 여기서 throw하면
    //    교시를 못 골라 기입 자체가 막히는데, 그건 이름이 예쁘지 않은 것보다 훨씬 나쁘다.
    getTeacherLabelMap({ supabase: admin, tenantId: gate.access.tenantId }).catch(() => undefined),
  ]);
  if (schedRes.error) return { status: "failed", rows: [] };

  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  const tables = {
    weekday: periodLabel.tableToEntries(weekdayTableFor(gate.access.subject, periodsConfig)),
    weekend: periodLabel.tableToEntries(periodsConfig.weekend),
  };

  /**
   * 🔴 **시각 하나 = 칩 하나**인데, 같은 시각이라고 같은 교시는 아니다([[#106]] 계열).
   *    실측(2026-09-16): 활성 영어 반 **7개**가 같은 시작시각에 종료가 갈린다
   *    (`중등E_초등 브릿지 C2` 16:20 → 17:20 / 17:00). 먼저 만난 행의 라벨을 붙이면 그 칩은
   *    **절반의 날에만 맞는 교시 이름**을 달게 된다.
   *    → 갈리면 **지어내지 않는다**: 교시 라벨·자리·담당은 전부 같을 때만 적고, 아니면 비운다.
   *    (고른 시각이 그 날들 전부에 적용된다는 뜻은 그대로다 — 원장이 고른 "그 시각은 앞으로 쭉".)
   */
  type Acc = { start: string; label: string; ends: Set<string>; dows: string[]; weekend: boolean };
  const acc = new Map<string, Acc>();
  for (const r of schedRes.data ?? []) {
    const label = (r.slot_teacher_label as string | null) ?? "";
    const seat = specialSlotLabel(label || null);
    if (seat === "LAB") continue; // 🔴 위 주석
    const start = String(r.start_time).slice(0, 5);
    const dow = String(r.day_of_week);
    // 🔴 묶는 축이 **(시각, 담당)**이다 — 시각만으로 묶으면 담당이 요일마다 갈리는 칸이 한 칩에 뭉쳐,
    //    추민아가 고른 17:20이 목요일 JJ(자습실)까지 데려간다(위 주석).
    const key = `${start}|${label}`;
    const cur = acc.get(key) ?? { start, label, ends: new Set(), dows: [], weekend: false };
    cur.ends.add(r.end_time ? String(r.end_time).slice(0, 5) : "");
    if (!cur.dows.includes(dow)) cur.dows.push(dow);
    if (gridRows.isWeekendDow(dow)) cur.weekend = true;
    acc.set(key, cur);
  }

  const rows: ClassSlotChoice[] = [...acc.entries()].map(([key, a]) => {
    const onlyEnd = a.ends.size === 1 ? ([...a.ends][0] ?? "") : null;
    const seat = specialSlotLabel(a.label || null);
    return {
      key,
      start: a.start,
      // 종료가 갈리면 교시 이름을 안 적는다(둘 중 하나만 맞는 이름을 다는 것보다 없는 편이 낫다).
      periodLabel:
        onlyEnd === null ? null : periodLabel.resolvePeriodLabel(a.start, onlyEnd || null, tables, a.weekend),
      seat: seat === "JJ" ? "JJ" : null,
      teacherLabel: a.label ? (resolveTeacherLabel(a.label, labelMap) ?? a.label) : null,
      dows: a.dows,
      picks: a.dows.map((d) => slotPickKey(d, a.start)),
    };
  });

  // 시각 순 → 같은 시각이면 담당 이름 순(칩 순서가 호출마다 흔들리지 않게).
  return {
    status: "ok",
    rows: rows.sort((a, b) =>
      a.start !== b.start ? (a.start < b.start ? -1 : 1) : (a.teacherLabel ?? "").localeCompare(b.teacherLabel ?? "", "ko"),
    ),
  };
}
