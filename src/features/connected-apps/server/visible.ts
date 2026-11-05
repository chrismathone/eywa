import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { isFeatureOptedIn } from "@/lib/license/server";
import { CONNECTED_APPS, connectedAppVisibleTo, type ConnectedApp } from "../apps";

/**
 * 로그인한 사람에게 세울 **연결 앱** — 단일 판정. PC 사이드바·폰 메뉴(풀셸) · 강사 '내 메뉴'(미니셸) · 출발 라우트가 전부 이걸 본다.
 *
 * ① 지점 스위치(슈퍼관리자 '기능·라이선스', 기본 꺼짐 — `isFeatureOptedIn`)
 * ② 담당 과목 축([`connectedAppVisibleTo`](../apps.ts) — 오늘 수학은 영어 선생님에게 안 보인다, 원장 2026-09-26).
 *    총괄(super_admin)은 이 축을 건너뛴다(결정 로그 staff.md *"새로 만드는 어떤 제한 명단·게이트도 자동 통과"*) —
 *    과목 때문에 빠진 앱이 있을 때만 확인해서, 거의 모든 요청은 그 조회를 안 한다. 지점 스위치는 총괄도 따른다(지점 계약 축).
 * 🔴 화면에서만 감추면 주소를 쳐서 들어온다([[#77]]) — 출발 라우트도 이 함수로 거른다.
 * 과목 조회는 켜진 앱이 있을 때만 한다(대부분 지점은 스위치 조회 1번으로 끝). 못 읽으면 **감춘다** — 다른 앱에 로그인시키는
 * 입구라, 영어 선생님에게 새는 쪽보다 잠깐 안 보이는 쪽이 낫다(스위치 조회와 같은 fail-closed).
 * 요청 캐시 — 레이아웃이 한 번 부르면 같은 요청의 다른 소비처는 쿼리 0.
 * 🔑 '다른 강사 뷰'면 **대상 직원 X의 담당 과목**으로 거른다(원장 2026-11-05 강사뷰 전수 — X 화면에 X에게 없는 링크가 서지 않게).
 *    링크를 눌러 바깥 앱에 들어가는 신원(출발 라우트의 SSO)은 인증이라 실제 계정 그대로다 — 여기는 '보이는가'만 정한다.
 *    총괄 우회(isCurrentUserSuperAdmin)는 강사뷰 중에는 열리지 않는다(super-admin.ts).
 */
export const getMyConnectedApps = cache(async (): Promise<ConnectedApp[]> => {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return [];
  // 운영 콘솔의 '지점 보기'(읽기 전용)에서는 연결 앱을 세우지 않는다 — 이 입구는 **다른 앱에 로그인시키는** 길이라
  // 그 지점의 이름으로 바깥 앱에 들어가거나 계정이 이어지면 '읽기'가 아니다. 출발 라우트도 이 함수로 걸러진다.
  if (user.tenantView) return [];
  const todaysMath = await isFeatureOptedIn(user.tenantId, "todays_math");
  const enabled = CONNECTED_APPS.filter((a) => (a.feature === "todays_math" ? todaysMath : false));
  if (enabled.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("users").select("subjects").eq("id", user.id).maybeSingle();
  if (error || !data) return [];
  const subjects = (data.subjects as string[] | null) ?? [];
  const visible = enabled.filter((a) => connectedAppVisibleTo(a, subjects));
  if (visible.length < enabled.length && (await isCurrentUserSuperAdmin())) return enabled;
  return visible;
});
