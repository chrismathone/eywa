import { drawBoard, type DrawClasses } from "./draw";
import { netCenterOf, type NetBoard, type NetCallbacks, type NetCam, type NetInput, type NetSize, type NetViewMode } from "./graph";
import { netFitView, netLayout } from "./layout";
import { drawFocus, revealRecord } from "./node-actions";
import { animateView, keepInView } from "./camera";
import { backArrival, type PendingNet } from "./handoff";
import { NET_MORPH_MS, NET_VIEW_MS, easeInOutCubic, planMorphBack, planMorphTo, type NetPlan } from "./morph";

/**
 * 네트워크 판의 움직임(시안 `NET` · `netMorph` · `netViewAnim` 상태와 그 함수들) — React 밖에서 프레임을 돈다. 화면 상태(고른 영역·기록 ·
 * 보기 · 색상·이름 표시 · 전환 효과 생략)는 부모가 들고 `update`로 내려 준다. 판 자체(점 자리·보기·전환 프레임)는 여기 한 곳.
 * 보기 움직임(확대·맞춤·재맞춤)은 [`camera.ts`](./camera.ts) · 손짓은 [`interact.ts`](./interact.ts).
 */

export type EngineProps = { input: NetInput; selected: string | null; record: string | null; view: NetViewMode; colored: boolean; labels: boolean; instant: boolean };
export type EngineDom = { svg: SVGSVGElement; card: HTMLElement; zoom: HTMLOutputElement | null; cls: DrawClasses & { dragging: string } };

type Morph = { raf: number; t0: number; kind: "center" | "view"; finish: () => void; end: NetBoard };
const STUCK_MS = 3000;

export class NetEngine {
  board: NetBoard | null = null;
  size: NetSize = { w: 0, h: 0 };
  morph: Morph | null = null;
  viewAnim: { raf: number; target: NetCam } | null = null;
  /** 판이 지금 보여 주는 보기 — 보기 전환은 누른 순간 바뀐다(어두운 판 · 이름 크기). */
  view: NetViewMode;
  hoverId = "";
  lastOpen = 0;
  /** 방금 더블클릭한 점 — 떠날 때 축 후보([`node-actions.ts`](./node-actions.ts) `lastOpened`). */
  opened: { id: string; at: number } | null = null;
  readonly toggled = new Set<string>(); // 사람이 펼치거나 접은 날짜 묶음(기본에서 뒤집은 것 — layout.ts `isGroupOpen`) · 판(중심) 하나 동안만
  private frozenUntil = 0;
  private queuedView: NetViewMode | null = null;
  private planSize: NetSize | null = null;
  /** 지금 판을 짠 입력 — 부모가 새 입력을 주면(전환 중이면 끝난 뒤) 자리·보기를 지킨 채 다시 짠다. */
  private built: NetInput | null = null;
  private zoomText = "";
  private timer = 0;

  constructor(
    readonly dom: EngineDom,
    public p: EngineProps,
    readonly cb: NetCallbacks,
    private readonly onSettle: (b: NetBoard) => void,
  ) {
    this.view = p.view;
  }

  get centerId(): string {
    return netCenterOf(this.p.input).id;
  }
  measure = (): NetSize => ({ w: this.dom.svg.clientWidth, h: this.dom.svg.clientHeight });
  frozen = (): boolean => performance.now() < this.frozenUntil;
  /** 멈춘 전환(가려진 탭 등)이 남았으면 끝 모습으로 끝낸다. */
  private unstick(): void {
    if (this.morph && performance.now() - this.morph.t0 > STUCK_MS) this.morph.finish();
  }
  busyCenter(): boolean {
    this.unstick();
    return this.morph?.kind === "center";
  }
  /** 우클릭·더블클릭을 받지 않는 때 — 전환 중이거나 떠나는 중. */
  busy(): boolean {
    this.unstick();
    return !!this.morph || this.frozen();
  }
  /** 진행 중인 움직임(판 전환·보기)을 그 자리에서 멈춘다. */
  private stop(): void {
    if (this.viewAnim) cancelAnimationFrame(this.viewAnim.raf);
    if (this.morph) cancelAnimationFrame(this.morph.raf);
    this.viewAnim = this.morph = null;
  }

  /** 첫 판 — 맡겨진 판이 있으면 그 프레임에서 이어 보간(들어감 = 새 판으로 · 되돌아감 = 남겨 둔 판으로 역재생), 없으면 전체 맞춤. */
  start(pending: PendingNet | null): void {
    this.size = this.measure();
    this.built = this.p.input;
    const g = netLayout(this.p.input, this.view, this.toggled);
    if (!pending) return this.settleAt({ ...g, view: netFitView(g, this.size) });
    if (pending.dir === "in") {
      if (this.p.instant) return this.settleAt({ ...g, view: netFitView(g, this.size) });
      return this.run(planMorphTo(pending.board, g, pending.pivot, g.centerId, this.size), NET_MORPH_MS, "center");
    }
    const { board: A, pivotA } = backArrival(g, this.centerId, pending.from, this.size);
    if (this.p.instant) return this.settleAt(A);
    this.run(planMorphBack(pending.board, A, pivotA, pending.from), NET_MORPH_MS, "center");
  }

  private settleAt(b: NetBoard): void {
    this.board = b;
    this.draw();
    this.onSettle(b);
  }

  /** 전환 한 번 — 첫 프레임은 지금 바로(누른 그 틱에 보이기 시작). */
  private run(plan: NetPlan, ms: number, kind: Morph["kind"]): void {
    this.stop();
    const t0 = performance.now();
    const { end } = plan;
    this.planSize = { ...this.size };
    const finish = () => {
      if (this.morph !== m) return;
      cancelAnimationFrame(m.raf);
      this.morph = null;
      this.settleAt({ ...end, hover: null, morphing: false });
      this.afterMorph();
    };
    const frame = (now: number) => {
      if (this.morph !== m) return;
      const t = Math.min(1, (now - t0) / ms);
      const f = plan.frame(easeInOutCubic(t));
      this.board = { centerId: end.centerId, mode: end.mode, adjacency: end.adjacency, ...f, hover: null, morphing: true };
      this.draw();
      if (t < 1) m.raf = requestAnimationFrame(frame);
      else finish();
    };
    const m: Morph = { raf: 0, t0, kind, finish, end };
    this.morph = m;
    frame(t0);
  }

  private afterMorph(): void {
    const q = this.queuedView;
    this.queuedView = null;
    if (q && q !== this.view) return this.setView(q);
    if (this.built !== this.p.input) this.rebuild();
    const ps = this.planSize;
    if (ps && (ps.w !== this.size.w || ps.h !== this.size.h) && this.board) animateView(this, netFitView(this.board, this.size), 200);
  }

  /** 개별 기록 ↔ 주체별 요약 — 같은 중심에서 판만 바꾼다(900ms). 보기 전환 중 반대 버튼 = 지금 프레임에서 이어받는다 · 중심 전환 중엔 끝난 뒤로. */
  setView(view: NetViewMode): void {
    this.unstick();
    if (!this.board || view === this.view) return;
    if (this.morph?.kind === "center") {
      this.queuedView = view;
      return;
    }
    this.view = view;
    this.relayout(this.board.centerId, NET_VIEW_MS);
  }

  /** 같은 중심에서 판을 다시 짠다(`pivot` 축 보간) — 보기 전환(전체 맞춤) · 묶음 펼치기·접기(`keep` = 지금 보기·자리 유지 · 전환 중이면 그 끝 판 기준, node-actions.ts). */
  relayout(pivot: string, ms: number, keep?: { around: string; focus: string }): void {
    const base = keep ? (this.morph?.end ?? this.board) : null;
    this.stop();
    this.built = this.p.input;
    const g2 = netLayout(this.p.input, this.view, this.toggled, base && keep ? { from: base.pos, around: keep.around } : null);
    const view = base && keep ? keepInView(base.view, g2.pos[keep.focus], this.size) : netFitView(g2, this.size);
    if (this.p.instant || !this.board) return this.settleAt({ ...g2, view });
    this.run(planMorphTo(this.board, g2, pivot, pivot, this.size, base ? view : undefined), ms, "view");
  }

  /** 부모 상태가 바뀌었을 때 — 보기가 바뀌면 전환, 입력(모델)이 바뀌면 지금 자리·보기를 지킨 채 판을 다시 짠다. */
  update(next: EngineProps): void {
    const prev = this.p;
    this.p = next;
    if (this.built !== next.input && this.board && !this.morph) {
      if (netCenterOf(prev.input).id !== this.centerId) return this.start(null);
      this.rebuild();
    }
    if (next.view !== this.view) this.setView(next.view);
    else if (!(next.record && next.record !== prev.record && revealRecord(this, next.record))) this.draw(); // 접힌 묶음 안 기록 = 펼쳐 세운다
  }

  private rebuild(): void {
    const B = this.board;
    if (!B) return;
    this.built = this.p.input;
    const g = netLayout(this.p.input, this.view, this.toggled);
    for (const id in g.pos) if (B.pos[id]) g.pos[id] = { ...B.pos[id] };
    this.settleAt({ ...g, view: B.view, hover: B.hover });
  }

  draw(): void {
    const z = this.board ? drawBoard(this.dom.svg, this.board, { ...drawFocus(this), colored: this.p.colored, labels: this.p.labels, dark: this.view === "summary", cls: this.dom.cls, size: this.size }) : null;
    if (z !== null && z !== this.zoomText && this.dom.zoom) this.dom.zoom.textContent = z;
    if (z !== null) this.zoomText = z;
  }

  /** 떠나기 직전 — 움직임을 그 자리에서 멈추고 강조·hover를 지운다(맡기는 판 = 이 모습). 이동이 취소돼도 3초 뒤엔 다시 받는다. */
  freeze(): void {
    this.frozenUntil = performance.now() + STUCK_MS;
    this.stop();
    this.hoverId = "";
    if (this.board) this.board.hover = null;
    this.dom.card.hidden = true;
    this.draw();
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.draw(), STUCK_MS + 50);
  }

  destroy(): void {
    this.stop();
    window.clearTimeout(this.timer);
  }
}
