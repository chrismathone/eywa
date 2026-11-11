import { useState } from "react";
import { toast } from "sonner";
import { saveKgGraphPrefs } from "./graph-prefs-action";
import type { KgGraphPrefs, KgNetView } from "./graph-prefs";

/**
 * 이 문서에서 방금 바꾼 보기 — 저장(서버 액션)이 끝나기 전에 주소가 바뀌어도(학생·강사 상세) 옛 값으로 돌아가지 않게(연결 탐색과 같은 규칙).
 * 🔴 이벤트 처리에서만 바꾼다(서버 렌더에선 늘 빈 값). 넓게 보기는 계정에 남기지 않고 이 문서에서만 잇는다.
 */
const sessionPrefs: Partial<KgGraphPrefs> & { wide?: boolean } = {};

/** 지식그래프 네트워크의 보기 상태(개별 기록 | 주체별 요약 · 영역별 색상 · 이름 표시 · 넓게 보기) — `ExploreNetwork`에 그대로 넘기는 값과 바꾸는 함수. */
export function useGraphView(prefs: KgGraphPrefs) {
  const init = { ...prefs, ...sessionPrefs };
  const [view, setView] = useState<KgNetView>(init.netView);
  const [colored, setColored] = useState(init.colored);
  const [labels, setLabels] = useState(init.labels);
  const [wide, setWide] = useState(sessionPrefs.wide === true);
  const save = (patch: Partial<KgGraphPrefs>) => {
    Object.assign(sessionPrefs, patch);
    // 실패해도 이 문서에선 바뀐 대로 보인다 — 다음 방문에 되돌아가지 않게 저장 실패는 알린다.
    const fail = () => toast("보기 설정을 저장하지 못했습니다. 다음에 열면 이전 설정으로 보일 수 있습니다.");
    void saveKgGraphPrefs(patch).then((r) => (r.ok ? undefined : fail()), fail);
  };
  return {
    view,
    onViewChange: (v: KgNetView) => {
      setView(v);
      save({ netView: v });
    },
    wide,
    onWideChange: (w: boolean) => {
      setWide(w);
      sessionPrefs.wide = w;
    },
    colored,
    labels,
    onColoredChange: (b: boolean) => {
      setColored(b);
      save({ colored: b });
    },
    onLabelsChange: (b: boolean) => {
      setLabels(b);
      save({ labels: b });
    },
  };
}
