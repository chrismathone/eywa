// 파싱 슬롯 ↔ 기존 DB 레코드(이름 기준) 매칭 — 순수 함수.
// 기존 레코드가 구버전이라 신뢰 대상이 아니므로, 여기서는 "이름으로 찾히면 그 id, 없으면 null(신규 대상)"
// 로 분류만 한다(생성/수정은 서버 apply 몫). 수업=className, 방=classrooms.name.
// 강사: 특수 자리(LAB 603 · JJ 305) 선차단 → englishName 우선 → displayName 폴백 →
//       복수 후보는 배정 가능한 역할(ASSIGNABLE_TEACHER_ROLES)로 좁힘 →
//       그래도 모호하면 null(라벨-only = slot_teacher_label 보존). (apply-english-schedules.cjs resolveTeacher 이식)

import { isAssignableTeacherRole } from "@/lib/permissions";
import { isSpecialSlotLabel } from "../../lib/teacher-label";
import type {
  ExistingContext,
  ExistingTeacherRef,
  MatchResult,
  ParsedStructure,
  ResolvedSlot,
} from "./types";

/** 이름 정규화 — 앞뒤/중복 공백 제거 + 소문자. NBSP도 일반 공백으로. */
function norm(s: string): string {
  return s.replace(/ /g, " ").trim().replace(/\s+/g, " ").toLowerCase();
}

/** 방 토큰("301"/"SKY")을 기존 방 이름("301호"/"301"/"SKY")과 느슨히 대조. */
function roomKey(name: string): string {
  const m = name.match(/\b(\d{3}|SKY)\b/i);
  return m ? m[1]!.toLowerCase() : norm(name);
}

/**
 * 강사 라벨("Jane"·"부원장"·"LAB") → 기존 user. englishName·displayName 둘 다 대조,
 * 복수 후보는 역할로 좁히고, 그래도 모호하면 null(라벨-only). `existed` = 후보가 하나라도 있었는지
 * (모호로 null이어도 "신규 강사"는 아니므로 newTeachers에 안 넣는다).
 *
 * 🔴 **특수 자리(`LAB`·`JJ`·`이주희`)는 사람으로 해석하지 않는다**(원장 2026-07-29 "직원 배정 안 함").
 * 안 막으면 시트를 재동기할 때마다 `이주희` 라벨이 **실제 이주희 직원 계정**에 다시 붙어
 * 출석부·직원명부·급여표에 "가짜 강사"가 되살아난다. `existed: true`로 돌려 '신규 강사' 후보에서도 뺀다.
 */
function resolveTeacher(
  name: string,
  teachers: ExistingTeacherRef[],
): { ref: ExistingTeacherRef | null; existed: boolean } {
  if (isSpecialSlotLabel(name)) return { ref: null, existed: true }; // 자리 = 라벨-only 고정
  const n = norm(name);
  const cands = teachers.filter((t) => norm(t.englishName ?? "") === n || norm(t.displayName) === n);
  if (cands.length === 0) return { ref: null, existed: false };
  if (cands.length === 1) return { ref: cands[0]!, existed: true };
  // 동명이인 → 배정 가능한 역할로 좁힌다. ⚠️ 목록은 [`ASSIGNABLE_TEACHER_ROLES`] 단일 소스 —
  // 여기 따로 적어 두었더니 `admin`이 빠져, 관리자 겸 강사가 동명이인일 때 **상대 쪽으로 잘못 매칭**될
  // 수 있었다(라벨-only로 떨어지는 것보다 나쁘다 — 남의 시간표에 슬롯이 붙는다).
  const roled = cands.filter((t) => isAssignableTeacherRole(t.systemRole));
  return { ref: roled.length === 1 ? roled[0]! : null, existed: true }; // 모호 → 라벨-only
}

export function matchStructure(parsed: ParsedStructure, ctx: ExistingContext): MatchResult {
  const classByName = new Map(ctx.classes.map((c) => [norm(c.className), c]));
  const roomByKey = new Map(ctx.classrooms.map((r) => [roomKey(r.name), r]));
  const reserveNames = new Set(parsed.teachers.filter((t) => t.reserve).map((t) => t.name));

  const newClasses = new Set<string>();
  const newTeachers = new Set<string>();
  const newRooms = new Set<string>();
  let matchedClasses = 0;
  let matchedTeachers = 0;
  let matchedRooms = 0;

  const resolved: ResolvedSlot[] = parsed.slots.map((s) => {
    const cls = classByName.get(norm(s.className));
    const { ref: tch, existed } = resolveTeacher(s.teacherName, ctx.teachers);
    const room = s.room ? roomByKey.get(roomKey(s.room)) : undefined;

    if (cls) matchedClasses++;
    else newClasses.add(s.className);
    if (tch) matchedTeachers++;
    // 후보 0 = 진짜 신규 강사. 후보 있으나 모호(existed=true, ref=null)는 라벨-only이라 신규 아님.
    else if (!existed && !reserveNames.has(s.teacherName)) newTeachers.add(s.teacherName);
    if (s.room) {
      if (room) matchedRooms++;
      else newRooms.add(s.room);
    }

    return {
      ...s,
      classId: cls?.id ?? null,
      teacherId: tch?.id ?? null,
      classroomId: room?.id ?? null,
    };
  });

  const sortKo = (a: string, b: string) => a.localeCompare(b, "ko");
  return {
    resolved,
    newClassNames: [...newClasses].sort(sortKo),
    newTeacherNames: [...newTeachers].sort(sortKo),
    newRoomNames: [...newRooms].sort(sortKo),
    matchedClasses,
    matchedTeachers,
    matchedRooms,
  };
}
