import "server-only";
import { cache } from "react";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId, effectiveTeacherScope } from "@/lib/auth/view-mode";
// 반 임시 위임(0173a) — ECS만 넓히는 확장(전역 teacher-scope는 불변, 아래 ecsDelegatedClassIds 주석 참조).
import { getDelegatedClassIdsInRange } from "@/features/classes/server/delegation";
import { addDays, kstToday } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { readEnglishTrack, type EnglishTrack } from "@/features/classes/english-track";
import { resolveSkillAreas } from "@/features/owner/skill-areas";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { hasLiveSlotInWeek } from "../lib/grid";
import { shiftDays } from "@/features/timetable/lib/week";
import type { DowKey } from "../lib/week";

/**
 * ECS(English Class Sheet) 공용 접근 게이트 — 조회·모든 서버 액션·RPC 호출부가 **전부** 이 함수를
 * 통과한다(#77 "게이트는 모든 표면이 같은 함수를"). class_sheet_* 테이블은 service_role 전용(0157a
 * deny-RLS)이라 이 게이트가 유일한 역할·스코프 방어선이다.
 *
 * 검증 순서:
 *  ① 로그인 + 메뉴 접근 수준(accessLevelTenant "ecs" — none 차단, write 요구 시 readonly도 차단)
 *  ② effectiveTeacherScope **상시 적용**(실 강사 + 겸직 강사뷰) — classId가 담당 반 목록에 없으면
 *     **부담임 보조 스코프**(ecsAssistantClassIds — 원장 승인 2026-07-29 확장)까지 보고 없으면 차단.
 *     ⚠️ slot_teacher_label은 권한 근거로 쓰지 않는다(표시 전용 — LAB/JJ 역할 라벨·닉네임 중복).
 *  ③ 반 실재 + 테넌트 일치(서버 클라 RLS + user.tenantId 이중 확인)
 *  ④ ECS 대상 과목: subject === "english" && resolveSkillAreas 비어있지 않음(계획 v2.2 §A 확정 조건 —
 *     타 과목 확장 시 이 한 줄만 완화)
 */
export type EcsClassAccess = {
  user: CurrentUser;
  tenantId: string;
  classId: string;
  className: string;
  subject: string;
  teacherId: string | null; // classes.teacher_id(반 담임) — 표시·기본값용
  /**
   * 영어 프로그램 구분(0176a `classes.english_track`) — **컬럼이 유일한 진실**(반 이름으로 추측 금지).
   * ECS에선 "원본 구글 시트가 있는 반인가"의 근거로 쓴다(EiE 반은 원본 시트가 없다 — 원장 2026-08-05).
   */
  englishTrack: EnglishTrack | null;
  /** 계획/마크/메모 편집 가능(full|scoped). 출석은 별도 attendance 게이트(actions에서 판정). */
  canWrite: boolean;
  /**
   * 쓰기 권한(full|scoped)은 있는데 **담당 반이 아니라서** 보기만 하는가(readOnly로 연 남의 반).
   * 화면 안내를 "작성 권한이 필요합니다"(권한 부족)와 갈라 쓰려고 둔다(2026-11-05 리뷰 · write-lock.ts).
   */
  scopeLocked?: boolean;
  skillAreas: SkillAreaSetting[];
};

export type EcsAccessResult =
  | { ok: true; access: EcsClassAccess }
  | { ok: false; error: string };

export async function requireEcsClassAccess(
  classId: string,
  opts: { write?: boolean; readOnly?: boolean } = {},
): Promise<EcsAccessResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };

  const level = await accessLevelTenant(user.systemRole, "ecs");
  if (level === "none") return { ok: false, error: "접근 권한이 없습니다" };
  let scopedClass = true;

  // 강사 스코프 상시 적용(실 강사 + 겸직 강사뷰) — 반담당·부담임(슬롯 강사)·임시 위임 셋 다 아니면 차단.
  // ⚠️ 이 세 갈래는 `ecsVisibleClassFilter`(랜딩 목록)와 **같아야** 한다 — 갈라지면 목록엔 뜨는데 열면 거절된다.
  const scope = await effectiveTeacherScope();
  if (scope && !scope.classIds.includes(classId)) {
    const [assistant, delegated] = await Promise.all([ecsAssistantClassIds(), ecsDelegatedClassIds()]);
    scopedClass = assistant.includes(classId) || delegated.includes(classId);
    if (!scopedClass && !opts.readOnly) {
      return { ok: false, error: "담당 반이 아닙니다" };
    }
  }

  // 반 실재 + 테넌트 일치. 서버 클라(RLS)라 타 테넌트 행은 애초에 안 보이지만 이중 확인.
  const canWrite = (level === "full" || level === "scoped") && scopedClass;
  if (opts.write && !canWrite) return { ok: false, error: "편집 권한이 없습니다" };

  const supabase = await createClient();
  const { data: cls } = await supabase
    .from("classes")
    .select("id, tenant_id, class_name, subject, teacher_id, english_track")
    .eq("id", classId)
    .maybeSingle();
  if (!cls || cls.tenant_id !== user.tenantId) {
    return { ok: false, error: "반을 찾을 수 없습니다" };
  }

  // ECS 대상 과목 판정(설정 단일 소스) — v1 = english 한정 + skillAreas 비어있지 않음.
  const settings = await getTenantSettings();
  const subjectRow = settings.operations.subjects.find((s) => s.key === cls.subject);
  const skillAreas = resolveSkillAreas(subjectRow);
  if (cls.subject !== "english" || skillAreas.length === 0) {
    return { ok: false, error: "이 반은 영어 강사 시트 대상이 아닙니다" };
  }

  return {
    ok: true,
    access: {
      user,
      tenantId: user.tenantId,
      classId: cls.id,
      className: cls.class_name,
      subject: cls.subject,
      teacherId: cls.teacher_id ?? null,
      englishTrack: readEnglishTrack(cls),
      canWrite,
      scopeLocked: (level === "full" || level === "scoped") && !scopedClass,
      skillAreas,
    },
  };
}

/**
 * ECS 전용 부담임(슬롯 강사) 보조 스코프 — 내가 슬롯 강사로 배선된 english 반 id 목록.
 * (원장 승인 2026-07-29: "부담임도 ECS 열 수 있도록. JJ·LAB 아르바이트 강사는 필요없음.")
 *
 * - 근거는 `class_schedules.teacher_id`(FK)**만** — slot_teacher_label은 여전히 권한 근거 금지(표시 전용).
 * - **JJ·LAB 당번 슬롯 제외는 구조적으로 자동**: 그 슬롯들은 teacher_id가 전부 null(2026-07-29 실측
 *   90/90 — 라벨만 있는 자리)이라 FK 기반 확장에 애초에 안 걸린다. 라벨 검사를 넣지 말 것.
 * - 전역 teacher-scope.ts는 **불변**(출석·학생·시간표 전 화면 파급) — ECS만 이 보조 스코프를 합집합.
 * - **게이트에서는 유효기간 지난 슬롯도 포함**(반담당 스코프와 동일 의미론 — 과거 주차 시트 열람 유지).
 *   ⚠️ 단 **주 단위 목록**은 그 주로 좁힌다(아래 `weekMonday` 인자) — 원장 2026-08-29
 *   *"미래 시간이동할때 9/1 이후에 수업하는 반이 아니면 사라져야하는데"*. 실측: 이다교의 `LT3`·
 *   `중고E_중1 의치대` 슬롯은 **8/31에 끝나는데** 9월 주차 목록에 그대로 떠 있었다(관계가 끝난 반).
 *   🔴 **게이트는 좁히지 않는다** — 목록에서 빠져도 URL로 그 주를 여는 건 그대로여야 한다.
 * - 조회 실패는 [](보조 스코프만 소실 = 기존 반담당 동작으로 강등, fail-closed) — 확장이 죽어도
 *   본 게이트는 안 죽는다.
 */
export const ecsAssistantClassIds = cache(async (): Promise<string[]> => {
  const teacherId = await effectiveTeacherId();
  if (!teacherId) return [];
  return englishAssistantClassIdsOf(teacherId);
});

/**
 * 임의 강사의 영어 부담임(슬롯) 반 — 위 규칙의 파라미터판. '다른 강사 뷰' 진입 액션이 대상 강사의
 * 착지(ECS 여부)를 정할 때도 **같은 판정**을 쓴다(두 벌이면 확장 조건이 갈라진다).
 */
export async function englishAssistantClassIdsOf(
  teacherId: string,
  /**
   * 주면 **그 주에 실제로 도는 내 슬롯**만 센다(주 단위 목록용). 안 주면 예전대로 전 기간(게이트용).
   * 🔴 유효기간(`valid_from`/`valid_to`)만 보지 않고 [`hasLiveSlotInWeek`](../lib/grid)로 **실날짜**까지
   *    본다 — 랜딩의 반 필터와 **같은 판정**이라 "반은 뜨는데 내 칸은 없는 주"가 안 생긴다.
   */
  weekMonday?: string,
): Promise<string[]> {
  const supabase = await createClient();
  let query = supabase
    .from("class_schedules")
    .select("class_id, day_of_week, valid_from, valid_to, classes!inner(subject)")
    .eq("teacher_id", teacherId)
    .eq("classes.subject", "english");
  if (weekMonday) {
    // 먼저 DB에서 그 주와 겹치는 행만 — 뒤의 실날짜 판정은 이 안에서만 돌면 된다.
    query = query.lte("valid_from", shiftDays(weekMonday, 6)).or(`valid_to.is.null,valid_to.gte.${weekMonday}`);
  }
  const { data, error } = await query;
  if (error) return [];
  const rows = (data ?? []) as {
    class_id: string;
    day_of_week: DowKey;
    valid_from: string;
    valid_to: string | null;
  }[];
  if (!weekMonday) return [...new Set(rows.map((r) => r.class_id))];
  const byClass = new Map<string, { dayOfWeek: DowKey; validFrom: string; validTo: string | null }[]>();
  for (const r of rows) {
    const arr = byClass.get(r.class_id) ?? [];
    arr.push({ dayOfWeek: r.day_of_week, validFrom: r.valid_from, validTo: r.valid_to });
    byClass.set(r.class_id, arr);
  }
  return [...byClass].filter(([, slots]) => hasLiveSlotInWeek(weekMonday, slots)).map(([id]) => id);
}

/**
 * ECS 위임 스코프 — **임시 위임(0173a)으로 이 기간에 대신 맡은** english 반 id 목록.
 *
 * 🔴 왜 전역 `effectiveTeacherScope`를 넓히지 않는가: 그 스코프는 ECS뿐 아니라 **교재요청 쓰기·시간표**까지
 *    함께 좌우한다(2026-07-29에 교재요청 쓰기 누출 155건이 났던 자리). 위임은 "누가 수업을 대신 하는가"라
 *    ECS만 넓히는 게 맞다 — 위 `ecsAssistantClassIds`(부담임)가 이미 같은 이유로 ECS 전용 확장이다.
 *
 * ⚠️ **왜 '오늘'이 아니라 앞뒤 유예(±{@link ECS_DELEGATION_GRACE_DAYS}일)인가**: ECS는 **주 단위 시트**다.
 *    화요일 하루를 대신 맡아도 월요일 밤에 미리 열어 계획을 보고, 수요일에 그날 기록을 고치는 게 정상 업무다.
 *    '오늘만'으로 잠그면 원스크린에서 이미 한 번 터진 "본문은 저장되는데 첨부만 거절" 류가 ECS에서 재현된다.
 * ⚠️ 반 단위로 연다(주차별로 자르지 않는다) — 부담임 확장과 **같은 의미론**(위 주석 "과거 주차 시트 열람 유지").
 *    위임 중인 사람은 그 반의 지난 주차도 볼 수 있다. 감사 근거는 `updated_by`가 남긴다.
 * - 조회 실패는 [](확장만 소실 = 기존 동작으로 강등, fail-closed).
 */
export const ECS_DELEGATION_GRACE_DAYS = 7;

export const ecsDelegatedClassIds = cache(async (): Promise<string[]> => {
  const teacherId = await effectiveTeacherId();
  if (!teacherId) return [];
  const today = kstToday();
  try {
    return await getDelegatedClassIdsInRange(
      teacherId,
      addDays(today, -ECS_DELEGATION_GRACE_DAYS),
      addDays(today, ECS_DELEGATION_GRACE_DAYS),
    );
  } catch {
    return [];
  }
});

/**
 * ECS 랜딩 스코프 — 현재 사용자가 볼 수 있는 english 반 id 목록 필터.
 * 강사(스코프 有)면 담당 반 ∪ 부담임 반 ∪ **위임 반**, 아니면 전체. 랜딩 쿼리·반 전환 드롭다운이 재사용.
 * ⚠️ 게이트(`requireEcsClassAccess`)와 **같은 세 갈래**여야 한다 — 갈라지면 "목록엔 뜨는데 열면 거절"이 된다.
 *
 * `weekMonday`를 주면 **부담임 갈래만** 그 주로 좁힌다(원장 2026-08-29 *"미래 시간이동할때 9/1 이후에
 * 수업하는 반이 아니면 사라져야하는데"*). 좁히는 방향이라 게이트보다 **넓어지지 않는다** — "목록엔 뜨는데
 * 열면 거절"은 여전히 구조적으로 불가능하다(반대 방향은 무해: 목록에 없어도 URL로 열린다).
 * 🔴 **담임 갈래는 안 좁힌다** — 담임은 반 단위 단일 값이라 시간 축이 없다(미래 담임 변경은 9/1 cron 몫).
 * 🔴 **위임 갈래도 안 좁힌다** — 위임은 이미 `오늘 ±7일` 창이라 그 자체로 한시적이고, 위임받은 사람은
 *    그 반의 지난 주차도 보는 게 규약이다(위 `ecsDelegatedClassIds` 주석).
 */
export async function ecsVisibleClassFilter(weekMonday?: string): Promise<{
  classIds: string[] | null;
  /**
   * **다른 주에는** 볼 반이 있나 — 빈 목록의 사유를 가르는 데만 쓴다.
   * 🔴 없으면 부담임만 하는 강사가 자기 슬롯이 없는 주를 열 때 *"담당하고 계신 영어 반이 없습니다.
   *    반 배정은 사무실에 문의하세요"* 라는 **거짓 안내**를 받는다(고칠 수 없는 일을 시키는 안내).
   */
  hasScopeAnyWeek: boolean;
}> {
  const scope = await effectiveTeacherScope();
  if (!scope) return { classIds: null, hasScopeAnyWeek: true };
  const teacherId = weekMonday ? await effectiveTeacherId() : null;
  const [assistantWeek, assistantAnyWeek, delegated] = await Promise.all([
    teacherId && weekMonday ? englishAssistantClassIdsOf(teacherId, weekMonday) : ecsAssistantClassIds(),
    // 전 기간판은 **요청 캐시**라(레이아웃이 ECS 메뉴 판정에 이미 부른다) 여기서 또 불러도 왕복 0.
    weekMonday ? ecsAssistantClassIds() : Promise.resolve<string[]>([]),
    ecsDelegatedClassIds(),
  ]);
  const classIds = [...new Set([...scope.classIds, ...assistantWeek, ...delegated])];
  return {
    classIds,
    // ⚠️ 주를 안 받았으면 좁힌 게 없다 — 그땐 목록 자체가 곧 "다른 주"의 답이다(따로 세면
    //    `assistantAnyWeek`가 빈 배열이라 **볼 반이 있는데 없다고** 말하게 된다).
    hasScopeAnyWeek: weekMonday
      ? new Set([...scope.classIds, ...assistantAnyWeek, ...delegated]).size > 0
      : classIds.length > 0,
  };
}
