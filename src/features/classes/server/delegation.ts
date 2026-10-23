import "server-only";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { delegationOverlapsRange, isDelegationActiveOn } from "../delegation-window";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;
type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * **"내가 이 날짜에 가르치는 반" 단일 소스** (0173a 반 임시 위임, 2026-08-03).
 *
 * = 내 담당 반(`classes.teacher_id = 나`) ∪ **그 날짜에 유효한 위임 반**(`class_delegations`).
 *
 * 🔴 **왜 함수 하나로 모았나**: 이 판정이 `.eq("teacher_id", user.id)` 형태로 10곳에 복제돼 있었다
 *    (원스크린 로스터·저장·세션·보강·공지·학생순서·스코프·출석부 4곳). 2026-08-03에 배정 가능 역할
 *    배열이 세 벌로 복제돼 **"목록엔 뜨는데 저장하면 거절"**이 났던 것과 정확히 같은 모양이라, 위임을
 *    더하기 전에 먼저 한 곳으로 모은다. 새 코드는 `classes.teacher_id`를 직접 비교하지 말고 이 모듈을 쓸 것
 *    (`teaching-scope-single-source.test.ts`가 src/ 전수 스캔으로 신규 하드코딩을 막는다).
 *
 * ⚠️ **is_active 규약이 두 함수에서 다르다 — 일부러 그렇다.**
 *    · `getTeachingClassIds`(게이트용) = **is_active 필터 없음.** 기존 게이트들이 그랬다. 여기서 좁히면
 *      종강 반의 지난 보고서를 고치거나 첨부를 다는 게 갑자기 막힌다(행동 변경 = 회귀).
 *    · `getTeachingClasses`(로스터용) = **is_active true.** 오늘 화면에 그릴 반만.
 */

/** 게이트용 경량 결과 — 반 id만. `all`이 "이 사람이 손댈 수 있는 반"의 정답이다. */
export type TeachingClassIds = {
  own: string[]; // 담임인 반
  delegated: string[]; // 그 날짜에 위임받은 반
  all: string[]; // own ∪ delegated (중복 제거)
};

/** 로스터용 — 화면에 그릴 반 한 줄. `delegated`면 원 담임이 따로 있다(`ownerName`). */
export type TeachingClassRow = {
  id: string;
  className: string;
  subject: string; // classes.subject는 NOT NULL — 과목 라벨/색 해석이 이 값에 걸린다(빈 문자열도 오지 않는다)
  isSpecial: boolean;
  /**
   * '수업보고서 미발송'(0174a) 반인가 — **값만 실어 나른다. 여기서 거르지 않는다.**
   * 소비처마다 뜻이 달라서다: 로스터는 숨기고(원장 요구), 게이트(`getTeachingClassIds`)는 숨기면
   * 그 반의 과거 보고서 수정·첨부·출결이 막힌다(위 is_active 규약과 같은 이유).
   */
  reportOptout: boolean;
  /**
   * 종강일(`classes.closed_at`, 없으면 null) — **값만 실어 나른다.** 종강 반도 활성(is_active)이라 로스터엔 그대로 선다.
   * 보강 추가의 '기록할 수업' 고르기가 종강 반을 빼는 데 쓴다(원장 2026-09-30 *"종강이 아닌 담당 반에서 뜨는게 맞지?"*).
   */
  closedAt?: string | null;
  /** 위임받은 반인가 — 반 칩이 '내 반'과 시각적으로 구분한다(원장 지시 2026-08-03). */
  delegated: boolean;
  /** 위임 반일 때 원 담임 표시명(없거나 내 반이면 null) — 칩에 "○○ 선생님 반"으로 밝힌다. */
  ownerName: string | null;
  /**
   * **내 반인데 지금 남이 대신 맡고 있음** — 그 대체 강사 표시명(아니면 null).
   * 하루만 위임하고 나머지 날은 내가 하는 경우가 흔해서, 위임 건 날에 내 화면이 아무 말도 안 하면
   * 같은 반 보고서를 둘이 각자 쓰게 된다. 반은 그대로 두고 **표식만** 단다(권한은 그대로).
   */
  delegatedAwayTo: string | null;
};

type DelegationRow = {
  class_id: string;
  delegate_user_id: string;
  from_date: string;
  to_date: string;
  revoked_at: string | null;
};

/**
 * 그 날짜에 살아 있는 **학원 전체** 위임 — 한 번만 읽고 방향(받은 것/넘긴 것)은 JS에서 가른다.
 *
 * 왜 사용자별로 안 좁히나: 로스터는 "내가 받은 위임"과 "내 반이 남에게 넘어갔는지"를 **둘 다** 알아야
 * 하는데, 후자는 내 담당 반 id를 알아야 조회할 수 있어 왕복이 한 번 더 생긴다(반응속도 1순위).
 * 하루치 위임 행은 학원 전체로도 손에 꼽는 수라 통째로 읽는 게 싸다.
 * ⚠️ 그래도 무한정 받지는 않는다(B2 — 무페이징 select 금지 규약) — 날짜로 좁히고 상한을 건다.
 *    이 값에 닿을 규모면 위임이 아니라 인수인계로 운영해야 한다는 신호다.
 * 최종 판정은 SQL이 아니라 **순수함수**가 한다(조건이 두 벌이면 갈라진다 — delegation-window.ts 주석).
 */
async function fetchActiveDelegations(supabase: ServerClient, date: string, strict = false): Promise<DelegationRow[]> {
  const { data, error } = await supabase
    .from("class_delegations")
    .select("class_id, delegate_user_id, from_date, to_date, revoked_at")
    .is("revoked_at", null)
    .lte("from_date", date)
    .gte("to_date", date)
    .limit(500);
  if (strict && error) throw error;
  return ((data ?? []) as DelegationRow[]).filter((r) =>
    isDelegationActiveOn({ fromDate: r.from_date, toDate: r.to_date, revokedAt: r.revoked_at }, date),
  );
}

/** 알림 수신자용 위임 한 건 — 반 id·대체 강사·기간. 날짜 판정은 `isDelegationActiveOn`(delegation-window.ts). */
export type ClassDelegationWindow = {
  id?: string;
  classId: string;
  delegateUserId: string;
  fromDate: string; // 포함
  toDate: string; // 포함
  revokedAt: string | null;
};

/**
 * 그 날짜에 **이 반들**에 살아 있는 위임 — admin 경로(출결 알림 벨 수신자, 원장 결정 2026-09-14).
 *
 * 위 `fetchActiveDelegations`와 같은 규약(해제분 제외 · 양끝 포함 · SQL로 좁히고 순수함수로 다시 확인)이고
 * 다른 점은 셋이다:
 *  · admin(RLS 우회) 호출부용이라 **tenant 필터를 명시**한다.
 *  · 반 id로 좁힌다 — 반이 수십~수백 개일 수 있어 청크(B3) × 페이징(B2)으로 받는다.
 *  · 조회 실패를 **삼키지 않고 throw**한다 — `data ?? []`로 받으면 "대신 맡은 강사 없음"으로 위장해 그날 실제로
 *    수업하는 사람에게 벨이 조용히 안 간다. 호출부가 reportError로 남긴다.
 * ⚠️ 판정(누가 받나)은 여기서 하지 않는다 — `attendanceNoticeRecipients`(teacher-axis.ts)가 같은 날짜 판정을
 *    한 번 더 거쳐 담임·교시 담당과 합친다.
 */
export async function getActiveDelegationsForClasses(
  admin: AdminClient,
  tenantId: string,
  classIds: readonly string[],
  date: string,
): Promise<ClassDelegationWindow[]> {
  const ids = [...new Set(classIds)].filter(Boolean);
  if (ids.length === 0) return [];
  const rows = await fetchAllPagedInChunks<DelegationRow & { id: string }>(ids, (chunk, from, to) =>
    admin
      .from("class_delegations")
      .select("id, class_id, delegate_user_id, from_date, to_date, revoked_at")
      .eq("tenant_id", tenantId)
      .in("class_id", chunk)
      .is("revoked_at", null)
      .lte("from_date", date)
      .gte("to_date", date)
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows
    .map((r) => ({
      id: r.id,
      classId: r.class_id,
      delegateUserId: r.delegate_user_id,
      fromDate: r.from_date,
      toDate: r.to_date,
      revokedAt: r.revoked_at,
    }))
    .filter((d) => isDelegationActiveOn(d, date));
}

/**
 * 게이트용 — 이 사람이 그 날짜에 손댈 수 있는 반 id.
 * ⚠️ is_active로 좁히지 않는다(위 규약 참조). 날짜 기본값 = KST 오늘.
 */
export async function getTeachingClassIds(
  supabase: ServerClient,
  userId: string,
  date: string = kstToday(),
): Promise<TeachingClassIds> {
  const [ownRes, active] = await Promise.all([
    supabase.from("classes").select("id").eq("teacher_id", userId),
    fetchActiveDelegations(supabase, date),
  ]);
  const own = (ownRes.data ?? []).map((c) => c.id as string);
  const ownSet = new Set(own);
  const delegated = [
    ...new Set(active.filter((r) => r.delegate_user_id === userId).map((r) => r.class_id)),
  ];
  return { own, delegated, all: [...own, ...delegated.filter((id) => !ownSet.has(id))] };
}

/**
 * 로스터용 — 그 날짜에 화면에 그릴 활성 반 + 위임 표식.
 * 위임 반이 없으면(대부분의 날) 추가 왕복은 **0회**다(담당 반 조회 1 + 위임 조회 1, 둘은 병렬).
 */
export async function getTeachingClasses(
  supabase: ServerClient,
  userId: string,
  date: string = kstToday(),
  /** 정확한 집계 소비처는 조회 실패를 빈 명단으로 받지 않는다. 기존 호출부 동작은 유지한다. */
  strict = false,
): Promise<TeachingClassRow[]> {
  const ownQuery = () => supabase.from("classes")
    .select("id, class_name, subject, is_special, report_optout, closed_at")
    .eq("teacher_id", userId).eq("is_active", true);
  const [ownRes, active] = await Promise.all([
    strict
      ? fetchAllPaged((from, to) => ownQuery().order("id").range(from, to)).then((data) => ({ data }))
      : ownQuery(),
    fetchActiveDelegations(supabase, date, strict),
  ]);
  const ownRows = ownRes.data ?? [];
  const ownSet = new Set(ownRows.map((c) => c.id as string));
  // 내가 받은 위임 / 내 반이 남에게 넘어간 것 — 같은 한 번의 조회에서 방향만 갈라 읽는다.
  const wanted = [
    ...new Set(
      active
        .filter((r) => r.delegate_user_id === userId && !ownSet.has(r.class_id))
        .map((r) => r.class_id),
    ),
  ];
  const awayByClass = new Map<string, string>(); // 내 반 → 지금 대신 맡은 강사 id
  for (const r of active) {
    if (ownSet.has(r.class_id) && r.delegate_user_id !== userId) awayByClass.set(r.class_id, r.delegate_user_id);
  }

  // 위임 반의 반 정보(원 담임 포함). 위임이 없는 날(대부분)엔 이 조회 자체를 안 한다.
  const classRows =
    wanted.length === 0
      ? []
      : await fetchInChunks<{
          id: string;
          class_name: string;
          subject: string;
          is_special: boolean | null;
          report_optout: boolean | null;
          teacher_id: string | null;
          closed_at: string | null;
        }>(wanted, (chunk) =>
          supabase
            .from("classes")
            .select("id, class_name, subject, is_special, report_optout, teacher_id, closed_at")
            .in("id", chunk)
            .eq("is_active", true),
        );

  // 이름 해석 = 위임 반의 원 담임 + 내 반을 대신 맡은 강사. 한 번에 조회(B4).
  const nameWanted = [
    ...new Set([
      ...(classRows.map((c) => c.teacher_id).filter(Boolean) as string[]),
      ...awayByClass.values(),
    ]),
  ];
  const nameById = new Map<string, string>();
  if (nameWanted.length) {
    const users = await fetchInChunks<{ id: string; display_name: string | null }>(nameWanted, (chunk) =>
      supabase.from("users").select("id, display_name").in("id", chunk),
    );
    for (const u of users) if (u.display_name) nameById.set(u.id, u.display_name);
  }

  const own: TeachingClassRow[] = ownRows.map((c) => {
    const awayTo = awayByClass.get(c.id as string);
    return {
      id: c.id as string,
      className: (c.class_name as string) ?? "",
      subject: c.subject as string,
      isSpecial: !!c.is_special,
      reportOptout: !!c.report_optout,
      closedAt: (c.closed_at as string | null) ?? null,
      delegated: false,
      ownerName: null,
      delegatedAwayTo: awayTo ? (nameById.get(awayTo) ?? "다른 선생님") : null,
    };
  });
  return [
    ...own,
    ...classRows.map((c) => ({
      id: c.id,
      className: c.class_name ?? "",
      subject: c.subject,
      isSpecial: !!c.is_special,
      reportOptout: !!c.report_optout,
      closedAt: c.closed_at ?? null,
      delegated: true,
      ownerName: (c.teacher_id && nameById.get(c.teacher_id)) || null,
      delegatedAwayTo: null, // 받은 반은 '넘긴' 방향이 없다(둘 다 참일 수 없게 위에서 갈랐다)
    })),
  ];
}

/** 반 상세/원 담임 화면용 — 이 반에 걸린 위임(해제분 제외, 최근 것부터). */
export type ClassDelegationRow = {
  id: string;
  delegateUserId: string;
  delegateName: string | null;
  fromDate: string;
  toDate: string;
  reason: string | null;
  createdAt: string;
};

export async function getClassDelegations(
  supabase: ServerClient,
  classId: string,
  /** 이 날짜에 아직 안 끝난 것만(기본 KST 오늘) — 끝난 위임까지 배너에 쌓으면 곧 아무도 안 읽는다. */
  notEndedBefore: string = kstToday(),
): Promise<ClassDelegationRow[]> {
  const { data } = await supabase
    .from("class_delegations")
    .select("id, delegate_user_id, from_date, to_date, reason, created_at")
    .eq("class_id", classId)
    .is("revoked_at", null)
    .gte("to_date", notEndedBefore)
    .order("from_date", { ascending: true })
    .limit(50);
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.delegate_user_id as string))];
  const users = await fetchInChunks<{ id: string; display_name: string | null }>(ids, (chunk) =>
    supabase.from("users").select("id, display_name").in("id", chunk),
  );
  const nameById = new Map(users.map((u) => [u.id, u.display_name]));
  return rows.map((r) => ({
    id: r.id as string,
    delegateUserId: r.delegate_user_id as string,
    delegateName: nameById.get(r.delegate_user_id as string) ?? null,
    fromDate: r.from_date as string,
    toDate: r.to_date as string,
    reason: (r.reason as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
}

/**
 * 반 상세 페이지용 얇은 래퍼 — 페이지가 supabase 클라이언트를 만들지 않아도 되게.
 * (RLS select 정책 = 같은 테넌트라 사용자 클라이언트로 충분하다 — admin client 불필요.)
 */
export async function getClassDelegationList(classId: string): Promise<ClassDelegationRow[]> {
  const supabase = await createServerClient();
  return getClassDelegations(supabase, classId);
}

/**
 * 이 사람이 그 날짜에 **위임받은 반이 하나라도 있는가** — 강사뷰 진입 자격 판정용(view-mode.ts).
 *
 * 🔴 왜 필요한가: 담당 반이 0개인 관리자(원장·실장)가 하루 대신 들어가는 경우, 뷰 진입 자격이
 *    "담당 반 보유"로만 판정되면 **위임을 걸어도 그 사람 화면엔 아무것도 안 뜬다**(조용한 실패).
 * ⚠️ 여기서 여는 것은 **진입 자격뿐**이다. getTeacherScope의 classIds(ECS·교재요청·시간표 스코프)는
 *    건드리지 않는다 — 위임은 "누가 보고서를 쓰는가"만 바꾼다.
 * 담당 반이 있으면 호출부가 이 함수를 아예 부르지 않으므로, 평소 경로엔 추가 왕복이 없다.
 */
export async function hasActiveDelegation(userId: string, date: string = kstToday()): Promise<boolean> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("class_delegations")
    .select("class_id, delegate_user_id, from_date, to_date, revoked_at")
    .eq("delegate_user_id", userId)
    .is("revoked_at", null)
    .lte("from_date", date)
    .gte("to_date", date)
    .limit(20);
  return ((data ?? []) as DelegationRow[]).some((r) =>
    isDelegationActiveOn({ fromDate: r.from_date, toDate: r.to_date, revokedAt: r.revoked_at }, date),
  );
}

/**
 * 이 사람에게 위임된 반 중, 위임 기간이 `[from, to]`와 **겹치는** 반 id.
 *
 * `getTeachingClassIds`(하루 단위)와 달리 **구간**으로 본다 — 소비처가 주 단위인 경우(ECS 시트)를 위해서다.
 * 유예 폭은 **소비처가 정한다**(여기서 정하지 않는다): 원스크린은 하루, ECS는 앞뒤 여유를 둔다.
 * ⚠️ SQL로 좁히고 **순수함수로 다시 확인**한다(조건이 두 벌이면 갈라진다 — delegation-window.ts 주석).
 */
export async function getDelegatedClassIdsInRange(
  userId: string,
  from: string,
  to: string,
  strict = false,
): Promise<string[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("class_delegations")
    .select("class_id, delegate_user_id, from_date, to_date, revoked_at")
    .eq("delegate_user_id", userId)
    .is("revoked_at", null)
    .lte("from_date", to)
    .gte("to_date", from)
    .limit(200);
  if (strict && error) throw error;
  if (strict && data?.length === 200) throw new Error("담당 범위 조회 한도를 확인해 주세요");
  return [
    ...new Set(
      ((data ?? []) as DelegationRow[])
        .filter((r) =>
          delegationOverlapsRange(
            { fromDate: r.from_date, toDate: r.to_date, revokedAt: r.revoked_at },
            from,
            to,
          ),
        )
        .map((r) => r.class_id),
    ),
  ];
}
