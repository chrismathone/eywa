import Link from "next/link";
import type { SheetLandingCard } from "@/features/class-sheets/server/queries";
import { landingCardPct, summarizeLanding } from "@/features/class-sheets/landing-summary";

/**
 * ECS 주간 랜딩 목록 — **한 장의 시트**(카드 벽 아님).
 *
 * 원장 2026-08-11: *"영어 강사 시트 관리자 첫 화면이 너무 정신없음. 이름에 걸맞게 컴팩트한 화면으로."*
 * 실측 42반 × (그림자 카드 4줄)이라 첫 화면이 1,500px를 넘겼다 — 창을 열자마자 스크롤 없이는 전모가
 * 안 보이고, 42개의 둥근 그림자가 각자 시선을 끌었다. 그래서:
 *  · **표면을 하나로** — 카드 42장 → 패널 1장 + 한 줄짜리 행(그림자·라운드가 42배로 울리지 않는다).
 *  · **한 행 = 한 반**(반 · 담임 · 작성 교시 · 막대). 카드마다 반복되던 "교시 작성" 라벨은 머리 legend로 한 번.
 *  · 행을 **여러 열로 흘린다**(반응형 1→2→3→4열). 목록을 세로로만 쌓으면 행을 줄여도 화면은 안 짧아진다.
 *
 * ⚠️ **정렬은 그대로 반 이름순**이다(서버 `order("class_name")`). 담임별로 묶는 편이 조밀하긴 하나
 *    "그 반이 어디 있나"를 담임을 알아야 찾게 만든다 — 요청은 압축이지 재조직이 아니다.
 * ⚠️ 서버 컴포넌트로 둔다 — 상호작용이 링크뿐이라 클라 번들을 늘릴 이유가 없다(반응속도 1순위).
 */
export function EcsLandingList({ cards, weekMonday }: { cards: readonly SheetLandingCard[]; weekMonday: string }) {
  const s = summarizeLanding(cards);
  return (
    <section className="bg-card shadow-card rounded-2xl px-3 py-2.5">
      {/* 머리 = 이 주 전체 작성 상황 한 줄. 카드마다 흩어져 있던 숫자를 한 번만 말한다. */}
      <div className="border-line flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-1 pb-2">
        <h2 className="text-foreground text-[13px] font-bold">
          반 <span className="num">{s.classes}</span>개
        </h2>
        <p className="text-text-dim text-[12px]">
          교시 작성{" "}
          <span className="num text-foreground font-bold">
            {s.filled}/{s.scheduled}
          </span>{" "}
          <span className="num">({s.pct}%)</span>
        </p>
        {s.untouched > 0 ? (
          <p className="text-text-dim text-[12px]">
            미작성 <span className="num text-foreground font-bold">{s.untouched}</span>반
          </p>
        ) : null}
        {s.done > 0 ? (
          <p className="text-text-dim text-[12px]">
            완료 <span className="num text-foreground font-bold">{s.done}</span>반
          </p>
        ) : null}
        {/* 배정 교시가 0인 반은 '미작성'과 갈라 말한다 — 사무실이 못 고칠 일을 재촉받지 않게. */}
        {s.idle > 0 ? (
          <p className="text-text-dim text-[12px]">
            이 주 수업 없음 <span className="num text-foreground font-bold">{s.idle}</span>반
          </p>
        ) : null}
        <p className="micro ml-auto hidden sm:block">반 · 담임 · 작성 교시</p>
      </div>

      {/* 🔴 **3열이 상한**(원장 2026-08-11 "4열 빼고 3열까지만"). 4열은 열 폭이 291px로 떨어져 담임 이름이
          잘리기 시작했다 — 이름이 잘리면 담임으로 훑는 일이 안 된다(같은 날 '담임 진하게'와 한 뭉치의 지시).
          넓은 창에선 열을 더 늘리는 대신 각 행이 넉넉해진다. 한 단계 더 좁히면(4열) 잘리는 행 1 → (5열) 32. */}
      <ul className="grid grid-cols-1 gap-x-5 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const pct = landingCardPct(card);
          const idle = card.totalSlots === 0;
          // 🔴 압축의 대가 — "교시 작성"이라는 **단위**가 카드마다 있던 자리에서 머리 legend로 옮겨갔다.
          // 눈으로는 legend가 열을 설명하지만 스크린리더는 행만 읽어 "0/5"가 무엇의 5인지 알 수 없다.
          // 그래서 행의 접근성 이름에 단위를 되돌려 붙인다(보이는 글자는 그대로 두고 읽히는 글자만 보강).
          const srLabel = [
            card.className,
            card.delegated ? "위임 받은 반" : null,
            card.orphanSlots > 0 ? `시간표가 바뀌어 지금 시간표에 없는 기록 ${card.orphanSlots}건` : null,
            `${card.teacherName ?? "담임 미지정"}${card.delegated ? " 선생님 반" : ""}`,
            idle ? "이 주에 배정된 교시 없음" : `작성 교시 ${card.filledSlots}/${card.totalSlots}`,
          ]
            .filter(Boolean)
            .join(", ");
          return (
            // 행 밑줄은 열마다 이어져 "표"로 읽힌다 — 열 사이 세로선은 두지 않는다(열은 같은 표의 이어짐이지
            // 다른 항목이 아니다). 마지막 행만 선을 빼면 열마다 끝이 달라 되레 어긋나 보여 전부 긋는다.
            <li key={card.classId} className="border-line-faint border-b">
              <Link
                href={`/ecs/${card.classId}?week=${weekMonday}`}
                aria-label={srLabel}
                // 좁은 화면에선 행을 더 눕히지 않는다 — 한 줄로 줄인 대가로 **손가락이 못 누르는 줄**이
                // 되면 압축이 아니라 고장이다(1열일 땐 어차피 세로가 남는다). 넓은 화면은 마우스라 7px.
                className="hover:bg-bg-soft flex items-center gap-2 rounded-lg px-1.5 py-2.5 transition sm:py-[7px]"
              >
                <span className="text-foreground max-w-[60%] shrink-0 truncate text-[13px] font-bold">
                  {card.className}
                </span>
                {/* 임시 위임(0173a) — 원스크린 반 칩과 같은 앰버 규약. 남의 반 시트를 내 반인 줄 알고
                    고치는 일이 없게, 목록에서부터 갈라 보인다(원장 지시 2026-08-03). */}
                {card.delegated ? (
                  <span className="border-amber bg-amber-soft text-amber shrink-0 rounded-pill border px-1 py-px text-[10px] font-bold">
                    위임
                  </span>
                ) : null}
                {card.orphanSlots > 0 ? (
                  <span
                    className="text-amber shrink-0 text-[10px] font-bold"
                    title={`시간표가 바뀌어 지금 시간표에 없는 기록 ${card.orphanSlots}건`}
                  >
                    시간변경 <span className="num">{card.orphanSlots}</span>
                  </span>
                ) : null}
                {/* 담임 이름은 **진하게**(원장 2026-08-11) — 이 목록을 담임 기준으로 훑는 일이 실제로
                    많아서다(같은 날 담임 필터도 함께 붙었다). 반 이름과는 **크기**로 갈린다(13px/12px)
                    — 굵기까지 같으면 두 글자 덩어리가 붙어 보여 행이 도로 시끄러워진다.
                    ⚠️ 담임이 없는 반의 '담임 미지정'은 사람 이름이 아니라 상태라 진하게 하지 않는다. */}
                <span
                  className={`min-w-0 flex-1 truncate text-[12px] ${
                    card.teacherName ? "text-foreground font-semibold" : "text-text-dim"
                  }`}
                >
                  {card.teacherName ?? "담임 미지정"}
                  {card.delegated ? " 선생님 반" : ""}
                </span>
                {idle ? (
                  <span
                    className="text-text-dim w-11 shrink-0 text-right text-[12px]"
                    title="이 주에 배정된 교시가 없습니다"
                  >
                    —
                  </span>
                ) : (
                  <span className="num text-foreground w-11 shrink-0 text-right text-[12px] font-bold">
                    {card.filledSlots}/{card.totalSlots}
                  </span>
                )}
                <span className="bg-bg-soft h-1.5 w-10 shrink-0 overflow-hidden rounded-full">
                  <span className="bg-primary block h-full rounded-full" style={{ width: `${pct}%` }} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
