import Link from "next/link";
import { monthDay } from "@/features/timetable/scheduled-import";
// 반 이름 영문 표기(원장 2026-09-03).
// 🔴 언어를 이 컴포넌트가 **직접 읽지 않는다**(`await getTeacherViewLang()`) — async 서버 컴포넌트가 되면
//    RTL이 렌더할 수 없어 이 파일의 단위 테스트 17개가 통째로 죽는다(실측). 페이지가 이미 들고 있는 값을
//    **prop으로 받는다**. 기본값은 `ko`(= 표기 불변)라 안 넘겨도 화면이 깨지지 않고, 페이지가 넘기는지는
//    가드(`name-wiring`)가 잠근다.
import { sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";
import { classNameFor } from "@/features/teacher-view/class-name";
import type { SheetLandingCard } from "@/features/class-sheets/server/queries";
import { groupLandingByTeacher } from "@/features/class-sheets/landing-groups";
import { groupLandingByMyRole, MY_ROLE_LABEL } from "@/features/class-sheets/landing-my-role";
import { applyTodayOrder } from "@/features/class-sheets/today-order";
import { LandingOrderRows } from "@/features/class-sheets/components/landing-order-rows";
import { landingCardPct } from "@/features/class-sheets/landing-summary";
import { shoutingCountOf, summarizeShouting } from "@/features/class-sheets/landing-shouting";
import { splitLandingByProgram } from "@/features/class-sheets/landing-programs";
import { monthOfWeek } from "@/features/class-sheets/face-nav";
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
export function EcsLandingList({
  cards,
  weekMonday,
  lang = "ko",
  viewerTeacherId = null,
  viewerName = null,
  landingOrder = [],
  canReorder = false,
}: {
  cards: readonly SheetLandingCard[];
  weekMonday: string;
  /** 화면 언어 — 반 이름 표기를 정한다(페이지가 `getTeacherViewLang()`으로 읽어 넘긴다). */
  lang?: SheetLang;
  /**
   * **보고 있는 사람이 강사 본인이면** 그 강사 id — 목록의 축이 담임(남의 이름)에서
   * **담임/부담임(내 역할)**으로 바뀐다([`landing-my-role`](@/features/class-sheets/landing-my-role)).
   * 사무실(스코프 없음)이면 null이라 종전 담임별 묶음 그대로다.
   */
  viewerTeacherId?: string | null;
  /** 머리 줄에 적을 내 이름(영어 화면이면 영어 이름). 없으면 종전처럼 '담임 N명'. */
  viewerName?: string | null;
  /** 내가 손으로 정한 목록 순서(계정 귀속) — 묶음 **안에서만** 적용된다. */
  landingOrder?: readonly string[];
  /**
   * 순서를 바꿀 수 있나 — **'다른 강사 뷰'(열람 전용)에서는 false**(원장 2026-09-05
   * *"어차피 다른 강사 뷰는 읽음 전용이니까 드래그기능을 넣어주면 안되는 부분"*).
   */
  canReorder?: boolean;
}) {

  // 한쪽이 비면 null = 나누지 않는다(반쪽을 비워 두면 화면 절반이 낭비다).
  const panels = splitLandingByProgram(cards);
  return (
    <section className="bg-card shadow-card rounded-2xl px-3 py-2.5">
      {/* 🔴 요약 줄(반 N개·담임 N명·교시 작성·Shouting·미작성·완료)은 **걷었다**(원장 2026-09-09 캡처
          *"이것도 제거"*) — 같은 숫자를 아래 단 머리·담임 줄·행이 이미 말하고 있었다.
          ⚠️ **강사 본인 화면의 이름은 남긴다** — 원장 2026-09-05 *"'추민아'를 아래 '담임'보다 글씨 크기 20%
             키워줘"*로 못박은 자리다(요약을 걷는 것과 이름을 지우는 것은 다른 일이다). */}
      {viewerName ? (
        <div className="border-line mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-1 pb-2">
          <h2 className="text-foreground text-lg font-extrabold">{viewerName}</h2>
        </div>
      ) : null}

      {panels ? (
        <div className="grid grid-cols-1 gap-y-4 md:grid-cols-2 md:gap-x-5">
          {panels.map((p) => {
            return (
              // 오른쪽 단에만 세로 구분선. **세로선은 행 높이만큼 길어** 가로선과 같은 농도면 훨씬
              // 세게 읽힌다 → 한 단계 옅은 `--line-faint`(표 규약과 같은 이유).
              <section
                key={p.key}
                className={p.key === "injaewon" ? "md:border-line-faint md:border-l md:pl-5" : undefined}
              >
                <div className="border-line mb-2 flex items-baseline gap-1.5 border-b px-1 pb-1.5">
                  {/* 프로그램 라벨은 **알약**으로 — 담임 묶음 머리와 형태로 갈라야 크기 경쟁 없이
                      위계가 선다. 모양은 위 '프로그램' 필터 칩과 같은 어휘.
                      원장 2026-08-28 *"EiE 및 선생님 이름은 폰트를 더 크게하고 강조 처리"* → 이 단의
                      **간판**이라 목록에서 가장 큰 글씨(16px·800)에 브랜드색을 입힌다. 🔴 채우기는
                      `-soft`(연한 틴트)까지다 — 꽉 찬 네이비는 위 활성 필터 칩과 같은 모양이라
                      "눌러서 고르는 것"으로 읽힌다(이건 라벨이지 버튼이 아니다). */}
                  <h3 className="border-primary bg-primary-soft text-primary rounded-pill border px-2.5 py-0.5 text-lg font-extrabold">
                    {p.label}
                  </h3>
                  {/* 🔴 반 개수·단 작성률은 걷었다(원장 2026-09-09 *"반개수도 제거"* · *"선생님 총 작성비율은
                      필요없고 행제목으로 대체"*). 열 제목은 **담임 줄 위**에 붙는다(아래 TeacherGroupFlow) —
                      단 머리에 두면 제목과 숫자가 화면 위아래로 멀어진다(원장 시안 비교 2026-09-09). */}
                </div>
                {/* 단 안에선 담임이 프로그램 **아래** 층이다 — 제목 층을 실제 구조대로 내린다
                    (스크린리더가 제목으로 훑을 때 두 축이 같은 층이면 포함 관계가 안 보인다). */}
                <TeacherGroupFlow
                  cards={p.cards}
                  weekMonday={weekMonday}
                  columnsClass={PANEL_COLUMNS}
                  lang={lang}
                  headingLevel="h4"
                  viewerTeacherId={viewerTeacherId}
                  landingOrder={landingOrder}
                  canReorder={canReorder}
                />
              </section>
            );
          })}
        </div>
      ) : (
        // ⚠️ 좌우로 안 가르는 흐름(한 프로그램만 있을 때)도 **같은 축**으로 묶어야 한다 —
        //    한쪽만 배선하면 EiE가 0개인 강사에게만 옛 담임별 묶음이 남는다(2026-09-05 실제로 그랬다).
        <TeacherGroupFlow
          cards={cards}
          weekMonday={weekMonday}
          columnsClass={FULL_COLUMNS}
          lang={lang}
          viewerTeacherId={viewerTeacherId}
          landingOrder={landingOrder}
          canReorder={canReorder}
        />
      )}
    </section>
  );
}

/**
 * 목록 오른쪽 숫자 열의 **제목**(원장 2026-09-09: *"이게 샤우팅과 작성률이잖아. 상단 행제목 추가."*
 * + *"우측 인재원 영어도 마찬가지"*).
 *
 * 🔴 폭은 행이 쓰는 값과 **같은 상수**를 본다 — 따로 적으면 제목이 숫자 위에서 어긋난다.
 *    (Shouting 52px · 작성 44px(w-11) · 막대 40px(w-10) · 사이 gap-2 8px, 행 오른쪽 여백 px-1.5.)
 * ⚠️ Shouting 구역이 없는 흐름(인재원 영어)에선 '샤우팅' 제목도 안 세운다 — 빈 칸에 이름만 남으면 "여긴 왜 비었나"가 된다.
 * ⚠️ '주간'을 붙인 이유(원장 2026-09-09 *"작성률 → 주간 작성률"*): 이 숫자의 분모는 **이 주 배정 교시**라,
 *    그냥 '작성률'이면 달 전체나 누적으로 읽힌다.
 * ⚠️ 행 끝엔 '달력' 배지가 하나 더 붙는다(두 단 모두) — 제목 줄에도 **보이지 않는 같은 크기**를 둬서 줄을 맞춘다.
 */
function LandingColumnTitles({ showShouting, lang }: { showShouting: boolean; lang: SheetLang }) {
  return (
    // 🔴 **행의 꼬리 구조를 그대로 본뜬다** — 안쪽 묶음(gap-2 + 오른쪽 여백)이 행 링크의 꼬리이고, '달력'
    //    배지는 그 **밖에서** `ml-1`로 붙는다. 한 겹으로 뭉치면 gap이 한 번 더 끼어 12px씩 왼쪽으로 쏠린다
    //    (원장 2026-09-09 *"열정렬 제대로 해. 한쪽으로 쏠리지 않게"* — 실측으로 어긋난 값이 딱 그만큼이었다).
    // 🔴 '주간 작성률'은 **숫자 + 막대 두 칸에 걸친다**(44+8+40=92px) — 라벨이 숫자 칸(44px)보다 넓어서
    //    그 칸에만 맞추면 왼쪽으로 흘러 '샤우팅'과 겹친다. 숫자와 막대는 어차피 같은 지표라 한 제목이 맞다.
    // ⚠️ `-mr-1`은 담임 줄 자체의 좌우 여백(px-1)을 되돌린다 — 행은 그 여백 **밖까지** 뻗어 있어서,
    //    상쇄하지 않으면 제목이 통째로 4px 왼쪽으로 쏠린다(실측값이 정확히 그만큼이었다).
    <span className="text-text-faint -mr-1 ml-auto flex shrink-0 items-center text-xs font-bold">
      <span className="flex items-center gap-2 pr-1.5">
        {showShouting ? (
          <span className="w-[52px] text-right">{sheetT(lang, "landing.col.shouting")}</span>
        ) : null}
        <span className="w-[92px] text-right whitespace-nowrap">{sheetT(lang, "landing.col.rate")}</span>
      </span>
      {/* 행 끝의 '달력' 배지 자리 — 보이지 않는 같은 크기로 줄을 맞춘다.
          ⚠️ 배지가 **두 단 모두**에 붙으므로(2026-09-09) 이 자리도 흐름과 무관하게 항상 잡는다 —
             `showShouting`에 매달면 인재원 영어 단만 제목이 배지 폭만큼 오른쪽으로 쏠린다.
          🔴 글자도 **배지와 같은 사전 값**을 쓴다(빈 칸이 아니라 같은 글자) — 영어 화면에서 배지만
             `Calendar`가 되면 이 자리가 그만큼 좁아져 제목 줄이 어긋난다. `face.cal`·`face.mp`는
             두 언어 모두 같은 글자라 어느 쪽을 써도 폭이 같다. */}
      <span aria-hidden className="invisible ml-1 rounded-full border px-1.5 py-px text-xs font-bold">
        {sheetT(lang, "face.cal")}
      </span>
    </span>
  );
}

/**
 * 담임 묶음 흐름 한 벌 — 단일 목록이든 좌우 한 단이든 **같은 기계**로 그린다(두 벌이면 갈린다).
 */
function TeacherGroupFlow({
  cards,
  weekMonday,
  columnsClass,
  lang,
  headingLevel = "h3",
  viewerTeacherId = null,
  landingOrder = [],
  canReorder = false,
}: {
  cards: readonly SheetLandingCard[];
  weekMonday: string;
  columnsClass: string;
  /** 화면 언어 — 반 이름 표기를 정한다(부모가 서버에서 읽어 넘긴다). */
  lang: SheetLang;
  /** 묶음 제목의 층 — 프로그램 단 안이면 h4(그 단의 h3 아래), 단일 목록이면 h3. */
  headingLevel?: "h3" | "h4";
  /** 강사 본인 화면이면 그 id — 묶음 축이 담임에서 **내 역할**로 바뀐다. */
  viewerTeacherId?: string | null;
  /** 내가 정한 목록 순서 — 묶음 **안에서만** 얹는다(묶음을 넘나드는 이동은 없다). */
  landingOrder?: readonly string[];
  /** 순서 바꾸기 허용('다른 강사 뷰'는 열람 전용이라 false). */
  canReorder?: boolean;
}) {
  const Heading = headingLevel;
  /**
   * 축이 둘이고 **보는 사람이 정한다**:
   *  · 사무실 = 담임별(그 화면의 질문이 "누가 안 썼나"라서).
   *  · 강사 본인 = **담임 / 부담임**(내 화면인데 남의 이름으로 묶이면 내 반이 어디 있는지 안 보인다).
   * 🔴 라벨은 사전 키를 그대로 — 영어 화면에서 `Homeroom`/`Assistant`로 따라온다.
   */
  const groups = viewerTeacherId
    ? groupLandingByMyRole(cards, viewerTeacherId).map((g) => ({
        key: g.key,
        label: sheetT(lang, MY_ROLE_LABEL[g.key]),
        unassigned: false,
        cards: g.cards,
        summary: g.summary,
      }))
    : groupLandingByTeacher(cards);
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
            {/* 담임 이름 = 이 화면의 두 번째 축(원장 2026-08-28 *"선생님 이름은 폰트를 더 크게하고
                강조 처리"*) — 15px·800으로 올린다. 프로그램 알약(16px)보다 한 단계 작아야 포함 관계가
                크기로도 읽힌다. 🔴 다시 13px로 줄이지 말 것. '담임 미지정'만 색을 죽인다(사람이 아니라 상태). */}
            <Heading
              className={`truncate text-base font-extrabold ${g.unassigned ? "text-text-dim" : "text-foreground"}`}
            >
              {g.label}
            </Heading>
            <span className="text-text-dim num shrink-0 text-xs">
              {sheetTf(lang, "landing.group.nClasses", { n: String(g.summary.classes) })}
            </span>
            {/* 열 제목은 **담임 줄 위**(원장 2026-09-09 시안 비교) — 제목과 숫자가 한 눈에 붙어 있어야
                `0/6`이 무엇인지 바로 읽힌다. 흐름 안 모든 묶음이 같은 폭을 쓰므로 줄이 어긋나지 않는다. */}
            <LandingColumnTitles showShouting={showShouting} lang={lang} />
            {/* 🔴 담임 몫 작성률은 뺐다(원장 2026-09-09 *"선생님 총 작성비율은 필요없고 행제목으로 대체"*) —
                그 자리는 위 단 머리의 **열 제목**이 쓴다. 반별 숫자는 아래 행에 그대로 있다. */}
          </div>
          {/* 🔴 순서는 **묶음 안에서만** 바뀐다 — 담임/부담임(과 EiE/인재원)은 취향이 아니라 사실이라
              칸을 넘나들면 화면이 거짓말을 한다. `SortableContext`가 묶음마다 하나라 구조로 막힌다. */}
          <LandingOrderRows
            // 🔴 주·필터가 바뀌면 **다시 만든다** — 안 그러면 클라가 들고 있던 옛 순서가 새 목록을
            //    덮어써, 서버가 준 저장 순서 대신 지난 주 배열이 남는다(오늘 면의 `key={res.date}`와 같은 이유).
            key={`${g.key}:${weekMonday}`}
            canReorder={canReorder}
            items={applyTodayOrder(g.cards, landingOrder).map((card) => {
              const pct = landingCardPct(card);
              const idle = card.totalSlots === 0;
              /**
               * 🔴 배정이 0인 것과 **휴일뿐인 것**은 다른 사실이다 — 한 문구로 뭉치면 추석 주에
               *    "이 주에 배정된 교시 없음"이 뜬다(수업일은 멀쩡히 있는데 쓸 의무가 없는 것뿐이다).
               *    표기는 작성률 규약과 같은 글자 "휴"([`writing-rate`](src/features/report-admin/writing-rate.ts)).
               * ⚠️ 반은 그대로 목록에 남는다 — 휴일은 반을 지우는 값이 아니다([[holiday.ts]]).
               */
              const holidayOnly = idle && card.holidaySlots > 0;
              const idleTitle = holidayOnly
                ? sheetT(lang, "landing.idle.holiday")
                : sheetT(lang, "landing.idle.none");
              // EiE만 숫자가 있다(그 외 null = 칸을 비운다). 분모를 넘지 않게 자르는 것도 여기 한 곳.
              const shoutCount = shoutingCountOf(card);
              // 🔴 이 카드에서 반 이름이 나오는 자리 넷(제목·예고 문구·접근성 이름·MP 링크)이
              //    **같은 값**을 봐야 한다 — 한 곳만 원문이면 같은 반이 두 이름으로 읽힌다.
              const shownName = classNameFor(card.className, lang);
              // 예약된 개명 **예고** 문구 — 한 곳에서만 만든다. 아래 배지 title과 접근성 이름이 같은 말을
              // 해야 하는데 따로 적으면 한쪽만 고쳐진다(배지는 10px라 문구가 곧 설명 전부다).
              // 🔴 **이미 지나간 개명은 아무 말도 하지 않는다**(원장 2026-08-31: *"반이름 변경된 반에
              //    '개명'이라고 남는데 필요없어 그냥 날짜 지나면 반이름 변경되었으면 됨"*). 그 주 이름을
              //    그대로 부르는 것이 곧 답이라, 표식은 앞으로 올 변경(upcoming)에만 남긴다.
              const renameNote = card.classNameUpcoming
                ? sheetTf(lang, "landing.rename.note", {
                    date: monthDay(card.classNameUpcoming.date),
                    from: shownName,
                    to: classNameFor(card.classNameUpcoming.name, lang),
                  })
                : null;
              // 🔴 압축의 대가 — "교시 작성"이라는 **단위**가 행에서 사라졌다. 눈으로는 열 머리가
              // 설명하지만 스크린리더는 행만 읽어 "0/5"가 무엇의 5인지 알 수 없다. 접근성 이름에 되돌린다.
              const srLabel = [
                shownName,
                renameNote,
                card.delegated ? sheetT(lang, "landing.sr.delegated") : null,
                sheetTf(lang, "landing.sr.homeroom", {
                  name: card.teacherName ?? sheetT(lang, "landing.sr.unassigned"),
                }),
                idle
                  ? idleTitle
                  : sheetTf(lang, "landing.sr.fill", {
                      done: String(card.filledSlots),
                      total: String(card.totalSlots),
                    }),
                shoutCount !== null && !idle
                  ? sheetTf(lang, "landing.shouting.sr", {
                      n: String(shoutCount),
                      total: String(card.totalSlots),
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(", ");
              return {
                id: card.classId,
                node: (
                  <>
                  <Link
                    href={`/ecs/${card.classId}?week=${weekMonday}`}
                    aria-label={srLabel}
                    // 좁은 화면에선 행을 더 눕히지 않는다 — 한 줄로 줄인 대가로 **손가락이 못 누르는 줄**이
                    // 되면 압축이 아니라 고장이다(1열일 땐 어차피 세로가 남는다). 넓은 화면은 마우스라 7px.
                    className="hover:bg-bg-soft flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-2.5 transition sm:py-[7px]"
                  >
                    <span className="text-foreground min-w-0 flex-1 truncate text-sm font-semibold">
                      {shownName}
                    </span>
                    {/* 예약된 반 이름 변경 **예고**만 표시한다(원장 2026-08-29 *"미래조회시에 지금 반으로
                        보면 착각할 수 있을거같은데"* → 2026-08-31 *"날짜 지나면 반이름 변경되었으면 됨"*).
                        · upcoming = 앞으로 바뀐다 → 언제 무엇이 되는지 예고(앰버 = 주의)
                        · 🔴 이미 바뀐 반엔 **아무 표식도 붙이지 않는다** — 그 주 이름이 이미 새 이름이라
                          '개명' 두 글자는 알려 주는 것 없이 44줄을 어지럽혔다(2026-08-31 제거).
                        🔴 예고는 **예약된 때부터 그날까지 내내** 붙는다(원장 2026-08-29 후속) — 전환 주에만
                           붙이면 그때 그 반은 이미 남의 반이라 **옛 담임 화면엔 안 뜬다**. 판정은
                           [`classNameForWeek`](src/features/classes/class-name-as-of.ts) 단일 소스.
                        ⚠️ 칸이 좁아 이름 옆엔 짧게만 두고 전문은 title로(문구는 여기서만 만든다). */}
                    {card.classNameUpcoming ? (
                      <span
                        className="border-amber bg-amber-soft text-amber shrink-0 rounded-pill border px-1 py-px text-xs font-bold"
                        title={renameNote ?? undefined}
                      >
                        {monthDay(card.classNameUpcoming.date)}→{classNameFor(card.classNameUpcoming.name, lang)}
                      </span>
                    ) : null}
                    {/* 임시 위임(0173a) — 원스크린 반 칩과 같은 앰버 규약. 남의 반 시트를 내 반인 줄 알고
                        고치는 일이 없게, 목록에서부터 갈라 보인다(원장 지시 2026-08-03). */}
                    {card.delegated ? (
                      <span className="border-amber bg-amber-soft text-amber shrink-0 rounded-pill border px-1 py-px text-xs font-bold">
                        {sheetT(lang, "today.chip.delegated")}
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
                            className={`num rounded-pill border px-1 py-px text-xs font-bold ${
                              shoutCount === card.totalSlots
                                ? `border-green ${TONE_SOFT.positive}`
                                : shoutCount > 0
                                  ? "border-line-strong text-foreground"
                                  : "border-line text-text-faint"
                            }`}
                            title={sheetTf(lang, "landing.shouting.title", {
                              n: String(shoutCount),
                              total: String(card.totalSlots),
                            })}
                          >
                            {shoutCount}/{card.totalSlots}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                    {idle ? (
                      <span className="text-text-dim w-11 shrink-0 text-right text-xs" title={idleTitle}>
                        {holidayOnly ? sheetT(lang, "landing.holidayMark") : "—"}
                      </span>
                    ) : (
                      <span className="num text-foreground w-11 shrink-0 text-right text-xs font-bold">
                        {card.filledSlots}/{card.totalSlots}
                      </span>
                    )}
                    <span className="bg-bg-soft h-1.5 w-10 shrink-0 overflow-hidden rounded-full">
                      <span className="bg-primary block h-full rounded-full" style={{ width: `${pct}%` }} />
                    </span>
                  </Link>
                  {/* 달력 진입로 — 🔴 **여기 없으면 주소를 아는 사람만 쓴다**(MCS에서 수학만 맡은
                      강사 9명에게 링크가 0개였던 것과 같은 구멍). 여는 달은 주간 시트의 '달력' 버튼과
                      **같은 규칙**([monthOfWeek](@/features/class-sheets/face-nav))이다.
                      🔴 **두 프로그램 모두에 붙는다**(원장 2026-09-09 *"인재원 영어에도 '월간' 바로가기해"*
                         → *"달력 으로 바로가면 되잖아. 월간 -> 달력으로 이름 변경하자. 전부"*). 여는 면은
                         그 반이 실제로 가진 달력이다 — EiE는 월간 계획서(`mp`), 인재원 영어는 달력(`cal`).
                         이름을 하나로 맞춘 이유: 두 면은 같은 자리에 서지 않으므로 강사에겐 '이 반의 달력'
                         하나로 읽힌다(`SHEET_FACE_LABEL`도 둘 다 '달력'이다).
                      🔴 `<a>` 안에 `<a>`를 넣을 수 없어 행 링크의 **형제**로 둔다(행 전체는 여전히 주간). */}
                  <Link
                    href={`/ecs/${card.classId}/month?month=${monthOfWeek(weekMonday)}&week=${weekMonday}&view=${card.englishTrack === "eie" ? "mp" : "cal"}`}
                    title={sheetTf(lang, "landing.calendarLink", { name: shownName })}
                    aria-label={sheetTf(lang, "landing.calendarLink", { name: shownName })}
                    className="border-line-strong text-text-dim hover:bg-bg-soft hover:text-foreground ml-1 shrink-0 rounded-full border px-1.5 py-px text-xs font-bold transition"
                  >
                    {sheetT(lang, card.englishTrack === "eie" ? "face.mp" : "face.cal")}
                  </Link>
                  </>
                ),
              };
            })}
          />
        </section>
      ))}
    </div>
  );
}
