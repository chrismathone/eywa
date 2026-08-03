import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { getTeachingClassIds } from "@/features/classes/server/delegation";
import { COLLISION_STATUSES, isNameCollision } from "../classnote-collision";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * 강사 스코프 — 이 학생이 로그인 강사가 **그 날짜에 가르치는 반**의 활성 수강생인지
 * (원스크린 보고서/첨부/링크 액션 공용 이중방어).
 * ⚠️ `"use server"` 액션 파일이 아닌 순수 server-only 모듈 — actions.ts·attachment-actions.ts가 함께 import.
 * RLS가 tenant 격리를 담당하고, 이 함수가 강사-학생 소유를 추가로 확인(다른 반 학생 조작 차단).
 *
 * 반 판정은 `getTeachingClassIds`(담당 반 ∪ 그날 위임 반) 단일 소스 — 결근 대체 강사도 자기가 실제로
 * 가르친 학생의 보고서를 쓸 수 있어야 한다(0173a 반 임시 위임). `date`는 그 판정의 기준일(기본 KST 오늘).
 */
export async function teacherOwnsStudent(
  supabase: ServerClient,
  teacherId: string,
  studentId: string,
  date?: string,
): Promise<boolean> {
  const { all: myClassIds } = await getTeachingClassIds(supabase, teacherId, date);
  if (myClassIds.length === 0) return false;
  const { data: enr } = await supabase
    .from("enrollments")
    .select("id")
    .eq("student_id", studentId)
    .is("end_date", null)
    .in("class_id", myClassIds)
    .limit(1);
  return !!enr && enr.length > 0;
}

/**
 * ClassNote 동명이인 감지 — 이 학생과 **같은 이름의 활성(탈원 아님) 학생이 또 있으면** true.
 * ClassNote 보드/원아 선택이 이름 텍스트 기반(정확 일치 시 첫 발견 클릭, 고유 ID 없음)이라, 동명이인은
 * 엉뚱한 학생 보드에 게시될 위험이 있다 → 자동 발송을 막기 위한 안전 감지(RLS로 테넌트 격리).
 * ⚠️ 세는 대상 = **보드가 존재할 수 있는 상태만**(enrolled·on_hold — classnote-collision.ts 근거).
 * 예전엔 withdrawn만 제외해 **예비원생까지 세는 바람에 정상 발송이 막혔다**(김수아 등 3명, 2026-07-29 원장 승인 수정).
 */
export async function hasClassnoteNameCollision(
  supabase: ServerClient,
  studentId: string,
): Promise<boolean> {
  const { data: me } = await supabase
    .from("students")
    .select("name, classnote_name")
    .eq("id", studentId)
    .maybeSingle();
  // 유효이름 = classnote_name(오버라이드) || name. 워커 보드명도 이 이름을 쓴다.
  const effName = me?.classnote_name?.trim() || me?.name?.trim();
  if (!effName) return false;
  // 유효이름이 같은 비탈원 학생 수 — coalesce 필터를 피해 두 조건(오버라이드 일치 / 미설정+이름 일치) 합산.
  // (한 행은 classnote_name이 null이거나 non-null이라 두 집합은 상호배타 → 중복 카운트 없음.)
  const [withOverride, withoutOverride] = await Promise.all([
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("classnote_name", effName)
      .in("status", [...COLLISION_STATUSES]),
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .is("classnote_name", null)
      .eq("name", effName)
      .in("status", [...COLLISION_STATUSES]),
  ]);
  return isNameCollision((withOverride.count ?? 0) + (withoutOverride.count ?? 0)); // 본인 포함 2명 이상 = 충돌
}
