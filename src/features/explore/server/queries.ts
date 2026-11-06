import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { KIND_LABEL, groupCenterName, sectorLabelOf, type ExploreKind, type TrailItem, type TrailLabel } from "../model";
import { loadStudentCenter } from "./student";
import { loadClassCenter } from "./class";
import { loadTeacherCenter } from "./teacher";
import { loadRoomCenter } from "./room";
import { settle, type ExploreLoad } from "./shared";

export type { ExploreLoad } from "./shared";

/**
 * 중심 하나를 읽는다 — 종류마다 **기존 조회·권한 게이트**를 그대로 지난다(원생 = `getStudentById` · 수업 = `getClassDetail` ·
 * 강사 = 수업목록 권한 + 자기 자신 규칙). 어느 조각이 어느 조회에서 오는지는 각 파일의 `sectors` 배열에서 한 조각씩 따라간다.
 */
export async function loadExploreCenter(kind: ExploreKind, id: string): Promise<ExploreLoad> {
  if (kind === "student") return loadStudentCenter(id);
  if (kind === "class") return loadClassCenter(id);
  if (kind === "room") return loadRoomCenter(id);
  return loadTeacherCenter(id);
}

/**
 * 탐색 경로(이전 중심들)의 이름 — 종류별로 id 묶음 조회 한 번씩(RLS 그대로 · 못 읽은 것은 종류 이름으로).
 * 경로에 담기는 것은 **이름뿐**이다(요약·숫자는 지금 중심만).
 */
export async function resolveTrailLabels(trail: readonly TrailItem[]): Promise<TrailLabel[]> {
  if (trail.length === 0) return [];
  const supabase = await createClient();
  const ids = (kind: ExploreKind) => trail.filter((t) => t.kind === kind).map((t) => t.id);
  const [students, classes, teachers, rooms] = await Promise.all([
    settle("explore.trail.students", fetchInChunks<{ id: string; name: string }>(ids("student"), (chunk) => supabase.from("students").select("id, name").in("id", chunk))),
    settle("explore.trail.classes", fetchInChunks<{ id: string; class_name: string }>(ids("class"), (chunk) => supabase.from("classes").select("id, class_name").in("id", chunk))),
    settle("explore.trail.teachers", fetchInChunks<{ id: string; display_name: string }>(ids("teacher"), (chunk) => supabase.from("users").select("id, display_name").in("id", chunk))),
    settle("explore.trail.rooms", fetchInChunks<{ id: string; name: string }>(ids("room"), (chunk) => supabase.from("classrooms").select("id, name").in("id", chunk))),
  ]);
  const names = new Map<string, string>();
  for (const s of students.ok ? students.value : []) names.set(`student:${s.id}`, s.name);
  for (const c of classes.ok ? classes.value : []) names.set(`class:${c.id}`, c.class_name);
  for (const t of teachers.ok ? teachers.value : []) names.set(`teacher:${t.id}`, t.display_name);
  for (const r of rooms.ok ? rooms.value : []) names.set(`room:${r.id}`, r.name);
  // 영역 중심(`kind:id:sector`)의 이름 = "김민서G · 수업" — 과목 조각은 학원 설정 과목 라벨로(가운데 원과 같은 말).
  const subjects = trail.some((t) => t.sector) ? buildSubjectMaps((await getTenantSettings()).operations.subjects) : null;
  return trail.map((t) => {
    const base = names.get(`${t.kind}:${t.id}`) ?? KIND_LABEL[t.kind];
    return { ...t, label: t.sector && subjects ? groupCenterName(base, sectorLabelOf(t.kind, t.sector, subjects.labelOf)) : base };
  });
}
