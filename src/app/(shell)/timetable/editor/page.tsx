import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { canUseTimetableEditor } from "@/features/timetable-lab/server/access";
import { blankAppearance } from "@/features/timetable-lab/server/appearance";
import { getTenantSettings } from "@/features/owner/server/queries";
import { TimetableEditorHost } from "./_components/editor-host";

/**
 * 시간표 편집기(연습본) — 운영 시간표와 분리된 개인 연습 공간. 운영 시간표에 반영하는 길은 아직 없다
 * (docs/decisions/timetable.md '시간표 연습실').
 *
 * 서버가 하는 일은 **권한 판정과 학원설정(교시) 전달**뿐이다. 시간표 자료는 편집기가 '기존 시간표 불러오기'·
 * '연습본 불러오기'를 누를 때 API로 읽는다 — 첫 화면을 무거운 조회로 막지 않는다(B7). 학원설정은 지점별 캐시라 조회가 늘지 않는다.
 * 게이트 = 시간표 열람 + 시간표·반 관리(`canUseTimetableEditor`). 진입 버튼과 연습본 API가 같은 판정을 쓴다(#77).
 */
export default async function TimetableEditorPage() {
  const user = await requireAccess("timetable");
  // 볼 수는 있지만 편집기를 쓸 권한이 없는 사람(강사 등)은 시간표로 돌려보낸다.
  // 창(iframe) 안이면 `embed=1`을 지킨다 — 빠지면 창 안에 사이드바까지 든 전체 화면이 뜬다(#133).
  if (!(await canUseTimetableEditor(user.systemRole))) {
    redirect((await headers()).get("x-embed") === "1" ? "/timetable?embed=1" : "/timetable");
  }
  return (
    // `.edge-to-edge` — 창에선 좌우·아래 여백 0(편집기가 창을 가득 쓴다). loading.tsx 루트와 같은 className.
    <div className="edge-to-edge timetable-editor-page h-full min-h-0">
      <TimetableEditorHost appearance={blankAppearance(await getTenantSettings())} />
    </div>
  );
}
