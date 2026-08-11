import Link from "next/link";
import type { SheetLandingCard } from "@/features/class-sheets/server/queries";
import { groupLandingByTeacher } from "@/features/class-sheets/landing-groups";
import { landingCardPct, summarizeLanding } from "@/features/class-sheets/landing-summary";

/**
 * ECS 주간 랜딩 목록 — **한 장의 시트, 열마다 담임**.
 *
 * 원장 2026-08-11 ①: *"관리자 첫 화면이 너무 정신없음. 이름에 걸맞게 컴팩트한 화면으로."*
 * 실측 42반 × (그림자 카드 4줄)이라 첫 화면이 1,500px를 넘겼다 → 표면 42장을 **패널 1장 + 한 줄짜리 행**으로.
 * 원장 2026-08-11 ②: *"열마다 담임 구분해서 놓자."* → 흐름을 반 이름순 한 줄에서 **담임 묶음**으로 바꿨다.
 * 이 화면을 보는 실제 질문이 *"어느 반이 비었나"*가 아니라 **"누가 안 썼나"**라는 뜻이라, 담임 이름이
 * 42번 반복되던 자리를 묶음 머리 하나로 접고 그 담임 몫의 작성률을 거기에 붙인다.
 *
 * 🔴 배치는 grid가 아니라 **CSS 다단(multi-column)** 이다. grid로 묶음을 칸에 넣으면 한 행의 높이가
 *    그 행에서 가장 큰 묶음(전양원 7반)에 맞춰져 작은 묶음(정유진 2반) 아래가 통째로 빈다. 다단은
 *    묶음을 위에서부터 흘려 담아 스스로 균형을 잡는다 — `break-inside-avoid`로 한 담임이 두 열에
 *    걸치는 것만 막으면 된다.
 * ⚠️ 행에서 담임 이름을 뺐다 — 묶음 머리가 그 말을 이미 하고 있다(같은 사실을 두 번 적으면 그게 소음이다).
 * ⚠️ 서버 컴포넌트로 둔다 — 상호작용이 링크뿐이라 클라 번들을 늘릴 이유가 없다(반응속도 1순위).
 */
export function EcsLandingList({ cards, weekMonday }: { cards: readonly SheetLandingCard[]; weekMonday: string }) {
  const s = summarizeLanding(cards);
  const groups = groupLandingByTeacher(cards);
  return (
    <section className="bg-card shadow-card rounded-2xl px-3 py-2.5">
      {/* 머리 = 이 주 전체 작성 상황 한 줄. 카드마다 흩어져 있던 숫자를 한 번만 말한다. */}
      <div className="border-line mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-1 pb-2">
        <h2 className="text-foreground text-[13px] font-bold">
          반 <span className="num">{s.classes}</span>개
        </h2>
        <p className="text-text-dim text-[12px]">
          담임 <span className="num text-foreground font-bold">{groups.length}</span>명
        </p>
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
      </div>

      <div className="columns-1 gap-x-5 sm:columns-2 lg:columns-3">
        {groups.map((g) => (
          // break-inside-avoid = 한 담임의 반들이 두 열에 쪼개지지 않게(묶음이 열보다 길면 어쩔 수 없이 쪼개진다).
          <section key={g.key} className="mb-3 break-inside-avoid">
            <div className="border-line-strong flex items-baseline gap-1.5 border-b px-1 pb-0.5">
              <h3
                className={`truncate text-[13px] font-bold ${
                  g.unassigned ? "text-text-dim" : "text-foreground"
                }`}
              >
                {g.label}
              </h3>
              <span className="text-text-dim shrink-0 text-[11px]">
                <span className="num">{g.summary.classes}</span>반
              </span>
              {/* 그 담임 몫의 작성 상황 — "누가 안 썼나"가 이 화면의 질문이라 묶음 머리에 숫자를 붙인다. */}
              <span className="num text-text-dim ml-auto shrink-0 text-[11px]">
                {g.summary.filled}/{g.summary.scheduled}
              </span>
            </div>
            <ul>
              {g.cards.map((card) => {
                const pct = landingCardPct(card);
                const idle = card.totalSlots === 0;
                // 🔴 압축의 대가 — "교시 작성"이라는 **단위**가 행에서 사라졌다. 눈으로는 열 머리가
                // 설명하지만 스크린리더는 행만 읽어 "0/5"가 무엇의 5인지 알 수 없다. 접근성 이름에 되돌린다.
                const srLabel = [
                  card.className,
                  card.delegated ? "위임 받은 반" : null,
                  card.orphanSlots > 0
                    ? `시간표가 바뀌어 지금 시간표에 없는 기록 ${card.orphanSlots}건`
                    : null,
                  `담임 ${card.teacherName ?? "미지정"}`,
                  idle ? "이 주에 배정된 교시 없음" : `작성 교시 ${card.filledSlots}/${card.totalSlots}`,
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <li key={card.classId} className="border-line-faint border-b">
                    <Link
                      href={`/ecs/${card.classId}?week=${weekMonday}`}
                      aria-label={srLabel}
                      // 좁은 화면에선 행을 더 눕히지 않는다 — 한 줄로 줄인 대가로 **손가락이 못 누르는 줄**이
                      // 되면 압축이 아니라 고장이다(1열일 땐 어차피 세로가 남는다). 넓은 화면은 마우스라 7px.
                      className="hover:bg-bg-soft flex items-center gap-2 rounded-lg px-1.5 py-2.5 transition sm:py-[7px]"
                    >
                      <span className="text-foreground min-w-0 flex-1 truncate text-[13px] font-semibold">
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
        ))}
      </div>
    </section>
  );
}
