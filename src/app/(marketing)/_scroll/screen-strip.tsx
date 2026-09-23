import { StripCardsA } from "./strip-cards-a";
import { StripCardsB } from "./strip-cards-b";

/**
 * 강사·데스크 화면 스트립 — 가로 스크롤 없이 저절로 흐르고 마우스를 올리면 멈춘다(원장 2026-09-22).
 * 카드 높이는 줄에서 가장 큰 카드에 맞춰 모두 같다(*"높이는 통일해 가로너비는 다르더라도"*) — 폭은 같게 둔다
 * (카드 안이 폭 기준 `cqw`라 폭을 바꾸면 카드마다 글자 크기가 갈린다). 흐르는 속도는 `landing-motion`이 폭에서 정한다.
 */
export function ScreenStrip() {
  return (
    <section className="sec" aria-label="강사·데스크 화면 예시">
      <div className="wrap">
        <div className="marq" id="marq">
          <div className="strip" id="strip">
            <StripCardsA />
            <StripCardsB />
            <StripCardsA dup />
            <StripCardsB dup />
          </div>
        </div>
      </div>
    </section>
  );
}
