/* 계기판 좌표의 단일 원본. Blender 렌더와 SVG(viz-gauge.js)가 이 값 하나를 함께 읽는다.
   단위는 판 반지름 R = 1. 중심(0,0)은 바늘 축이고 y는 위쪽이 +. 각도는 수학 각도(+x가 0도, 반시계)다.
   값 v의 각도 = sweep.start - sweep.span * v / 100. */
export const GAUGE_GEOM = {
  "sweep": { "start": 210, "span": 240, "segments": 5 },
  "plate": { "radius": 1.0, "bezel": 0.062, "flange": 0.03 },
  "track": { "outer": 0.888, "inner": 0.742, "ribWidth": 0.026 },
  "ticks": { "major": [0.722, 0.672], "middle": [0.722, 0.688], "minor": [0.722, 0.702] },
  "numerals": { "radius": 0.5 },
  "needle": { "tip": 0.8, "tail": 0.2, "base": 0.058 },
  "hub": { "radius": 0.088 },
  "readout": { "cy": 0.46, "labelCy": 0.745 },
  "image": { "x0": -1.04, "x1": 1.04, "y0": -1.04, "y1": 1.04, "pxPerUnit": 500 }
};
