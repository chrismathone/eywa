// 파싱 슬롯 ↔ 기존 DB 레코드(이름 기준) 매칭 — 순수 함수.
// 기존 레코드가 구버전이라 신뢰 대상이 아니므로, 여기서는 "이름으로 찾히면 그 id, 없으면 null(신규 대상)"
// 로 분류만 한다(생성/수정은 서버 apply 몫). 강사=englishName, 수업=className, 방=classrooms.name.

import type {
  ExistingContext,
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

export function matchStructure(parsed: ParsedStructure, ctx: ExistingContext): MatchResult {
  const classByName = new Map(ctx.classes.map((c) => [norm(c.className), c]));
  const teacherByEng = new Map(
    ctx.teachers.filter((t) => t.englishName).map((t) => [norm(t.englishName!), t]),
  );
  const roomByKey = new Map(ctx.classrooms.map((r) => [roomKey(r.name), r]));

  const newClasses = new Set<string>();
  const newTeachers = new Set<string>();
  const newRooms = new Set<string>();
  let matchedClasses = 0;
  let matchedTeachers = 0;
  let matchedRooms = 0;

  const resolved: ResolvedSlot[] = parsed.slots.map((s) => {
    const cls = classByName.get(norm(s.className));
    const tch = teacherByEng.get(norm(s.teacherName));
    const room = s.room ? roomByKey.get(roomKey(s.room)) : undefined;

    if (cls) matchedClasses++;
    else newClasses.add(s.className);
    if (tch) matchedTeachers++;
    else if (!parsed.teachers.find((t) => t.name === s.teacherName)?.reserve) newTeachers.add(s.teacherName);
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
