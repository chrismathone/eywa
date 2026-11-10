"use client";

// 개발 전용 샘플: 로그인 없이 동작하며 저장은 서버로 보내지 않는다.
import { MENU_KEYS, type MenuKey } from "@/lib/permissions";
import { BUNDLES, type Bundle } from "@/features/dashboard/layout/types";
import { DashboardEditorLazy } from "@/app/(shell)/owner/_components/dashboard/dashboard-editor-lazy";
import { ReplyHarness } from "./reply-harness";

const menus = Object.fromEntries(BUNDLES.map((b) => [b, b === "owner" ? [...MENU_KEYS] : MENU_KEYS.filter((m) => m !== "staff" && m !== "owner")])) as Record<Bundle, MenuKey[]>;

/** 개발 전용 샘플 — 대시보드 배치 편집기(저장 안 함) · 답글 레이아웃(`?mode=reply`). 옛 운영실 '보기' 모드는 화면과 함께 걷었다(P3-D). */
export function Harness({ mode }: { mode: string }) {
  if (mode === "reply") return <ReplyHarness />;
  return (
    <div style={{ padding: 16 }} onSubmitCapture={(event) => { event.preventDefault(); event.stopPropagation(); }}>
      <p role="status" className="mb-4 text-sm">샘플 데이터로 편집 동작을 확인하는 화면입니다. 변경 내용은 저장되지 않습니다.</p>
      <DashboardEditorLazy
        initial={{ version: 1, layouts: [] }}
        roleMenus={menus}
        subjects={[{ key: "math", label: "수학" }, { key: "english", label: "영어" }]}
        members={{ failed: false, people: [
          { id: "sample-owner", name: "원장 예시", role: "master", bundle: "owner", scopeLabel: "전 과목", subjectKeys: ["math", "english"], canOpen: true, inherited: true },
          { id: "sample-math", name: "수학 담당 예시", role: "admin", bundle: "subject", scopeLabel: "수학", subjectKeys: ["math"], canOpen: true, inherited: false },
          { id: "sample-desk", name: "경영지원 예시", role: "admin", bundle: "desk", scopeLabel: "전 과목", subjectKeys: ["math", "english"], canOpen: true, inherited: false },
        ] }}
      />
    </div>
  );
}
