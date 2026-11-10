/** 그림 엔진(JS)의 겉모양. 그림 함수는 칸 크기와 값을 받아 SVG 문자열을 돌려준다. */
type Svg = string;
type Opts = Record<string, unknown>;
type Draw<T = Opts> = (w: number, h: number, opts: T) => Svg;

export const V: {
  esc: (s: unknown) => string;
  fmt: (n: number) => string;
  money: (n: number) => string;
  signed: (n: number) => string;
  gauge: Draw;
  trend: Draw;
  stackColumns: Draw;
  funnel: Draw;
  rank: Draw;
  stackRows: Draw;
  ring: Draw;
  thinBar: Draw;
  fuel: Draw;
  unitRows: Draw;
  schoolGroups: Draw;
  timeline: Draw;
  spark: Draw;
  miniColumns: Draw;
  miniSteps: Draw;
  paint: (el: HTMLElement, draw: (w: number, h: number) => string, force?: boolean, size?: readonly [number, number]) => void;
  update: (el: HTMLElement, draw: (w: number, h: number) => string, size?: readonly [number, number]) => void;
  enter: (el: HTMLElement) => void;
  fontsReady: () => Promise<unknown>;
  fontFamily: () => string;
  attachTips: () => () => void;
};
