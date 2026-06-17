import "server-only";

/**
 * 업로드 오디오 경로가 "이 테넌트의 단일 객체키"인지 검증 — `{tenantId}/{파일명}` 한 세그먼트만 허용.
 * prefix만 보던 검사(`startsWith(tenantId+"/")`)는 하위 경로·".." 등 임의 키를 통과시켜 같은 테넌트의
 * 다른 녹음 객체에 signed URL을 발급할 여지가 있었다(#S4). 슬래시·상위경로·이상문자를 차단한다.
 */
export function isTenantAudioPath(path: string, tenantId: string): boolean {
  const prefix = `${tenantId}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return rest.length > 0 && /^[A-Za-z0-9._-]+$/.test(rest);
}
