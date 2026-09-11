// 낙관 쓰기 사슬 — 한 칸에 응답을 기다리는 쓰기가 겹칠 때, 늦게 온 성공·실패가 어디로 가야 하는지.
//
// 🔴 왜 순번이 아니라 사슬인가(재리뷰 2026-09-11): 칠하기 직전 자리(`prev`)가 **아직 응답을 기다리는 앞 쓰기의 값**일
//    수 있다. "그 사이 누가 건드렸나"만 보면 앞 쓰기의 결과(실패·보정)는 버려지고, 뒤 쓰기가 실패하면 **저장된 적 없는
//    앞 값**으로 굳었다(둘 다 실패 → '결석'에 굳음 · 앞은 성공해 보정됐는데 → 보정 전 1.5에 굳음). 그래서 적용하지
//    못한 결과를 표식에 **남기고**(`fate`), 되돌릴 때 사슬을 거슬러 간다.
// ⚠️ 칸의 주인(지금 보이는 값을 칠한 쓰기)은 받는 쪽이 쥔다 — 격자 저장소는 값, 칸 컴포넌트는 메모.

/** 칠한 쓰기 한 번. */
export type Paint<T> = {
  /** 칠하기 직전 덮개가 있었나 — 없었으면 되돌릴 때 덮개를 벗겨 서버 값을 보인다. */
  had: boolean;
  /** 칠하기 직전 값(`had`일 때만 뜻이 있다). */
  prev: T;
  /** 칠하기 직전 그 칸의 주인이던 쓰기(응답 대기 중일 수 있다). 사슬 밖 쓰기(격자 타이핑·서버 따라잡기 뒤)면 null. */
  prevOwner: Paint<T> | null;
  /** 응답 결과 — 적용했든 못 했든 남긴다. 뒤 쓰기의 되돌리기가 읽는다. 없으면 아직 응답 대기(또는 보정 없는 성공). */
  fate?: { revert: true } | { value: T };
};

export type RevertTarget<T> = { drop: true } | { drop: false; value: T; owner: Paint<T> | null };

/**
 * 실패한 쓰기가 돌아갈 자리. 앞 쓰기가 이미 실패했으면 **그 앞 쓰기의 자리**로, 성공해 보정됐으면 **그 값**으로 거슬러 간다.
 * 앞 쓰기가 아직 응답을 기다리면 그 값으로 돌리고 칸을 그 쓰기에 되돌려 준다(`owner`) — 그 응답이 나중에 와도 제 칸을 알아본다.
 * `drop` = 덮개를 벗겨 서버 값을 보인다.
 */
export function revertTarget<T>(paint: Paint<T>): RevertTarget<T> {
  for (let cur = paint; ; ) {
    if (!cur.had) return { drop: true };
    const q = cur.prevOwner;
    if (!q) return { drop: false, value: cur.prev, owner: null };
    if (!q.fate) return { drop: false, value: cur.prev, owner: q };
    if ("value" in q.fate) return { drop: false, value: q.fate.value, owner: null };
    cur = q;
  }
}
