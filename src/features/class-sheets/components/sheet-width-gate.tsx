import Link from "next/link";
import type { ReactNode } from "react";

import { EyIcon } from "@/components/icons/eywa-icons";
import { SHEET_MIN_WIDTH } from "../sheet-min-width";

/**
 * **폭 안내 게이트** — 시트를 못 쓰는 폭에선 시트 대신 "창을 넓혀 주세요"를 세운다
 * (원장 2026-09-01 *"폭을 너무 좁힐 경우 일정 폭 이상 크게하라고 안내하는 화면으로"*).
 * 주간 시트와 월간 뷰가 **같은 껍데기**를 쓴다(상단 바 통일과 같은 결 — 두 화면이 같은 폭에서
 * 같은 말을 해야 한다).
 *
 * 🔴 판정은 **CSS 한 곳**([globals.css](../../../app/globals.css) `.sheet-width-gate` /
 *    `.sheet-too-narrow`)이고 여기선 마커만 붙인다. 폭을 JS로 재서 갈아 끼우면 ① 서버·클라 첫 렌더가
 *    갈려 하이드레이션이 깨지고([[#75]]·[[#108]]) ② 시트가 **언마운트돼 저장 안 된 입력이 날아간다**.
 *    지금은 숨기기만 해서 넓히면 치던 글자 그대로 돌아온다.
 * 🔴 **막다른 길로 만들지 않는다** — 안내에 '반 목록으로'를 둔다. 랜딩은 좁은 폭을 위해 일부러
 *    1단 상하로 설계된 화면이라(원장 2026-08-28) 여기서 갈 수 있는 유일한 성한 곳이다.
 * ⚠️ 터치 기기엔 이 안내가 **뜨지 않는다**(CSS가 `pointer: fine`으로 건다) — 창을 못 넓히는 사람에게
 *    넓히라고 하면 그게 곧 차단이다. 문구를 고칠 땐 그 전제도 함께 볼 것.
 */
export function SheetWidthGate({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="sheet-width-gate min-h-0 flex-1">{children}</div>
      <div className="sheet-too-narrow min-h-0 flex-1 items-center justify-center px-4">
        <div className="bg-card shadow-card flex max-w-[19rem] flex-col items-center gap-2 rounded-2xl px-5 py-6 text-center">
          <EyIcon name="window" size={26} className="text-text-faint" />
          <p className="text-foreground text-[15px] font-bold">창이 너무 좁습니다</p>
          <p className="text-text-dim text-[13px] leading-relaxed">
            영어 강사 시트는 하루치 수업 한 칸이 다 들어와야 쓸 수 있습니다. 창을 넓히거나, 화면 배율을
            크게 해 둔 상태라면 배율을 낮춰 주세요.
          </p>
          <p className="text-text-faint text-[12px]">
            최소 <span className="num">{SHEET_MIN_WIDTH}px</span>
          </p>
          <Link
            href="/ecs"
            className="text-primary mt-1 text-[13px] font-bold underline-offset-2 hover:underline"
          >
            반 목록으로
          </Link>
        </div>
      </div>
    </>
  );
}
