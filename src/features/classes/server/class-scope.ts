import "server-only";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { addDays, kstToday } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";
import { getDelegatedClassIdsInRange } from "./delegation";
import { CLASS_NOT_MINE_ERROR, canWriteClassRecord } from "../class-write-scope";

/**
 * 반(class) 공용 접근 게이트 — **반을 바꾸는 모든 서버 액션과 반 상세를 여는 모든 화면이
 * 이 파일의 함수를 지난다**([[#77]] "게이트는 모든 표면이 같은 함수를").
 *
 * 축이 둘이고 **넓이가 다르다**:
 *  · 쓰기(`requireClassWrite`) = 담임만 — 판정은 순수 [`canWriteClassRecord`](../class-write-scope.ts).
 *  · 읽기(`canViewClassDetail`) = 담임 ∪ 교시 담당 ∪ 임시 위임 — ECS 게이트(`requireEcsClassAccess`)·
 *    학생 상세 열람(`canViewStudentDetail`)과 **같은 세 갈래**.
 *
 * 🔴 읽기를 담임으로 좁히면 안 된다: 영어 시트 머리의 '반 정보' 링크는 **부담임·위임 강사도** 누른다
 *    (그 반 시트를 쓰는 사람들이다). 좁히면 "시트는 열리는데 반 정보는 404"가 된다.
 * 🔴 쓰기를 세 갈래로 넓히면 안 된다: 부담임 한 칸을 맡았다고 반 이름·과목·담임·시간표를 고칠 수는 없다.
 */

/** 쓰기 게이트 결과 — 기존 호출부 모양(`{ user, error }`) 그대로라 분해 대입이 안 바뀐다. */
export type ClassWriteGate =
  | { user: CurrentUser; error?: undefined }
  | { user: null; error: string };

/**
 * 반 쓰기 게이트 — **반 id를 반드시 받는다**(선택 인자로 두면 다음 액션이 조용히 빠뜨린다).
 *
 * 🔴 이 게이트는 **fail-closed**다: 담임을 확인하지 못하면 거절한다. 권한 조회 실패를 열어 두는
 *    규약([[#60]] fail-open)은 **읽기·메뉴 노출** 이야기고, 쓰기에서 "모르니까 통과"는 곧 사고다.
 */
export async function requireClassWrite(classId: string): Promise<ClassWriteGate> {
  const user = await getCurrentUser();
  if (!user) return { user: null, error: "로그인이 필요합니다" };
  const level = await accessLevelTenant(user.systemRole, "classes");
  if (level !== "full" && level !== "scoped") return { user: null, error: "반 관리 권한이 없습니다" };
  if (level === "full") return { user };

  // 여기부터 scoped(강사) — 이 반이 내 반인지 본다.
  // super_admin은 새로 만드는 제한을 자동 통과한다(원장 2026-08-13 "앞으로 뭘 안해도 그냥 넣고봐").
  // ⚠️ 위의 **접근 수준** 검사는 우회시키지 않는다 — 이번에 새로 만든 제한은 '담임 확인' 쪽이다.
  if (await isCurrentUserSuperAdmin()) return { user };
  if (!classId) return { user: null, error: "반 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: klass, error } = await supabase
    .from("classes")
    .select("teacher_id")
    .eq("id", classId)
    .maybeSingle();
  if (error) return { user: null, error: "권한을 확인하지 못했습니다. 잠시 후 다시 시도해주세요" };
  if (!klass) return { user: null, error: "반을 찾을 수 없습니다" };
  if (
    !canWriteClassRecord({
      level,
      classTeacherId: (klass.teacher_id as string | null) ?? null,
      userId: user.id,
    })
  ) {
    return { user: null, error: CLASS_NOT_MINE_ERROR };
  }
  return { user };
}

/**
 * 화면용 판정 — **이미 읽어 둔 담임 id**로 답해서 왕복을 더하지 않는다(반 상세는 klass를 이미 들고 있다).
 * 서버 액션(`requireClassWrite`)과 **같은 답**을 내야 한다: 갈라지면 "버튼은 보이는데 누르면 거절".
 */
export async function canWriteLoadedClass(classTeacherId: string | null): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const level = await accessLevelTenant(user.systemRole, "classes");
  if (canWriteClassRecord({ level, classTeacherId, userId: user.id })) return true;
  return level === "scoped" && (await isCurrentUserSuperAdmin());
}

/** 임시 위임 열람 유예 — ECS와 같은 ±7일(주 단위로 일하는 사람이 앞뒤 하루를 못 여는 일 방지). */
const VIEW_DELEGATION_GRACE_DAYS = 7;

/**
 * 이 반 **상세를 열람**할 수 있는가 — [`getClassDetail`](./queries.ts)이 유일 소비 지점(초크포인트)이라
 * 반 상세 페이지와 반 수정 페이지가 **함께** 잠긴다(표면마다 다시 쓰지 않는다).
 *
 * 판정 대상은 `classes` 접근 수준이 **scoped인 사람만**(=실 강사). 겸직 관리자의 강사뷰는 실 역할이
 * full이라 무제한이고('다른 강사 뷰'는 readonly로 캡되어 역시 무제한 열람), 회계·뷰어도 종전대로다.
 *
 * ⚠️ 조회 실패는 **열어 둔다**(fail-open, [[#60]]·`canViewStudentDetail`과 같은 결) — 순간 장애로
 *    강사의 정당한 화면이 404가 되는 쪽이 더 나쁘다. 쓰기는 위에서 fail-closed라 사고로 안 번진다.
 */
export async function canViewClassDetail(classId: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  if ((await accessLevelTenant(user.systemRole, "classes")) !== "scoped") return true;
  if (await isCurrentUserSuperAdmin()) return true;
  if (!classId) return false;

  const supabase = await createClient();
  const today = kstToday();
  // 세 갈래는 서로 독립이라 병렬(B4). 앞 둘은 **행을 안 받는** count(B2).
  const [own, slot, delegated] = await Promise.all([
    supabase
      .from("classes")
      .select("*", { count: "exact", head: true })
      .eq("id", classId)
      .eq("teacher_id", user.id),
    supabase
      .from("class_schedules")
      .select("*", { count: "exact", head: true })
      .eq("class_id", classId)
      .eq("teacher_id", user.id),
    getDelegatedClassIdsInRange(
      user.id,
      addDays(today, -VIEW_DELEGATION_GRACE_DAYS),
      addDays(today, VIEW_DELEGATION_GRACE_DAYS),
    ).catch(() => [] as string[]),
  ]);
  if ((own.count ?? 0) > 0 || (slot.count ?? 0) > 0 || delegated.includes(classId)) return true;
  // 🔴 **한 갈래라도 못 물어봤으면** "아니다"라고 단정하지 않는다(위 fail-open 주석).
  //    `&&`(둘 다 실패)로 적으면 담임 조회만 순간 실패해도 진짜 담임이 404를 본다.
  //    ⚠️ 위임 갈래는 위에서 `.catch(() => [])`로 삼켜 여기 신호가 안 온다 — 셋 중 가장 좁은 갈래라
  //       (그 반만 여는 한시 확장) 삼켜도 담임·교시 갈래가 정상이면 판정이 뒤집히지 않는다.
  return !!own.error || !!slot.error;
}
