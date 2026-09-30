import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { protectedIdsFrom, protectionStatusOf, type ProtectedLookup, type ProtectionStatus } from "./protected-accounts-core";

/**
 * **보호 계정** = `super_admins` 명단에 있는 계정 — 역할·재직 상태·삭제를 **앱의 어떤 경로로도** 못 바꾼다.
 *
 * 원장 2026-09-30: *"이승엽 superadmin 으로 등급업. 겉으로는 관리자. 박소선과 동일."* →
 * *"다음에 이런 일이 있어도 변경 안되게 강력 가드. 꼭 물어봐야하는걸로"*.
 *
 * 🔴 기존 `isProtectedSuperAdminTarget`(super-admin.ts)은 **로그인 자격**(비밀번호·이메일) 보호선이고
 *    총괄끼리는 서로 바꿀 수 있다. 여기는 그보다 강하다 — **행위자가 누구든**(원장·총괄 포함) 거절한다.
 *    바꿔야 할 일이 생기면 운영자 스크립트 + 원장 명시 승인뿐이다(DB 트리거 0309a도 같은 선을 긋는다).
 * 🔴 이름을 코드에 적지 않는다 — **명단 자체가 보호**다. 새 총괄이 생기면 자동으로 보호된다.
 * 🔴 **지점 화면에 나가는 문구에 '슈퍼관리자'·'총괄'을 쓰지 말 것** — 총괄은 지점에서 '관리자'로 위장한다
 *    (`displayRoleFor`, 2026-07-02 결정). 문구가 정체를 드러내면 위장이 무의미해진다. 총괄 콘솔만 예외.
 * ⚠️ 조회가 실패하면 **막는다** — 단 "보호 계정"이 아니라 "잠시 뒤 다시"로(모르면 안 바꾼다, 거짓 기록은 안 남긴다).
 */
export const PROTECTED_ACCOUNT_DENIED_MSG =
  "보호된 계정입니다 — 역할·상태는 여기서 바꿀 수 없습니다. 운영자에게 요청하세요.";
export const PROTECTION_LOOKUP_FAILED_MSG = "계정 보호 여부를 확인하지 못했습니다 — 잠시 뒤 다시 시도하세요.";

export async function protectedAccountIds(ids: readonly string[]): Promise<ProtectedLookup> {
  const want = [...new Set(ids.filter(Boolean))];
  if (want.length === 0) return { protectedIds: new Set(), lookupFailed: false };
  const { data, error } = await createAdminClient().from("super_admins").select("id").in("id", want);
  return protectedIdsFrom(want, error ? null : (data ?? []));
}

export async function protectionStatus(id: string): Promise<ProtectionStatus> {
  return protectionStatusOf(await protectedAccountIds([id]), id);
}

/** 거절 문구 — 보호 계정이면 보호 문구, 조회 실패면 재시도 문구, 아니면 null. */
export function protectionRefusal(status: ProtectionStatus): string | null {
  return status === "protected" ? PROTECTED_ACCOUNT_DENIED_MSG : status === "unknown" ? PROTECTION_LOOKUP_FAILED_MSG : null;
}
