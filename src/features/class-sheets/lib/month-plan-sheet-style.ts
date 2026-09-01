import type { MpColumnKind } from "./month-plan";

/**
 * 월간 계획서(MP)의 **원본 구글 시트 서식** — 색·글꼴·글자 크기·테두리 두께를 그대로 옮긴 값.
 *
 * 원장 2026-09-01: *"글씨체부터 하나하나 그대로 카피해올것"* · *"폰트 사이즈같은것"* · *"글씨 크기까지"*.
 * 값은 눈대중이 아니라 **시트가 내려주는 CSS에서 뽑았다**(htmlview의 `.ritz .waffle .sN` 클래스) —
 * 예: 제목 `background-color:#4285f4; color:#ffffff; font-family:Impact; font-size:24pt`.
 *
 * 🔴 **이 문서는 앱 디자인 토큰을 일부러 안 쓴다.** 팔레트 v4(면=화이트·색은 의미에만)는 앱 화면의
 *    규약이고, 이건 **학부모에게 나가던 종이를 그대로 복제한 문서**다. 여기서 토큰으로 "정리"하면
 *    원본과 달라진다 — 그게 이 파일이 존재하는 이유이고, 화면·인쇄가 **같은 상수**를 봐야 갈리지 않는다.
 * 🔴 색을 화면 파일에 다시 적지 말 것(hex를 컴포넌트에 박으면 두 문서가 언젠가 갈린다).
 * ⚠️ 단위는 **pt**다(시트가 pt로 쓴다). 화면에서도 pt를 그대로 써야 인쇄물과 같은 크기로 보인다.
 */
export const MP_SHEET_COLOR = {
  /** 격자선 — 시트는 전부 검정 1px, 요일 경계만 3px. */
  grid: "#000000",
  titleBg: "#4285f4",
  titleFg: "#ffffff",
  /** 강사 이름(K1) — 파란 Comic Sans. */
  teacherFg: "#4285f4",
  legendBg: "#cfe2f3",
  /** `Day` 줄. */
  dayBg: "#ffe599",
  /** `Date` 줄. */
  dateBg: "#f9cb9c",
  /** 마지막 안내 한 줄만 굵은 빨강("본 일정은 학사일정에 따라…"). */
  alertFg: "#ff0000",
  paper: "#ffffff",
} as const;

/**
 * 글꼴 — 시트가 쓰는 그대로. Impact·Comic Sans MS는 윈도/맥 기본 글꼴이라 학원 PC에 있다.
 * ⚠️ 없는 환경을 위해 대체를 붙이되 **첫 글꼴은 원본과 같아야** 한다.
 */
export const MP_SHEET_FONT = {
  /**
   * 제목 — 시트는 Impact지만 **평범한 산세리프로 간다**(원장 2026-09-02 *"글씨체가 이런거 밖에 없어?
   * 평범한 걸로해"*). Impact 계열은 없는 PC에서 대체가 제각각이라 자간·소문자 모양이 튀었다.
   * 🔴 되돌려 Impact를 넣지 말 것 — 원장이 화면을 보고 내린 판단이다.
   */
  title: "Arial, Helvetica, sans-serif",
  teacher: "'Comic Sans MS', 'Comic Sans', cursive",
  body: "Arial, Helvetica, sans-serif",
} as const;

/** 글자 크기 — 전부 시트 값(pt). */
export const MP_SHEET_SIZE = {
  title: "24pt",
  teacher: "12pt",
  legend: "7pt",
  /** 안내 · Day · Date · 열 라벨 · 칸 값이 모두 9pt다. */
  body: "9pt",
  footer: "10pt",
} as const;

/**
 * **줄간격** — 보기용 `div`와 입력용 `textarea`가 반드시 같은 값을 써야 한다.
 * 🔴 `textarea`의 기본 `line-height`는 `normal`이라 브라우저·글꼴마다 다르다. 글꼴·크기만 맞추고
 *    이걸 빼면 **누르는 순간 줄간격이 미세하게 달라진다**(원장 제보 2026-09-02).
 */
export const MP_SHEET_LEADING = {
  /** 격자 칸 안(9pt). */
  cell: 1.3,
  /** 문서 아래 문구(10pt) — 여러 줄이라 조금 넉넉하게. */
  footer: 1.5,
} as const;

/** 열마다 다른 바탕·글자색 — 시트에서 뽑은 그대로(머리 칸과 값 칸이 다르다). */
const COL_HEAD_BG: Record<MpColumnKind, string> = {
  in_class: MP_SHEET_COLOR.paper,
  homework: MP_SHEET_COLOR.paper,
  // e-book은 **머리 칸도** 연주황이다(다른 셋은 흰색).
  ebook: "#fce5cd",
  test: MP_SHEET_COLOR.paper,
};
const COL_CELL_BG: Record<MpColumnKind, string> = {
  in_class: MP_SHEET_COLOR.paper,
  homework: MP_SHEET_COLOR.paper,
  ebook: "#fce5cd",
  // Test는 **값 칸만** 연파랑이다(머리 칸은 흰색) — 시트의 비대칭을 그대로 둔다.
  test: "#cfe2f3",
};
const COL_CELL_FG: Record<MpColumnKind, string> = {
  in_class: "#000000",
  // 과제는 굵은 빨강 — 학부모가 가장 먼저 봐야 하는 칸이라 시트가 그렇게 칠해 뒀다.
  homework: MP_SHEET_COLOR.alertFg,
  ebook: "#000000",
  test: "#000000",
};

/**
 * **격자 크기** — 시트는 A~K **모든 열이 81px**, **모든 행이 20px**이고 크기는 전부 병합으로 난다
 * (원장 2026-09-01 *"열너비 행너비까지 맞춰볼래"*). 그래서 픽셀을 그대로 옮긴다:
 *  · 로고 A1:B7 = 2열 × 7행 = 162 × 140
 *  · 제목 C1:J3 = 8열 × 3행 = 648 × 60   · 강사 K1:K2 = 81 × 40
 *  · 값 칸 = 7행 = 140   · Day·Date·열라벨 = 각 20
 * 인쇄도 같은 px를 쓴다 — 11열 × 81 = 891px ≈ 236mm로 A4 가로(여백 뺀 277mm)에 그대로 들어간다.
 */
export const MP_SHEET_GEOM = {
  /** 열 하나 폭(px) — 라벨 열(A)도 같다. */
  col: 81,
  /** 행 하나 높이(px). */
  row: 20,
  /** 로고가 차지하는 열 수(A·B). */
  logoCols: 2,
  /**
   * 강사·범례 칸의 폭(px) — **가장 긴 강사 이름이 들어가는 최소 폭**(원장 2026-09-02
   * *"최대한 여백없게. 영어 강사 이름 가장 긴걸 넣더라도"*).
   * 🔑 근거는 실데이터다: 영어 닉네임 23개 중 가장 긴 것이 **8자**(Daniella·Florence·Kristine)이고
   *    Comic Sans MS 12pt에서 약 70px + 테두리·여백 → 90px면 잘리지 않는다.
   * ⚠️ 시트의 K열은 81px지만 거기선 이름이 칸을 빠져나갔다 — 9px만 더 준 값이다.
   * ⚠️ 더 긴 닉네임이 생기면 여기를 올릴 것(안 올려도 `MP_CLIP`이 격자 밖으로 새는 것은 막는다).
   */
  sideW: 90,
  /** 강사 칸이 차지하는 행 수(K1:K2) — 시트 그대로 2행. 나머지 5행은 범례가 먹는다. */
  teacherRows: 2,
  /** 제목 띠가 차지하는 행 수. */
  titleRows: 3,
  /** 값 칸이 차지하는 행 수. */
  valueRows: 7,
} as const;

/**
 * 문서 전체 폭 — **머리말과 표의 오른쪽 끝이 같아야** 한 장의 문서로 읽힌다.
 * 라벨 열(A) 1개 + 데이터 열 N개, 전부 81px.
 * ⚠️ 머리말은 flex라 놔두면 창 폭을 다 먹는다 — 두 곳 모두 이 값을 폭으로 박을 것.
 */
export function mpDocWidth(dataColumnCount: number): string {
  return `${MP_SHEET_GEOM.col * (1 + dataColumnCount)}px`;
}

/** 시트 픽셀 → CSS 길이. 화면·인쇄가 같은 값을 쓰도록 한 곳에서 만든다. */
export const mpPx = (n: number) => `${n}px`;
export const MP_SHEET_PX = {
  col: mpPx(MP_SHEET_GEOM.col),
  logo: mpPx(MP_SHEET_GEOM.col * MP_SHEET_GEOM.logoCols),
  side: mpPx(MP_SHEET_GEOM.sideW),
  /** 강사 칸 높이(2행) — 그 아래 범례가 남은 높이(5행)를 먹는다. */
  teacher: mpPx(MP_SHEET_GEOM.row * MP_SHEET_GEOM.teacherRows),
  /** 머리말 전체 높이 = 로고가 차지하는 7행. */
  head: mpPx(MP_SHEET_GEOM.row * (MP_SHEET_GEOM.titleRows + 4)),
  band: mpPx(MP_SHEET_GEOM.row),
  title: mpPx(MP_SHEET_GEOM.row * MP_SHEET_GEOM.titleRows),
  value: mpPx(MP_SHEET_GEOM.row * MP_SHEET_GEOM.valueRows),
} as const;

/**
 * 안쪽 격자 — **전부 검정 1px**.
 * 🔑 시트를 다시 읽어 보니 3px은 요일 경계가 아니라 **문서의 바깥 가장자리**에만 있었다
 *    (`s8`·`s10`·`s12`·`s14` = 마지막 열 K, `s16`·`s17` = 마지막 행). 그래서 안쪽은 균일한 1px이고,
 *    두꺼운 선은 `MP_SHEET_OUTER`가 문서를 통째로 감싸서 낸다(원장 2026-09-02 *"가장 바깥 테두리를
 *    굵은 테두리로"*).
 */
export function mpGridBorder(): React.CSSProperties {
  return {
    borderBottom: `1px solid ${MP_SHEET_COLOR.grid}`,
    borderRight: `1px solid ${MP_SHEET_COLOR.grid}`,
  };
}

/** 문서 바깥 테두리 — 시트의 3px. 화면·인쇄가 같은 값을 쓴다. */
export const MP_SHEET_OUTER = `3px solid ${MP_SHEET_COLOR.grid}`;

/**
 * **칸 밖으로 새지 않게** 하는 공통 규칙(원장 2026-09-02).
 * 🔴 폭·높이가 시트 값으로 고정돼 있어서, 막지 않으면 긴 글자가 옆 칸 위로 흘러 격자를 뭉갠다.
 *    어절 단위로 접고(`break-word`), 그래도 넘치면 잘라서 **격자 밖으로는 절대 안 나가게** 한다.
 * ⚠️ 값 칸의 `textarea`는 스스로 스크롤하므로 이 규칙과 충돌하지 않는다.
 */
export const MP_CLIP: React.CSSProperties = {
  overflow: "hidden",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};

/**
 * 제목 띠 — 파란 바탕에 흰 글자. **굵게**(원장 2026-09-02 *"볼드"*).
 * 🔴 시트의 Impact는 글꼴 자체가 두꺼워 `font-weight`가 없었다. 평범한 Arial로 바꾸면서
 *    그 무게가 사라졌으므로 **여기서 명시**한다 — 화면·인쇄가 같이 굵어져야 한다.
 */
export function mpTitleStyle(): React.CSSProperties {
  return {
    backgroundColor: MP_SHEET_COLOR.titleBg,
    color: MP_SHEET_COLOR.titleFg,
    fontFamily: MP_SHEET_FONT.title,
    fontSize: MP_SHEET_SIZE.title,
    fontWeight: 800,
    height: MP_SHEET_PX.title,
    ...MP_CLIP,
  };
}

/** 열 라벨 칸(In-class / Homework / e-book / Test). */
export function mpHeadCellStyle(col: MpColumnKind): React.CSSProperties {
  return {
    ...MP_CLIP,
    ...mpGridBorder(),
    backgroundColor: COL_HEAD_BG[col],
    color: "#000000",
    fontFamily: MP_SHEET_FONT.body,
    fontSize: MP_SHEET_SIZE.body,
    fontWeight: 700,
    textAlign: "center",
  };
}

/** 값 칸 — 바탕·글자색이 열마다 다르고 **가운데 정렬**이다(시트 그대로). */
export function mpValueCellStyle(col: MpColumnKind): React.CSSProperties {
  return {
    ...MP_CLIP,
    lineHeight: MP_SHEET_LEADING.cell,
    ...mpGridBorder(),
    backgroundColor: COL_CELL_BG[col],
    color: COL_CELL_FG[col],
    fontFamily: MP_SHEET_FONT.body,
    fontSize: MP_SHEET_SIZE.body,
    fontWeight: 700,
    textAlign: "center",
  };
}

/** 값 칸 **안의 입력**은 칸 색을 그대로 물려받는다(바탕은 칸이 칠한다). */
export function mpValueInputStyle(col: MpColumnKind): React.CSSProperties {
  return {
    // ⚠️ 보기(div)·입력(textarea)이 **같은 객체**를 쓴다 — 하나라도 빠지면 누를 때 글자가 튄다.
    lineHeight: MP_SHEET_LEADING.cell,
    color: COL_CELL_FG[col],
    fontFamily: MP_SHEET_FONT.body,
    fontSize: MP_SHEET_SIZE.body,
    fontWeight: 700,
    textAlign: "center",
  };
}

/** `Day` / `Date` / `Week N` 줄 — 바탕색만 다르고 나머지는 같다. */
export function mpBandCellStyle(band: "day" | "date" | "week"): React.CSSProperties {
  return {
    ...MP_CLIP,
    ...mpGridBorder(),
    backgroundColor:
      band === "day"
        ? MP_SHEET_COLOR.dayBg
        : band === "date"
          ? MP_SHEET_COLOR.dateBg
          : MP_SHEET_COLOR.paper,
    color: "#000000",
    fontFamily: MP_SHEET_FONT.body,
    fontSize: MP_SHEET_SIZE.body,
    fontWeight: 700,
    textAlign: "center",
  };
}
