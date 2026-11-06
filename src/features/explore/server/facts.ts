import "server-only";
import { getStudentById } from "@/features/students/server/queries";
import { getStudentSiblings } from "@/features/students/server/siblings";
import { siblingHint } from "@/features/students/siblings";
import type { NetFact } from "../components/network/types";

const BASIS_TEXT = { phone: "학부모 휴대폰 같음 · 자동 판정", name: "학부모 이름 같음 · 자동 판정", manual: "수정 화면에서 지정" } as const;

/**
 * 네트워크 보기의 '온톨로지 사실'(원장 2026-11-05 시안 :3978) — 지금은 **형제**만 싣는다(원생 상세 프로필 '형제'와 같은 함수·같은 열람 범위 ·
 * 담당 밖 형제는 빠진다). 시안의 '보호자 선호 연락'·'셔틀 하원 시각'·'긍정 신호'는 같은 원본에서 읽는 조회가 아직 없어 싣지 않는다(지어내지 않는다).
 * page가 기다리지 않고 약속으로 넘긴다 — 첫 화면을 막지 않는다(B7). 실패하면 빈 목록(사실 영역이 안 선다).
 */
export async function loadExploreFacts(studentId: string): Promise<NetFact[]> {
  try {
    const s = await getStudentById(studentId);
    if (!s) return [];
    const found = await getStudentSiblings({ id: s.id, name: s.name, parentName: s.parentName, parentPhone: s.parentPhone, parent2Phone: s.parent2Phone });
    return found.siblings.map((x) => {
      const hint = siblingHint(x);
      return {
        id: `sibling:${x.id}`,
        title: `형제 · ${x.name}${hint ? `(${hint})` : ""}`,
        detail: x.basis === "conflict" ? "확인 후보" : BASIS_TEXT[x.basis],
        target: { kind: "student" as const, id: x.id, label: x.name, detail: hint || null },
      };
    });
  } catch (e) {
    console.error("[explore/facts] 사실 조회 실패", e instanceof Error ? e.message : e);
    return [];
  }
}
