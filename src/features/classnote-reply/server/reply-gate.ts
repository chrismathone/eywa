import "server-only";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteReplyMode, classnoteSendOn } from "@/features/owner/classnote-gate";
import { isReplyManager, type ReplyMode } from "../reply-policy";

/**
 * 학부모 글 답글·공감(0317a·0319a) 서버 액션의 **첫 문** — 답글 액션과 공감 액션이 같이 쓴다(동기 export가 없어도 `"use server"` 파일 밖에 둔다, [[#119]]).
 * 순서: 로그인·학생 아님 → 모드(학원 설정 `report.classnoteParentReplyMode` — ClassNote 모듈이 꺼지면 끔).
 * 🔴 끔이면 **없는 기능**이다 — 모듈이 꺼진 학원과 같은 문구로 거절한다(기능이 있다는 것도 알리지 않는다, 원장 2026-09-30 "꺼지면 흔적 없이").
 */
export type ReplyGate =
  | { ok: true; user: CurrentUser; manager: boolean; sendOn: boolean; mode: Exclude<ReplyMode, "off"> }
  | { ok: false; error: string };

const UNAVAILABLE = "사용할 수 없는 기능입니다";

/** `needManager: false` = 관리자급 판정이 필요 없는 조회(벨 버튼 목록) — 보호된 계정 조회를 아낀다(벨은 전원이 매일 여는 자리다). */
export async function replyGate(needManager = true): Promise<ReplyGate> {
  const user = await getCurrentUser();
  if (!user || user.systemRole === "student") return { ok: false, error: UNAVAILABLE };
  const settings = await getTenantSettings();
  const mode = classnoteReplyMode(settings);
  if (mode === "off") return { ok: false, error: UNAVAILABLE };
  // 관리자급 = 원장·관리자·매니저 + 보호된 계정(새 게이트는 그 계정을 자동 통과시킨다 — decisions/staff.md). 요청 캐시라 한 번만 묻는다.
  const manager = isReplyManager(user.systemRole) || (needManager && (await isCurrentUserSuperAdmin().catch(() => false)));
  return { ok: true, user, manager, sendOn: classnoteSendOn(settings), mode };
}
