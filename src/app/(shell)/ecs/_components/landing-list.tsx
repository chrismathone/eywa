import Link from "next/link";
import type { SheetLandingCard } from "@/features/class-sheets/server/queries";
import { groupLandingByTeacher } from "@/features/class-sheets/landing-groups";
import { landingCardPct, summarizeLanding } from "@/features/class-sheets/landing-summary";
import { shoutingCountOf, summarizeShouting } from "@/features/class-sheets/landing-shouting";
import { splitLandingByProgram } from "@/features/class-sheets/landing-programs";
import { TONE_SOFT } from "@/lib/design/semantic-color";

/**
 * 단일 흐름(좌우로 안 가를 때)의 다단 — 2026-08-11부터 쓰던 그대로.
 */
const FULL_COLUMNS = "columns-1 gap-x-5 sm:columns-2 lg:columns-3";
/**
 * 좌우 분단일 때 **한 단 안**의 다단. 단의 폭이 반이라 열 수도 한 칸씩 물러선다.
 *  · ~768px: **1열** — 원장 2026-08-28 *"창 크기 좁으면 1단 상하"*. 두 단이 위아래로 쌓이고 각 단도
 *    한 열이라 화면 전체가 한 줄기다(좁은 창에서 열을 또 쪼개면 이름 자리부터 무너진다).
 *  · 768~1280: 1열 — 여기서부터 단이 좌우로 선다(창을 다 못 넓혀도 "좌 우"가 성립하게). 단 폭이
 *    ~370~490px인데 2열로 쪼개면 반 이름 자리가 60px밖에 안 남아 `중등E_초등 브릿지 C2`가 통째로
 *    잘린다(오른쪽 고정 칸 셋이 ~140px를 먹는다).
 *  · 1280px~: 2열(좌우 합쳐 4열 — 3열이던 예전과 비슷한 밀도라 세로로 길어지지 않는다).
 * 🔴 좁은 폭에 `sm:columns-2`를 다시 넣지 말 것 — 그게 "1단 상하" 지시를 깨는 유일한 손잡이다.
 */
const PANEL_COLUMNS = "columns-1 gap-x-5 xl:columns-2";

/**
 * ECS 주간 랜딩 목록 — **한 장의 시트, 열마다 담임**.
 *
 * 원장 2026-08-11 ①: *"관리자 첫 화면이 너무 정신없음. 이름에 걸맞게 컴팩트한 화면으로."*
 * 실측 42반 × (그림자 카드 4줄)이라 첫 화면이 1,500px를 넘겼다 → 표면 42장을 **패널 1장 + 한 줄짜리 행**으로.
 * 원장 2026-08-11 ②: *"열마다 담임 구분해서 놓자."* → 흐름을 반 이름순 한 줄에서 **담임 묶음**으로 바꿨다.
 * 이 화면을 보는 실제 질문이 *"어느 반이 비었나"*가 아니라 **"누가 안 썼나"**라는 뜻이라, 담임 이름이
 * 42번 반복되던 자리를 묶음 머리 하나로 접고 그 담임 몫의 작성률을 거기에 붙인다.
 * 원장 2026-08-28 ③: *"EiE와 인재원 영어를 분리해서 좌 우로 2단"* → 그 위에 **프로그램 축**을 얹었다.
 * 프로그램은 행을 하나하나 읽어야 알 수 있었는데(약자 반과 `중등E_…` 반이 한 열에 번갈아 섰다), 좌우로
 * 가르면 그 판단이 **자리**로 끝난다. 가르는 기준은 [landing-programs.ts](@/features/class-sheets/landing-programs).
 *
 * 🔴 배치는 grid가 아니라 **CSS 다단(multi-column)** 이다. grid로 묶음을 칸에 넣으면 한 행의 높이가
 *    그 행에서 가장 큰 묶음(전양원 7반)에 맞춰져 작은 묶음(정유진 2반) 아래가 통째로 빈다. 다단은
 *    묶음을 위에서부터 흘려 담아 스스로 균형을 잡는다 — `break-inside-avoid`로 한 담임이 두 열에
 *    걸치는 것만 막으면 된다. **좌우 분단만 grid**다(두 단은 서로 흘러들면 안 되므로 — 그게 분단이다).
 * ⚠️ 한 담임이 두 프로그램을 다 맡으면(이현이) **양쪽 단에 묶음이 하나씩** 생긴다. 각 묶음의 작성률은
 *    그 단 몫만 센다(합치면 옆 단 숫자가 섞여 들어와 "누가 안 썼나"를 프로그램별로 못 읽는다).
 * ⚠️ 행에서 담임 이름을 뺐다 — 묶음 머리가 그 말을 이미 하고 있다(같은 사실을 두 번 적으면 그게 소음이다).
 * ⚠️ 서버 컴포넌트로 둔다 — 상호작용이 링크뿐이라 클라 번들을 늘릴 이유가 없다(반응속도 1순위).
 */
export function EcsLandingList({ cards, weekMonday }: { cards: readonly SheetLandingCard[]; weekMonday: string }) {
  const s = summarizeLanding(cards);
  const shout = summarizeShouting(cards);
  /**
   * 지금 목록에 EiE 반이 **하나라도** 있을 때만 머리 줄에 이 항목을 낸다('인재원 영어'만 보는 중이면
   * Shouting이라는 지표 자체가 없다). 행의 구역은 흐름마다 따로 판정한다 — TeacherGroupFlow 참조.
   */
  const showShouting = shout.classes > 0;
  // 머리 줄의 '담임 N명' — 좌우로 갈라도 **사람 수는 하나**다(양쪽에 걸친 담임을 두 번 세지 않는다).
  const teacherCount = groupLandingByTeacher(cards).length;
  // 한쪽이 비면 null = 나누지 않는다(반쪽을 비워 두면 화면 절반이 낭비다).
  const panels = splitLandingByProgram(cards);
  return (
    <section className="bg-card shadow-card rounded-2xl px-3 py-2.5">
      {/* 머리 = 이 주 전체 작성 상황 한 줄. 카드마다 흩어져 있던 숫자를 한 번만 말한다. */}
      <div className="border-line mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-1 pb-2">
        <h2 className="text-foreground text-[13px] font-bold">
          반 <span className="num">{s.classes}</span>개
        </h2>
        <p className="text-text-dim text-[12px]">
          담임 <span className="num text-foreground font-bold">{teacherCount}</span>명
        </p>
        <p className="text-text-dim text-[12px]">
          교시 작성{" "}
          <span className="num text-foreground font-bold">
            {s.filled}/{s.scheduled}
          </span>{" "}
          <span className="num">({s.pct}%)</span>
        </p>
        {/* Shouting(0230a) — **행의 새 칸이 무엇인지 이름을 붙이는 자리**이기도 하다(행엔 열 머리가 없다). */}
        {showShouting ? (
          <p
            className="text-text-dim text-[12px]"
            title="EiE 반의 이번 주 Shouting 체크 — 분모는 작성률과 같은 '이 주 배정 교시'입니다"
          >
            Shouting{" "}
            <span className="num text-foreground font-bold">
              {shout.checked}/{shout.scheduled}
            </span>{" "}
            <span className="num">({shout.pct}%)</span>
          </p>
        ) : null}
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

      {panels ? (
        <div className="grid grid-cols-1 gap-y-4 md:grid-cols-2 md:gap-x-5">
          {panels.map((p) => {
            const ps = summarizeLanding(p.cards);
            return (
              // 오른쪽 단에만 세로 구분선. **세로선은 행 높이만큼 길어** 가로선과 같은 농도면 훨씬
              // 세게 읽힌다 → 한 단계 옅은 `--line-faint`(표 규약과 같은 이유).
              <section
                key={p.key}
                className={p.key === "injaewon" ? "md:border-line-faint md:border-l md:pl-5" : undefined}
              >
                <div className="border-line mb-2 flex items-baseline gap-1.5 border-b px-1 pb-1.5">
                  {/* 프로그램 라벨은 **알약**으로 — 담임 묶음 머리(굵은 글씨)와 형태로 갈라야
                      크기 경쟁 없이 위계가 선다. 모양은 위 '프로그램' 필터 칩과 같은 어휘. */}
                  <h3 className="border-line-strong text-foreground rounded-pill border px-2 py-0.5 text-[11px] font-bold">
                    {p.label}
                  </h3>
                  <span className="text-text-dim text-[11px]">
                    <span className="num">{ps.classes}</span>반
                  </span>
                  <span className="text-text-dim ml-auto text-[11px]">
                    작성{" "}
                    <span className="num text-foreground font-bold">
                      {ps.filled}/{ps.scheduled}
                    </span>{" "}
                    <span className="num">({ps.pct}%)</span>
                  </span>
                </div>
                {/* 단 안에선 담임이 프로그램 **아래** 층이다 — 제목 층을 실제 구조대로 내린다
                    (스크린리더가 제목으로 훑을 때 두 축이 같은 층이면 포함 관계가 안 보인다). */}
                <TeacherGroupFlow
                  cards={p.cards}
                  weekMonday={weekMonday}
                  columnsClass={PANEL_COLUMNS}
                  headingLevel="h4"
                />
              </section>
            );
          })}
        </div>
      ) : (
        <TeacherGroupFlow cards={cards} weekMonday={weekMonday} columnsClass={FULL_COLUMNS} />
      )}
    </section>
  );
}

/**
 * 담임 묶음 흐름 한 벌 — 단일 목록이든 좌우 한 단이든 **같은 기계**로 그린다(두 벌이면 갈린다).
 */
function TeacherGroupFlow({
  cards,
  weekMonday,
  columnsClass,
  headingLevel = "h3",
}: {
  cards: readonly SheetLandingCard[];
  weekMonday: string;
  columnsClass: string;
  /** 묶음 제목의 층 — 프로그램 단 안이면 h4(그 단의 h3 아래), 단일 목록이면 h3. */
  headingLevel?: "h3" | "h4";
}) {
  const Heading = headingLevel;
  const groups = groupLandingByTeacher(cards);
  /**
   * Shouting 구역을 잡을지는 **이 흐름 안에서만** 판정한다. 좌우로 가르면 인재원 단엔 EiE가 한 반도
   * 없으므로 52px을 비워 둘 이유가 없다(그 폭은 긴 반 이름에 돌아간다). 원장이 말한 열 정렬은
   * *한 목록 안에서* 성립하면 되고, 두 단은 폭도 다른 별개의 목록이다.
   */
  const showShouting = summarizeShouting(cards).classes > 0;
  return (
    <div className={columnsClass}>
      {groups.map((g) => (
        // break-inside-avoid = 한 담임의 반들이 두 열에 쪼개지지 않게(묶음이 열보다 길면 어쩔 수 없이 쪼개진다).
        <section key={g.key} className="mb-3 break-inside-avoid">
          <div className="border-line-strong flex items-baseline gap-1.5 border-b px-1 pb-0.5">
            <Heading
              className={`truncate text-[13px] font-bold ${g.unassigned ? "text-text-dim" : "text-foreground"}`}
            >
              {g.label}
            </Heading>
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
              // EiE만 숫자가 있다(그 외 null = 칸을 비운다). 분모를 넘지 않게 자르는 것도 여기 한 곳.
              const shoutCount = shoutingCountOf(card);
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
                // 화면에서 알약이 말하는 것을 스크린리더에도 되돌린다(행에는 열 머리가 없다).
                shoutCount !== null && !idle ? `Shouting 체크 ${shoutCount}/${card.totalSlots}교시` : null,
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
                    {/* Shouting 구역(0230a) — **폭을 항상 잡는다**(원장 2026-08-28 *"영역 구분해서 열 정렬되서
                        길이에 따라 정렬이 흐트러지지 않게 shouting 구역 따로"*). 알약 길이가 `2/6`이든 `12/12`든
                        오른쪽 정렬이라 뒤따르는 작성률·막대의 자리는 그대로다.
                        🔴 같은 흐름 안에서 숫자가 없는 반(이 주 수업 없음·조회 실패)도 **빈 칸으로 폭은 잡는다** —
                           한 줄만 짧아지면 오른쪽 숫자들이 어긋난다. */}
                    {showShouting ? (
                      <span className="w-[52px] shrink-0 text-right">
                        {shoutCount !== null && !idle ? (
                          <span
                            // 색은 **의미 캐논**(팔레트 v4)에서 고른다 — 전 교시 체크 = positive(green).
                            // 남은 것은 '주의'가 아니라 진행 중이라 색을 안 쓴다(amber는 뜻이 다르다).
                            className={`num rounded-pill border px-1 py-px text-[10.5px] font-bold ${
                              shoutCount === card.totalSlots
                                ? `border-green ${TONE_SOFT.positive}`
                                : shoutCount > 0
                                  ? "border-line-strong text-foreground"
                                  : "border-line text-text-faint"
                            }`}
                            title={`Shouting 체크 ${shoutCount}/${card.totalSlots}교시 (이번 주)`}
                          >
                            {shoutCount}/{card.totalSlots}
                          </span>
                        ) : null}
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
  );
}
