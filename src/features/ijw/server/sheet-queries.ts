import "server-only";

/**
 * 인재원 **응시 한 건의 시험 결과지**(설명서 3번) — 학생 상세 '결과지'가 여는 창의 재료.
 *
 * 🔴 강사(세 갈래 스코프, viewer.ts)는 결과지의 학생(ijwId)이 **짝으로 이어진 aywa 학생**이고 그 학생이 자기 스코프 안일
 *    때만 연다. 짝이 없거나 남의 학생이면 **없는 것처럼**(missing → 404) — 결과지엔 이름·반·틀린 단어가 그대로 실린다.
 * 🔴 강사인데 짝 색인 조회가 실패하면 열지 않는다(모르면 막는다, error로 알린다). 관리자는 결과지가 보이고 학생 링크만 빠진다.
 * 🔑 인재원이 404(없는 응시)이거나 이 학원에 연동이 없으면 missing — 화면은 404로 같은 답을 한다(#77).
 * 🔑 인재원 호출과 짝 색인은 서로 기다리지 않는다(B4).
 */
import type { IjwExamResult } from "../contract";
import { IJW_SCHEMAS } from "../contract";
import { IJW_PATHS, ijwGet, type IjwFailure } from "./client";
import { loadLinkIndex, type AywaLink } from "./links";
import type { JjViewer } from "./viewer";

export type JjAttempt =
  | { state: "ok"; exam: IjwExamResult; aywa: AywaLink | null }
  | { state: "missing" }
  | { state: "error"; failure: IjwFailure };

export async function getJjAttempt(viewer: JjViewer, attemptId: string): Promise<JjAttempt> {
  const [res, links] = await Promise.all([
    ijwGet(viewer.tenantId, IJW_PATHS.examResult(attemptId), IJW_SCHEMAS.examResult),
    loadLinkIndex(viewer.tenantId),
  ]);
  if (!res.ok) {
    if (res.kind === "not_found" || res.kind === "not_configured") return { state: "missing" };
    return { state: "error", failure: res };
  }
  const exam: IjwExamResult = res.data;
  const aywa = links.byIjw.get(exam.student.id) ?? null;
  const mine = viewer.teacherStudentIds;
  if (mine) {
    if (links.failure) return { state: "error", failure: links.failure };
    if (!aywa || !mine.has(aywa.studentId)) return { state: "missing" };
  }
  return { state: "ok", exam, aywa };
}
