import "server-only";
import { resolveAudioReadUrl } from "./media-storage";
import type { AudioKind } from "./legacy-audio-path";

// 오디오 재처리용 fetch 가능한 signed URL — 본체는 media-storage.resolveAudioReadUrl로 이전(단일 추상화).
// 이 wrapper는 기존 호출부(meetings retryMeetingProcessing 등) import 무변경을 위해 유지.
// tenant·legacy 모두 Supabase kind 버킷에서 서명한다(2026-07-29 GCS 제거 — 옛 주석이 거짓이었다).
export async function resolveAudioUrl(
  path: string,
  kind: AudioKind,
  tenantId: string,
): Promise<string> {
  return resolveAudioReadUrl(path, kind, tenantId);
}
