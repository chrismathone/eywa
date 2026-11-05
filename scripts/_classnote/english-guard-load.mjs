// scripts/_classnote/english-guard-load.mjs — 영어 반 방 발송 **원아 신분 가드의 재료 조회**(aywa DB + ClassNote GET · 쓰기 0).
//
// 원장 2026-11-05 *"형제 원아 연결이 뒤바뀐건 크리티컬함. 아주 섬세한 가드로 매칭해야함"* — 영어 반 방 발송(보고서·개별 공지·교재요청서)이
// 수학 반 보드와 같은 가드(child-identity.mjs `childGuardReasons`)를 지나게 하려면 동기화 계획과 같은 재료가 필요하다:
//   · 지점 학생 전체(유효이름·학년·전화 4칸 · 같은 집 찾기 · 지점 전체 같은 이름) — `loadBoardStudents`(동기화와 **같은 조회** · 연동 앱 질의 목록 그대로)
//   · 운영관리 명부(원아 이름·생년·보호자 전화·소속 보드) — `fetchAdmissions`(동기화와 같은 GET)
//   · 반 보드 확인 기록(0302a ok — ④ 다른 학생에게 확인된 원아) — `loadVerifiedChildren`(동기화와 같은 조회)
//   · 원장 확인 연결(0185a linked_by='confirmed' — 명부 이름·보호자 전화만 대조에서 뺀다) — `loadConfirmedChildPairs`(동기화와 같은 조회)
// 학생·명부는 10분 동안 다시 쓰고(영어 보고서는 한 번에 수십 건이 나간다 — 건마다 학생 845명·명부 400명을 다시 읽지 않게),
// 확인 기록·원장 확인 연결은 매번 읽는다(동기화가 방금 다른 학생에게 적은 원아 · 방금 확인한 연결을 바로 본다). 판정이 실패하면 호출부가
// `fresh`로 한 번 더 읽어 다시 판정한다(명부·연락처를 바로잡은 직후 다시 보냈는데 10분 캐시로 같은 사유가 또 나지 않게 · 리뷰 2026-11-05) —
// 단 1분 안에 읽은 값은 그대로 쓴다(`ENGLISH_GUARD_FRESH_MIN_MS` · 재리뷰 2026-11-05).
// 🔴 조회 실패는 throw — 호출부(보고서·공지)가 재시도로 둔다(모르는 채 보내지 않는다).
// 🔴 전화 값은 판정 재료로만 쓴다 — 이 모듈이 돌려주는 값을 로그로 찍지 말 것.
import { kstSchoolYear } from "./board-safety.mjs";
import { familyFinder, namesakeFinder } from "./child-identity.mjs";
import { verifiedOwnersOf } from "./class-board-plan.mjs";
import { fetchAdmissions, loadBoardStudents, loadConfirmedChildPairs, loadVerifiedChildren } from "./math-class-boards-load.mjs";

/** 학생·명부를 다시 쓰는 시간. */
export const ENGLISH_GUARD_CACHE_MS = 10 * 60 * 1000;

/**
 * 막힌 판정을 다시 볼 때(`fresh`)도 이 시간 안에 읽은 학생·명부는 다시 읽지 않는다 — 명부 모양이 바뀌어 전원이 막히는 날 보고서마다
 * 학생 845명·명부 2,000줄을 다시 읽어 ClassNote에 무거운 요청이 몰리지 않게(재리뷰 2026-11-05). 바로잡은 직후 1분 안에 다시 보내면
 * 한 번 더 막힐 수 있다(1분 뒤엔 다시 읽는다).
 */
export const ENGLISH_GUARD_FRESH_MIN_MS = 60 * 1000;

/** 확인 기록의 비교 상대로 세는 학생 상태 — 퇴원생의 옛 기록(같은 아이의 퇴원 기록 등)은 비교 상대가 아니다. */
const OWNER_STATUSES = new Set(["enrolled", "on_hold"]);

const cache = { students: null, admissions: null };

/** 시험 전용 — 캐시를 비운다. */
export function resetEnglishGuardCacheForTest() {
  cache.students = null;
  cache.admissions = null;
}

/** 캐시 칸 하나 — 돌려주는 값 = `{ value, at }`(at = 그 값을 읽은 때 · 호출부가 판정 재료의 나이를 안다). */
async function cached(slot, key, load, now, fresh) {
  const hit = cache[slot];
  const ttl = fresh ? ENGLISH_GUARD_FRESH_MIN_MS : ENGLISH_GUARD_CACHE_MS;
  if (hit && hit.key === key && now - hit.at < ttl) return hit;
  const value = await load();
  cache[slot] = { key, at: now, value };
  return cache[slot];
}

/**
 * @param {{ tenant: string, centerId: number, now?: number, fresh?: boolean }} opts  fresh = 학생·명부를 다시 읽는다(1분 안에 읽은 값이면 그대로 ·
 *   읽은 값으로 캐시를 새로 채운다).
 * @returns {Promise<{ students: Map<string, object>, admissions: Map<number, object>, verifiedOwners: Map<number, Set<string>>,
 *                     familyFor: Function, namesakesFor: Function, confirmedPairs: Set<string>, schoolYear: number, loadedAt: number }>}
 *   loadedAt = 학생·명부 중 더 오래된 쪽을 읽은 때(캐시 나이 — 호출부가 '오래된 값으로 막혔나'를 가른다).
 */
export async function loadEnglishGuardInputs(sql, page, { tenant, centerId, now = Date.now(), fresh = false }) {
  // 서로 독립인 조회는 한꺼번에(B4) — 학생(캐시) · 명부(캐시) · 확인 기록 · 원장 확인 연결.
  const [studentsHit, admissionsHit, verified, confirmedPairs] = await Promise.all([
    cached(
      "students",
      tenant,
      async () => {
        const map = await loadBoardStudents(sql, tenant);
        const list = [...map.values()];
        return { students: map, familyFor: familyFinder(list), namesakesFor: namesakeFinder(list) };
      },
      now,
      fresh,
    ),
    cached("admissions", String(centerId), () => fetchAdmissions(page, centerId), now, fresh),
    loadVerifiedChildren(sql, tenant),
    loadConfirmedChildPairs(sql, tenant),
  ]);
  if (!verified) throw new Error("반 보드 확인 기록을 읽지 못했습니다");
  const { students, familyFor, namesakesFor } = studentsHit.value;
  const admissions = admissionsHit.value;
  const verifiedOwners = verifiedOwnersOf(verified, (sid) => OWNER_STATUSES.has(students.get(sid)?.status ?? ""));
  const loadedAt = Math.min(studentsHit.at, admissionsHit.at);
  return { students, admissions, verifiedOwners, familyFor, namesakesFor, confirmedPairs, schoolYear: kstSchoolYear(), loadedAt };
}
