import type { SystemRole } from "@/lib/permissions";
import type { ReviewDoc } from "./server/queries";

/**
 * 강사 직급 = **자기 평가 전용** 뷰 (원장 지시 2026-08-19:
 * *"강사직급의 경우 다른사람의 체크리스트 및 자신의 체크리스트에서도 평가받은 다른사람의 점수나
 * 이런것들 전부 안뜨고 자기자신 평가만 할 수 있도록"*).
 *
 * 🔑 **판정 축은 실 `system_role`이다** — 뷰 전환(겸직 강사뷰·'다른 강사 뷰')이 아니다.
 *    CLAUDE.md의 "teacher-scope는 effectiveTeacherId 단일 소스" 규칙은 **데이터 스코프**용이고,
 *    이건 인사 평가 **열람 권한**이라 축이 다르다. effectiveTeacherId로 판정하면 관리자가 강사뷰
 *    토글을 켠 순간 남의 평가가 사라져 "뷰 전환은 권한을 바꾸지 않는다"(결정 로그)가 깨진다.
 *
 * ⚠️ 개인 예외로 `full`을 받은 강사도 여기서 걸린다 — 등급이 아니라 **직급**이 기준이라
 *    설정에서 실수로 강사에게 full을 줘도 남의 점수는 열리지 않는다(이중 방어).
 */
export function isSelfOnlyReviewer(role: SystemRole): boolean {
  return role === "teacher";
}

/** 이 평가지가 그 사람 **본인의** 평가지인가(= 평가 대상 강사). */
export function isOwnReview(doc: Pick<ReviewDoc, "header">, viewerId: string): boolean {
  return !!viewerId && doc.header.teacherId === viewerId;
}

/**
 * 자기 평가 전용 뷰용 **가림(redaction)** — 본인 채점 한 장만 남긴다.
 *
 * 화면에서 숨기는 게 아니라 **조회 초크포인트(getClassReview·listClassReviews)에서 잘라 낸다**([[#77]]):
 * 이렇게 해야 상세·채점·목록·집계가 전부 같은 사실을 보고, 새 표면이 생겨도 남의 점수가 딸려 나가지 않는다.
 * - `submissions` = self 한 장(관찰자 채점·코멘트·제출 시각 전부 제거)
 * - `evaluators` = 본인 슬롯만(관찰자 **이름**도 인사 정보라 함께 제거)
 * - `observerMode`를 assigned로 되돌린다 — 선착순으로 두면 상세 화면이 빈 관찰자 칸(정원)을 그려
 *   "몇 명이 나를 평가하는지"가 새고, 정원 칸이 채점 대상처럼 보인다.
 */
export function redactForSelfOnly(doc: ReviewDoc): ReviewDoc {
  const self = doc.submissions?.["self"];
  return {
    ...doc,
    header: { ...doc.header, observerMode: "assigned", observerLimit: 1 },
    evaluators: doc.evaluators.filter((e) => e.kind === "self"),
    submissions: self ? { self } : {},
  };
}
