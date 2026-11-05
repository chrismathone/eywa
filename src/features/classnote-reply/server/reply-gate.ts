import "server-only";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteReplyMode, classnoteSendOn } from "@/features/owner/classnote-gate";
import { isReplyManager, type ReplyMode } from "../reply-policy";

/**
 * 학부모 글 답글·공감(0317a·0319a) 서버 액션의 **첫 문** — 답글 액션과 공감 액션이 같이 쓴다(동기 export가 없어도 `"use server"` 파일 밖에 둔다, [[#119]]).
 * 순서: 로그인·학생 아님 → 모드(학원 설정 `report.classnoteParentReplyMode` — ClassNote 모듈이 꺼지면 끔).
 * 🔴 끔이면 **없는 기능**이다 — 모듈이 꺼진 학원과 같은 문구로 거절한다(기능이 있다는 것도 알리지 않는다, 원장 2026-09-30 "꺼지면 흔적 없이").
 * 🔴 사람 = **'다른 강사 뷰'의 대상 직원**(`getCurrentUser({ teacherView: true })` — 강사뷰가 아니면 로그인한 본인). 자격(그 학생을 지금 맡은 사람)·
 *    게시 명의(학부모에게 보이는 `<반> <호칭>`)·'내 답글/공감' 판정·관리자급 여부가 전부 이 사람 기준이다. 로그인 계정으로 판정하면 원장이
 *    강사 X 화면에서 쓴 답글이 **원장 이름으로 학부모에게** 나간다(원장 2026-11-05 강사뷰 전수). 감사로그 행위자만 로그인 계정이다(logAction).
 */
export type ReplyGate =
  | { ok: true; user: CurrentUser; manager: boolean; sendOn: boolean; mode: Exclude<ReplyMode, "off"> }
  | { ok: false; error: string };

const UNAVAILABLE = "사용할 수 없는 기능입니다";

/** `needManager: false` = 관리자급 판정이 필요 없는 조회(벨 버튼 목록) — 보호된 계정 조회를 아낀다(벨은 전원이 매일 여는 자리다). */
export async function replyGate(needManager = true): Promise<ReplyGate> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || user.systemRole === "student") return { ok: false, error: UNAVAILABLE };
  const settings = await getTenantSettings();
  const mode = classnoteReplyMode(settings);
  if (mode === "off") return { ok: false, error: UNAVAILABLE };
  // 관리자급 = 원장·관리자·매니저 + 보호된 계정(새 게이트는 그 계정을 자동 통과시킨다 — decisions/staff.md). 요청 캐시라 한 번만 묻는다.
  // (보호된 계정 판정은 강사뷰 중에는 대상 기준이다 — 로그인 계정의 총괄 지위가 대상 강사 화면으로 새지 않는다.)
  const manager = isReplyManager(user.systemRole) || (needManager && (await isCurrentUserSuperAdmin().catch(() => false)));
  return { ok: true, user, manager, sendOn: classnoteSendOn(settings), mode };
}

/**
 * 벨 알림을 읽는 자리 — 답글 버튼·창이 "내 알림"인지 확인할 때 쓴다.
 * 평소 = 세션 클라이언트(RLS: 받는 사람 = 로그인 계정). '다른 강사 뷰' = DB의 `auth.uid()`는 언제나 로그인 계정이라 대상 직원의 알림이
 * RLS에 막힌다 → 강사뷰일 때만 관리 클라이언트로 **지점 · 받는 사람(대상 직원 · 로그인 계정)을 명시**해 읽는다. 둘 다 받는 이로 인정하는
 * 까닭: 벨이 강사뷰에서 누구의 알림을 보여 주든 화면에 보이는 알림에서 같은 창이 열려야 한다. 답글 자격·명의는 알림과 무관하게
 * `decideReplyPermission`이 대상 직원으로 다시 판정한다.
 */
export async function replyNotificationScope(user: CurrentUser): Promise<{
  db: ReturnType<typeof createAdminClient> | Awaited<ReturnType<typeof createClient>>;
  recipients: string[];
}> {
  const actual = await getCurrentUser();
  if (actual && actual.id !== user.id) return { db: createAdminClient(), recipients: [user.id, actual.id] };
  return { db: await createClient(), recipients: [user.id] };
}
