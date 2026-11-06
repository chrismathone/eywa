"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from "react";
import { toast } from "sonner";
import { centerOnSelection, fitAnimated, resizeBoard, zoomAt } from "./camera";
import { NetEngine } from "./engine";
import { fullGraphOf, netHeadOf, netRootId, type ExploreNetworkProps, type NetBoard, type NetCallbacks, type NetHead, type NetInput, type NetViewMode } from "./graph";
import { netLayout } from "./layout";
import { consumePendingNet, copyBoard, peekPendingNet, registerLiveNet, savedNetFor } from "./handoff";
import { attachPointer } from "./interact";
import { NetLegend, NetToolbar } from "./net-chrome";
import { lastOpened, sectorOfSelection } from "./node-actions";
import styles from "./network.module.css";

export type { ExploreNetworkProps, NetAnalysis, NetFact, NetInput, NetRecordInfo, NetNeighbor } from "./graph";
export { netNeighbors, netHubId, netRootId, netTargetId } from "./graph";
export { prepareNetworkLeave } from "./handoff";

const DRAW_CLS = { node: styles.node, nlabel: styles.nlabel, hub: styles.hub, root: styles.root, dragging: styles.dragging };
const sameHead = (a: NetHead, b: NetHead) => a.mode === b.mode && a.nodes === b.nodes && a.hubs === b.hubs && a.edges === b.edges && a.name === b.name;

/**
 * 연결 탐색 **네트워크 보기**(시안 :3978 머리글 '네트워크') — 도구줄 · 판(SVG) · hover 카드 · 범례. 판은 [`engine.ts`](./engine.ts)가 React 밖에서
 * 그리고(요소 재사용), 고른 영역·기록 · 보기 · 넓게 보기 · 색상·이름 표시 · 전환 효과 생략은 부모 상태(계정 귀속은 부모가 저장).
 * 중심 전환 = 주소 이동이라 화면이 새로 마운트된다 — 떠나기 직전 부모가 `prepareNetworkLeave`를 부르면 새 판이 그 모습에서 이어 보간한다
 * ([`handoff.ts`](./handoff.ts)).
 */
export function ExploreNetwork(props: ExploreNetworkProps): JSX.Element {
  const { model, analyses, facts, selected, record, view, wide, instant, colored, labels } = props;
  const input = useMemo<NetInput>(() => ({ model, analyses, facts }), [model, analyses, facts]);
  const centerId = netRootId(model.center);
  const [pending] = useState(() => peekPendingNet(centerId));
  const [head, setHead] = useState<NetHead>(() => pending?.head ?? netHeadOf(netLayout(input, view), model.center.name, fullGraphOf(input)));
  const svgRef = useRef<SVGSVGElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLOutputElement>(null);
  const engineRef = useRef<NetEngine | null>(null);
  const propsRef = useRef(props);
  const inputRef = useRef(input);
  const headRef = useRef(head);
  useLayoutEffect(() => {
    propsRef.current = props;
    inputRef.current = input;
    headRef.current = head;
  });

  // 판 하나 = 엔진 하나(중심이 바뀌면 부모가 화면째 새로 마운트한다). 맡겨진 판이 있으면 그 프레임에서 이어 보간.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    const card = cardRef.current;
    if (!svg || !card) return;
    const P = propsRef.current;
    const cb: NetCallbacks = {
      onSelectSector: (k) => propsRef.current.onSelectSector(k),
      onSelectRecord: (r) => propsRef.current.onSelectRecord(r),
      onZoomSector: (k) => propsRef.current.onZoomSector(k),
      onOpenTarget: (t, via) => propsRef.current.onOpenTarget(t, via),
      onOpenRecord: (r) => propsRef.current.onOpenRecord(r),
      onCenterZoom: () => propsRef.current.onCenterZoom(),
    };
    const settle = (b: NetBoard) => {
      const next = netHeadOf(b, propsRef.current.model.center.name, fullGraphOf(inputRef.current));
      if (!sameHead(next, headRef.current)) {
        headRef.current = next;
        setHead(next);
      }
    };
    const E = new NetEngine(
      { svg, card, zoom: zoomRef.current, cls: DRAW_CLS },
      { input: inputRef.current, selected: P.selected, record: P.record, view: P.view, colored: P.colored, labels: P.labels, instant: P.instant },
      cb,
      settle,
    );
    engineRef.current = E;
    const mine = pending && pending.to === E.centerId ? pending : null;
    // 되돌아올 때 = 떠날 때 펼쳐 둔 날짜 묶음 그대로(되살린 확대 보기 자리에 빈 판이 남지 않게).
    if (mine?.dir === "out") for (const id of savedNetFor(E.centerId)?.toggled ?? []) E.toggled.add(id);
    E.start(mine);
    if (mine) consumePendingNet(mine);
    const detach = attachPointer(E);
    const unregister = registerLiveNet({
      centerId: E.centerId,
      freeze: () => E.freeze(),
      board: () => (E.board ? copyBoard(E.board) : null),
      size: () => ({ ...E.size }),
      head: () => headRef.current,
      lastOpened: () => lastOpened(E),
      toggled: () => [...E.toggled],
    });
    const ro = new ResizeObserver(() => resizeBoard(E));
    ro.observe(svg);
    return () => {
      ro.disconnect();
      unregister();
      detach();
      E.destroy();
      if (engineRef.current === E) engineRef.current = null;
    };
  }, [centerId, pending]);

  useLayoutEffect(() => {
    engineRef.current?.update({ input, selected, record, view, colored, labels, instant });
  }, [input, selected, record, view, colored, labels, instant]);

  // 넓게 보기 — Esc로 닫는다(시안).
  useEffect(() => {
    if (!wide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") propsRef.current.onWideChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [wide]);

  const E = () => engineRef.current;
  /** 보기 전환 — 중심 전환 중엔 무시. 요약으로 갈 때 고른 기록은 그 영역으로 잇는다(시안). */
  const switchView = (v: NetViewMode) => {
    const e = E();
    if (!e || v === view || e.busyCenter() || e.frozen()) return;
    if (v === "summary" && record) {
      const all = fullGraphOf(input).nodes;
      if (all.find((x) => x.id === record)?.kind !== "analysis") props.onSelectRecord(null);
      const sector = sectorOfSelection(e.board, record, all);
      if (sector) props.onSelectSector(sector);
    }
    props.onViewChange(v);
  };
  /** 판 위 우클릭 = 한 칸 뒤로(도구줄·범례·입력·링크 위는 브라우저 메뉴 그대로 · 전환 중엔 무시). */
  const onContextMenu = (ev: MouseEvent<HTMLDivElement>) => {
    if ((ev.target as Element).closest("[data-net-chrome], input, a")) return;
    ev.preventDefault();
    ev.stopPropagation();
    const e = E();
    if (!e || e.busy()) return;
    props.onBack();
  };

  const summary = view === "summary";
  const wrapCls = [styles.wrap, summary ? styles.summary : "", instant ? styles.instant : "", pending ? "" : styles.enter].filter(Boolean).join(" ");
  const onZoom = (f: number) => {
    const e = E();
    if (e) zoomAt(e, f);
  };
  const onFit = () => {
    const e = E();
    if (e) fitAnimated(e);
  };
  const onCenter = () => {
    const e = E();
    if (e && !centerOnSelection(e)) toast("고른 점이 없습니다.");
  };
  return (
    <div className={wrapCls} data-net-view={view} onContextMenu={onContextMenu}>
      <NetToolbar
        head={head}
        view={view}
        wide={wide}
        zoomRef={zoomRef}
        onView={switchView}
        onZoom={onZoom}
        onFit={onFit}
        onCenter={onCenter}
        onWide={() => props.onWideChange(!wide)}
      />
      <div className={styles.stage}>
        <svg ref={svgRef} tabIndex={0} role="img" aria-label="지식그래프" />
        <div ref={cardRef} className={styles.hoverCard} hidden>
          <strong />
          <span />
        </div>
      </div>
      <NetLegend
        mode={head.mode}
        summary={summary}
        colored={colored}
        labels={labels}
        hasFacts={!!facts && facts.length > 0}
        onColored={props.onColoredChange}
        onLabels={props.onLabelsChange}
      />
    </div>
  );
}
