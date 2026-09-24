"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { createUploadTicket, MEDIA_KIND } from "@/lib/storage/media-storage";
import { isTenantAudioPath, type AudioKind } from "@/lib/storage/legacy-audio-path";
import type { UploadTicket } from "@/lib/storage/types";
import type { MenuKey } from "@/lib/permissions";
import { licenseBlockReason } from "@/lib/license/server";

// 신규 미디어 업로드 티켓 발급 — 서버가 (a) kind별 권한 (b) 경로 빌드/검증 (c) size·형식 max를 검증한 뒤
// signed 업로드 URL을 내준다. ⚠️ 서버 액션은 UI 밖 직접 POST 가능 → 게이트 필수(CLAUDE.md #58).

export type IssueUploadTicketState = { ticket?: UploadTicket; error?: string } | undefined;

const AUDIO_EXT_RE = /^(mp3|m4a|wav|webm|ogg)$/i;
const AUDIO_MENU: Record<AudioKind, MenuKey> = {
  meeting: "meetings",
  consultation: "consultations",
  registration: "enrollment",
};

/** 오디오(회의·학생상담·등록상담) 업로드 티켓. kind→메뉴 write 권한 + ext/CT/size 검증. */
export async function issueAudioUploadTicket(
  _prev: IssueUploadTicketState,
  formData: FormData,
): Promise<IssueUploadTicketState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const kind = String(formData.get("kind") ?? "") as AudioKind;
  if (!(kind in AUDIO_MENU)) return { error: "잘못된 업로드 종류입니다" };

  // (a) kind별 권한 게이트(write = full|scoped).
  const lvl = await accessLevelTenant(user.systemRole, AUDIO_MENU[kind]);
  if (lvl !== "full" && lvl !== "scoped") return { error: "업로드 권한이 없습니다" };
  // 회의 녹음은 지점 라이선스(meeting_recording)를 본다 — 상담·등록상담 녹음은 이 라이선스 밖이다.
  if (kind === "meeting") {
    const blocked = await licenseBlockReason(user.tenantId, "meeting_recording");
    if (blocked) return { error: blocked };
  }

  // (c) 형식·크기 검증.
  const ext = String(formData.get("ext") ?? "webm").toLowerCase();
  if (!AUDIO_EXT_RE.test(ext)) return { error: "지원하지 않는 오디오 형식입니다" };
  const contentType = String(formData.get("contentType") ?? `audio/${ext}`);
  if (!MEDIA_KIND[kind].allowCT(contentType)) return { error: "지원하지 않는 형식입니다" };
  const size = Number(formData.get("size") ?? 0);
  if (!Number.isFinite(size) || size <= 0 || size > MEDIA_KIND[kind].maxBytes) {
    return { error: "파일 크기가 허용 범위를 벗어났습니다" };
  }

  // (b) 경로는 서버가 빌드(클라 입력 불신).
  const path = `${user.tenantId}/${crypto.randomUUID()}.${ext}`;
  if (!isTenantAudioPath(path, user.tenantId)) return { error: "경로 생성 실패" };

  try {
    return { ticket: await createUploadTicket({ kind, path, contentType }) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "업로드 티켓 발급 실패" };
  }
}
