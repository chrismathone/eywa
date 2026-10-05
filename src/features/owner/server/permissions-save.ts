import "server-only";
import { createHash } from "node:crypto";
import { permissionsCanonical } from "../permissions-canonical";
import type { PermissionsSettings } from "../settings-types";

/**
 * 역할·권한 면의 기준 token — 화면이 연 시점의 설정을 가리키는 표식(표준 문자열의 해시).
 * 화면(page.tsx)과 저장(saveOwnerSection)이 **같은 함수**로 만든다. 저장할 때 방금 읽은 값의 token과 다르면
 * 그사이 다른 곳(다른 창 · '역할 설정' 대화상자 · 운영자 스크립트)이 바꾼 것이라 저장하지 않는다.
 * 🔴 token은 충돌을 알아채기 위한 값일 뿐 권한 근거가 아니다 — 권한 검사는 저장 액션이 먼저 한다.
 */
export function permissionsToken(permissions: PermissionsSettings): string {
  return createHash("sha256").update(permissionsCanonical(permissions)).digest("hex");
}
