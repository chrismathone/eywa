// 시트에서 도출한 목표 배치(resolved slots) vs 기존 DB class_schedules → 변경 계획(DryRunReport). 순수함수.
// create/update/keep/remove로 분류하고 강의실 충돌·경고를 모은다. **쓰기 없음** — 미리보기/드라이런 전용.
// 키 = (classId, day, startTime): 한 반은 요일·시작시각당 하나의 슬롯. 같은 키 복수 강사 = 합반(teachers[] 병합).

import type {
  DryRunReport,
  ExistingSchedule,
  MatchResult,
  RoomConflict,
  SchedulePlanItem,
  TargetSchedule,
} from "./types";

/** 방 라벨을 비교 토큰으로("본원303"→"303", "SKY"→"SKY", 없으면 ""). */
function roomTok(r: string | null): string {
  if (!r) return "";
  return (r.match(/\b(\d{3}|SKY)\b/i)?.[1] ?? r.trim()).toUpperCase();
}
function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
/** 결정적 FNV-1a 해시(env 무관) — 변경분 조작/스테일 차단(Phase 2 apply 재검증용). */
function fnv1a(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function computeStructureDiff(match: MatchResult, existing: ExistingSchedule[]): DryRunReport {
  const warnings: string[] = [];
  const resolved = match.resolved;

  // 1. target = classId 있는 슬롯만(null=신규 반 → 적용 제외). (classId,day,start)로 병합.
  const newClasses = new Set<string>();
  const targetByKey = new Map<string, TargetSchedule>();
  for (const s of resolved) {
    if (!s.classId) {
      newClasses.add(s.className);
      continue;
    }
    const key = `${s.classId}|${s.day}|${s.startTime}`;
    const t = targetByKey.get(key);
    if (t) {
      if (!t.teachers.some((x) => x.name === s.teacherName))
        t.teachers.push({ name: s.teacherName, teacherId: s.teacherId });
      continue;
    }
    targetByKey.set(key, {
      className: s.className,
      classId: s.classId,
      day: s.day,
      startTime: s.startTime,
      endTime: s.endTime,
      room: s.room,
      classroomId: s.classroomId,
      teachers: [{ name: s.teacherName, teacherId: s.teacherId }],
      starred: s.starred,
    });
  }

  // 2. existing 맵.
  const existingByKey = new Map<string, ExistingSchedule>();
  const existingClassIds = new Set<string>();
  for (const e of existing) {
    existingByKey.set(`${e.classId}|${e.day}|${e.startTime}`, e);
    existingClassIds.add(e.classId);
  }

  // 3. diff.
  const planItems: SchedulePlanItem[] = [];
  const counts = { create: 0, update: 0, keep: 0, remove: 0 };

  for (const [key, t] of targetByKey) {
    const e = existingByKey.get(key);
    const tNames = t.teachers.map((x) => x.name);
    if (!e) {
      planItems.push({
        action: "create", classId: t.classId, className: t.className, day: t.day, startTime: t.startTime,
        endTime: t.endTime, room: t.room, teacherNames: tNames,
        teacherId: t.teachers[0]?.teacherId ?? null, classroomId: t.classroomId,
      });
      counts.create++;
      continue;
    }
    const endSame = (e.endTime ?? "") === (t.endTime ?? "");
    const roomSame = roomTok(e.slotRoomLabel) === roomTok(t.room);
    // 강사: 기존 라벨이 있으면 목표 강사에 포함돼야 동일. 라벨 null(FK 상속)이면 보수적으로 동일 처리.
    const teacherSame = e.slotTeacherLabel == null || tNames.includes(e.slotTeacherLabel);
    if (endSame && roomSame && teacherSame) {
      counts.keep++;
    } else {
      planItems.push({
        action: "update", classId: t.classId, className: t.className, day: t.day, startTime: t.startTime,
        endTime: t.endTime, room: t.room, teacherNames: tNames, scheduleId: e.id,
        teacherId: t.teachers[0]?.teacherId ?? null, classroomId: t.classroomId,
        before: { endTime: e.endTime, room: e.slotRoomLabel, teacherNames: e.slotTeacherLabel ? [e.slotTeacherLabel] : [] },
      });
      counts.update++;
    }
  }

  // remove = 시트에 없는 기존 슬롯.
  const targetClassIds = new Set([...targetByKey.values()].map((t) => t.classId));
  for (const [key, e] of existingByKey) {
    if (targetByKey.has(key)) continue;
    planItems.push({
      action: "remove", classId: e.classId, className: e.className, day: e.day, startTime: e.startTime,
      endTime: e.endTime, room: e.slotRoomLabel, teacherNames: e.slotTeacherLabel ? [e.slotTeacherLabel] : [], scheduleId: e.id,
    });
    counts.remove++;
  }

  // 4. 강의실 충돌(같은 방·요일·시간 겹침 + 다른 반). LAB 데스크(단자리)·SKY는 방토큰이 달라 자연 분리.
  const byRoomDay = new Map<string, TargetSchedule[]>();
  for (const t of targetByKey.values()) {
    const rt = roomTok(t.room);
    if (!rt) continue;
    const k = `${rt}|${t.day}`;
    (byRoomDay.get(k) ?? byRoomDay.set(k, []).get(k)!).push(t);
  }
  const conflicts: RoomConflict[] = [];
  for (const [k, arr] of byRoomDay) {
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i]!, b = arr[j]!;
        if (a.classId === b.classId) continue;
        const aEnd = a.endTime ?? a.startTime, bEnd = b.endTime ?? b.startTime;
        if (toMin(a.startTime) < toMin(bEnd) && toMin(b.startTime) < toMin(aEnd))
          conflicts.push({
            room: k.split("|")[0]!, day: a.day,
            a: { className: a.className, teachers: a.teachers.map((x) => x.name), startTime: a.startTime, endTime: a.endTime },
            b: { className: b.className, teachers: b.teachers.map((x) => x.name), startTime: b.startTime, endTime: b.endTime },
          });
      }
  }

  // 5. 경고.
  for (const n of [...newClasses].sort((a, b) => a.localeCompare(b, "ko")))
    warnings.push(`반 "${n}"은 eywa에 없음 — 생성이 필요해 적용에서 제외됩니다.`);
  // 합반(같은 반·요일·시각에 강사 복수) — v1은 단일 강사 행만 정합. 첫 강사로 기입되고 나머지는 미연결(경고).
  for (const t of targetByKey.values()) {
    if (t.teachers.length > 1)
      warnings.push(
        `합반 감지 "${t.className}" ${t.day} ${t.startTime}(강사 ${t.teachers.map((x) => x.name).join("·")}) — v1은 첫 강사만 연결됩니다(합반 구조 미지원).`,
      );
  }
  for (const cid of existingClassIds) {
    if (!targetClassIds.has(cid)) {
      const name = existing.find((e) => e.classId === cid)?.className ?? cid;
      warnings.push(`반 "${name}" 전체 스케줄이 시트에서 사라짐 — 종강 여부를 수동 확인하세요(반 자체는 유지).`);
    }
  }

  // 6. 변경분 해시(keep 제외, 결정적 정렬).
  const changeKeys = planItems
    .filter((p) => p.action !== "keep")
    .map((p) => `${p.action}|${p.classId}|${p.day}|${p.startTime}|${p.endTime}|${roomTok(p.room)}|${[...p.teacherNames].sort().join(",")}`)
    .sort();
  const hash = fnv1a(changeKeys.join("\n"));

  return {
    slotsParsed: resolved.length,
    targetSchedules: targetByKey.size,
    entitiesToCreate: { teachers: match.newTeacherNames, classes: match.newClassNames, rooms: match.newRoomNames },
    matched: { classes: match.matchedClasses, teachers: match.matchedTeachers, rooms: match.matchedRooms },
    plan: counts,
    planItems,
    conflicts,
    warnings,
    hash,
  };
}
