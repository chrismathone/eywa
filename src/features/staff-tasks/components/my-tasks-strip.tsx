import "server-only";
import { isReadonlyTeacherView } from "@/lib/auth/view-mode";
import { reportError } from "@/lib/observability/report-error";
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { getStaffTaskViewer } from "../server/gate";
import { countOpenTasks } from "../server/queries";
import { MyTasksStripButton } from "./my-tasks-strip-button";

/**
 * 강사 홈(원스크린 · 영어 시트) 맨 위 '내 할 일' 한 줄(0377a) — 열린 할 일이 있을 때만 선다(없으면 아무것도 안 그린다).
 * 누르면 공통 할 일 창. ⚠️ 부르는 쪽이 Suspense로 감싼다(전원이 매일 여는 화면 — 첫 페인트를 막지 않는다, B7).
 * '다른 강사 뷰'(열람)에서는 서지 않는다 — 창은 로그인한 본인의 할 일을 열기 때문.
 */
export async function MyTasksStrip({ className }: { className?: string } = {}) {
  const found = await loadMine();
  return found ? <MyTasksStripButton open={found.open} late={found.late} lang={found.lang} className={className} /> : null;
}

async function loadMine(): Promise<{ open: number; late: number; lang: "ko" | "en" } | null> {
  try {
    const [viewer, readonly, lang] = await Promise.all([getStaffTaskViewer(), isReadonlyTeacherView(), getTeacherViewLang()]);
    if (!viewer || readonly) return null;
    const mine = (await countOpenTasks(viewer.user.tenantId, viewer.user.id)).get(viewer.user.id);
    return mine?.open ? { ...mine, lang } : null;
  } catch (error) {
    reportError(error, { scope: "staff-tasks.strip" });
    return null;
  }
}
