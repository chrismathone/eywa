import "server-only";
import { resolveAudioReadUrl } from "./media-storage";
import type { AudioKind } from "./legacy-audio-path";

// 오디오 재처리용 fetch 가능한 signed URL — 본체는 media-storage.resolveAudioReadUrl로 이전(단일 추상화).
// 이 wrapper는 기존 호출부(meetings retryMeetingProcessing 등) import 무변경을 위해 유지.
// tenant=현 백엔드(기본 GCS) / legacy(옛 ijw Firebase 경로)=항상 GCS.
export async function resolveAudioUrl(
  path: string,
  kind: AudioKind,
  tenantId: string,
): Promise<string> {
  return resolveAudioReadUrl(path, kind, tenantId);
}
