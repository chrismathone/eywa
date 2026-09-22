import "server-only";
import { cache } from "react";
import { lessonProfileOf, type LessonProfile } from "../lesson-profile";
import { resolveSettings } from "../resolve";
import { getTenantSettings, loadTenantSettingsRaw, storedForResolve } from "./queries";

/**
 * 이 요청(또는 이 학원)의 수업 규칙 프로필. 학원 id를 주면 그 학원(세션 없는 경로 — 키오스크 등), 안 주면 로그인 학원.
 *
 * 🔴 조회가 실패하면 **침산 프로필**(이 작업 전 동작)로 — 침산은 실패해도 종전과 같아야 한다. 새 학원이 실패 순간
 *    침산 규칙을 잠깐 받는 쪽이, 침산이 규칙을 잃는 쪽보다 낫다(권한 매트릭스 fail-open과 같은 결).
 */
export const getLessonProfile = cache(async (tenantId?: string): Promise<LessonProfile> => {
  try {
    if (tenantId) {
      const raw = await loadTenantSettingsRaw(tenantId);
      return lessonProfileOf(resolveSettings(storedForResolve(raw), { name: raw.name }));
    }
    return lessonProfileOf(await getTenantSettings());
  } catch (e) {
    console.error("[owner/lesson-profile] 프로필 판정 실패 — 침산 규칙으로", e);
    return lessonProfileOf({ preset: "chinsan" });
  }
});
