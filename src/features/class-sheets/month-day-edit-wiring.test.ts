import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHEET_DICT } from "@/features/teacher-view/i18n";

/**
 * 구조 가드 — 월간 뷰에서 **그 날짜를 그 자리에서 고치는** 배선이 조용히 갈라지지 않게 잠근다
 * (원장 2026-09-01 *"ecs 월간뷰에서도 더블클릭으로 해당날짜 수정가능하게"*).
 *
 * 잠그는 것 넷:
 *  ① 편집기는 **기존 기계를 재사용**한다 — `SlotPlanBlock` + `ECS_PLAN_API`. 계획 저장 경로를 월간용으로
 *    새로 짜면 같은 표를 서로 다른 규칙(줄 번호·CAS 기대값)으로 쓰게 된다(use-plan-handlers 🔴).
 *  ② 줄은 **월간 조회가 아니라 `getEcsDayPlan`이 다시 읽는다** — 월간 조회는 빈 줄·고아 줄을 걸러서
 *    주므로 그대로 심으면 CAS 기대값이 어긋나 첫 저장이 충돌로 뜬다(day-plan.ts 🔴).
 *  ③ 달력 칸은 **그 자리에서 창만 연다** — 2026-09-01 원장 지시로 "클릭하면 주간으로" 이동을 지웠다
 *    (*"클릭 주간 이동은 기능 삭제할것. 상단에 주간 선택이 있으니 해당 기능으로 대체."*). 이동을
 *    되살리면 첫 클릭이 페이지를 떠나 버려 **더블클릭을 미루는 편법**(타이머)이 함께 돌아온다.
 *  ④ 닫을 때 **저장 큐를 비운 뒤** 다시 읽는다 — 안 비우면 방금 친 글자가 서버에 닿기 전에 옛 값을
 *    다시 그려 "고쳤는데 그대로"가 된다.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

/**
 * 주석 줄을 빼고 **실행되는 줄**만 본다(문서에 적힌 문구가 가드를 속이지 않게).
 * ⚠️ JSX 주석 여는 줄(`{`+`/*`)도 뺀다 — 이 화면 파일들은 "왜 이렇게 했나"를 코드 안에 길게 적어 두는
 *    관례라, 안 빼면 **없앤 것을 설명하는 문장**이 가드에 걸려 헛되이 실패한다(첫 구현이 그랬다).
 */
const code = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("{/*");
    })
    .join("\n");

describe("월간 뷰 · 그 날짜 고치기 배선", () => {
  const editor = code(read("features/class-sheets/components/month-day-editor.tsx"));
  const calendar = code(read("features/class-sheets/components/month-calendar.tsx"));
  const client = code(read("features/class-sheets/components/month-client.tsx"));
  const dayPlan = code(read("features/class-sheets/server/day-plan.ts"));

  it("① 편집기가 기존 계획 기계를 재사용한다(SlotPlanBlock + ECS_PLAN_API)", () => {
    expect(editor).toContain("SlotPlanBlock");
    expect(editor).toContain("ECS_PLAN_API");
  });

  it("① 편집기가 저장 경로를 새로 만들지 않는다(RPC·패치 액션 직접 호출 금지)", () => {
    for (const forbidden of [
      "flushSheetPatches",
      "createPlanLine",
      "movePlanLine",
      "deletePlanLine",
      "copySlotFromPrevious",
      "ecs_copy_slot",
    ]) {
      expect(editor).not.toContain(forbidden);
    }
  });

  it("② 줄은 getEcsDayPlan이 다시 읽는다(월간 조회의 걸러진 목록을 심지 않는다)", () => {
    expect(editor).toContain("getEcsDayPlan");
    // 월간 조회가 만든 걸러진 맵을 편집기에 넘기면 안 된다.
    expect(editor).not.toContain("linesBySlot={");
    expect(editor).toContain("plan.linesBySlot[");
  });

  it("② getEcsDayPlan은 같은 게이트를 통과하고 admin + tenant 필터로 읽는다", () => {
    expect(dayPlan).toContain("requireEcsClassAccess");
    expect(dayPlan).toContain("createAdminClient");
    expect(dayPlan).toContain('.eq("tenant_id"');
    // 🔴 편집기용이므로 **거르지 않는다** — 월간 조회의 필터를 여기로 복사해 오면 ②가 무너진다.
    expect(dayPlan).not.toContain("isMeaningfulPlanLine");
  });

  it("③ 달력 칸은 누르면 그 자리에서 창을 연다", () => {
    expect(calendar).toContain("onClick={() => onOpenDay(date)}");
    // 버튼이라 탭·엔터로도 열린다(링크였을 땐 키보드로 편집 창에 닿을 길이 아예 없었다).
    expect(calendar).toContain('type="button"');
  });

  it("🔴 ③ 칸 버튼에 items-stretch가 있다 — 브라우저 기본값이 flex-start라 속줄이 칸을 안 채운다", () => {
    // 빼면 머리 줄의 `ml-auto`가 죽어 배지가 날짜 옆에 붙고, 교시 구분 점선이 내용 폭까지만 그려진다.
    // `<a>`일 땐 그 기본 스타일이 없어 저절로 stretch였다 → a→button 전환이 만든 회귀였다.
    expect(calendar).toContain("items-stretch");
  });

  it("🔴 ③ 열자마자 날아온 바깥 클릭으로는 안 닫힌다(더블클릭의 두 번째 클릭)", () => {
    // 이 창은 09-01 아침까지 더블클릭 전용이었어서 사람들이 여전히 두 번 누른다. 두 번째 클릭이
    // backdrop에 떨어지면 방금 연 창이 닫히고, 팝업 위면 안 닫혀서 자리에 따라 되기도 안 되기도 한다.
    expect(editor).toContain("OUTSIDE_CLOSE_GRACE_MS");
    // 판정은 추측이 아니라 Base UI가 주는 reason으로 — Esc·닫기 버튼은 안 걸린다.
    expect(editor).toContain('details.reason === "outside-press"');
  });

  it("③ 칸에서 주간으로 새어 나가지 않는다 — 미루기 편법도 함께 사라졌다", () => {
    for (const gone of ["DBLCLICK_MS", "setTimeout", "clearTimeout", "router.push", "<Link", "href="]) {
      expect(calendar).not.toContain(gone);
    }
  });

  it("④ 닫을 때 등록된 flush를 모두 기다린 뒤 다시 읽는다", () => {
    expect(editor).toContain("registerFlush");
    expect(editor).toContain("Promise.all");
    expect(editor).toContain("onSaved");
    expect(client).toContain("router.refresh()");
  });

  it("④ SlotPlanBlock이 registerFlush를 실제로 등록·해제한다", () => {
    const block = code(read("features/class-sheets/components/slot-plan-block.tsx"));
    expect(block).toContain("registerFlush(() => store.flush())");
    expect(block).toContain("registerFlush(null)");
  });

  it("두 보기 모두 같은 창을 연다(달력=칸 클릭 · 진도표=날짜 열 머리)", () => {
    const rail = code(read("features/class-sheets/components/month-rail.tsx"));
    expect(calendar).toContain("onOpenDay");
    expect(rail).toContain("onOpenDay(date)");
    expect(client).toContain("MonthDayEditor");
  });
});

/**
 * 구조 가드 — 주간 이동이 **앱 전역 기간 네비**를 쓴다(원장 2026-09-01 *"주차이동을 월간처럼 깔끔한
 * 스타일로 바꾸자"* — 08-31 *"웹앱내에서 비슷한 곳은 다"*의 연장).
 *
 * 🔴 '이번주' 알약을 되살리지 말 것 — 그 두 가지 일(이번 주로 돌아가기 / 지금 이번 주인가)은
 *    PeriodNav의 **라벨 클릭 + 과거·미래 조회 배지**가 나눠 맡는다.
 */
describe("주간 이동 네비", () => {
  const weekNav = code(read("app/(shell)/timetable/_components/week-nav.tsx"));
  const weekNavClient = code(read("app/(shell)/timetable/_components/week-period-nav.tsx"));
  const toolbar = code(read("features/class-sheets/components/sheet-toolbar.tsx"));

  it("두 주간 네비가 모두 PeriodNav를 쓴다", () => {
    expect(weekNavClient).toContain("PeriodNav");
    expect(weekNav).toContain("WeekPeriodNav");
    expect(toolbar).toContain("<PeriodNav");
  });

  it("손으로 그린 '이번주' 알약이 남아 있지 않다", () => {
    expect(weekNav).not.toContain("이번주");
    expect(toolbar).not.toContain("이번주");
  });

  it("과거/미래 조회 신호(relation)를 넘긴다 — 지난 주를 이번 주로 착각하지 않게", () => {
    expect(weekNav).toContain("weekRelation");
    expect(toolbar).toContain("relation={rel}");
  });

  it("🔴 시간표의 미저장 이탈 가드가 유지된다(옮긴 배치가 말없이 날아가지 않게)", () => {
    expect(weekNavClient).toContain("confirmTimetableNav");
  });

  it("🔴 ECS 시트는 이동 전 저장 flush를 가로챈다", () => {
    expect(toolbar).toContain("onNavigate={onNavigate}");
  });

  it("🔴 가로챈 이동에도 '가는 중'이 보인다(안 보이면 화살표를 두 번 누른다)", () => {
    // 시간표·ECS 랜딩은 `startTransition`이라 Promise가 없다 → PeriodNav에 pending을 직접 넘겨야 한다.
    expect(weekNavClient).toContain("pending={pending}");
    expect(code(read("components/period-nav.tsx"))).toContain("externalPending");
  });
});

/**
 * 구조 가드 — ECS **상단 바가 주간·월간에서 갈리지 않는다**(원장 2026-09-01 *"상단 헤더가 전체적으로
 * 영어 ecs의 경우 월간과 주간 차이가 너무 심함. 일관성있게 디자인 통일할 필요성이 있음."*).
 *
 * 갈렸던 자리는 셋이었다 — 껍데기(주간만 카드) · 반 선택(주간만 노란 표기 + 목록·반 정보 보기) ·
 * 보기 전환(주간은 `[월간]` 버튼 하나, 월간은 3분할). 셋 다 공용 조각으로 합쳤다.
 */
describe("ECS 상단 바 · 주간/월간 통일", () => {
  const toolbar = code(read("features/class-sheets/components/sheet-toolbar.tsx"));
  const month = code(read("features/class-sheets/components/month-client.tsx"));
  const monthPage = code(read("app/(shell)/ecs/[classId]/month/page.tsx"));

  it("두 화면이 같은 껍데기·같은 왼쪽 덩어리·같은 보기 전환을 쓴다", () => {
    for (const src of [toolbar, month]) {
      expect(src).toContain("SHEET_BAR");
      expect(src).toContain("<SheetClassPicker");
      expect(src).toContain("<SheetFaceSwitch");
    }
  });

  it("표기를 화면마다 다시 적지 않는다(노란 반 선택·알약은 공용 한 벌)", () => {
    for (const src of [toolbar, month]) {
      expect(src).not.toContain("MARKER_TRIGGER");
      expect(src).not.toContain("SearchableSelect");
    }
    // 월간의 표시 토글도 주간 알약과 같은 표기를 쓴다(전엔 자기만의 소프트 칩이었다).
    expect(month).toContain("sheetPill(");
  });

  it("🔴 왕복이 기간을 잃지 않는다 — 규칙은 순수 모듈 한 곳(face-nav)", () => {
    // 주간 → 월간: **그 주가 속한 달**(월요일의 달이 아니다 — 2026-08-31 주는 9월이다).
    expect(toolbar).toContain("monthOfWeek(data.weekMonday)");
    // 왔던 주를 주소에 실어 보내고, 월간이 그걸 받아 그 주로 정확히 돌아간다.
    expect(toolbar).toContain("week=${data.weekMonday}");
    expect(monthPage).toContain("readFromWeek(week)");
    expect(month).toContain("weekForMonth({");
    expect(month).toContain("fromWeek,");
    // 🔴 판정을 화면에서 다시 짜지 말 것 — 두 방향이 서로의 역함수여야 왕복이 닫힌다(face-nav.test.ts).
    expect(month).not.toContain("firstClassWeek");
  });

  it("🔴 주간·월간의 같은 라벨 버튼이 같은 일을 한다(보기 선택은 양쪽 다 계정에 남는다)", () => {
    for (const src of [toolbar, month]) expect(src).toContain("setMyEcsMonthView(");
  });

  it("🔴 월간의 보기 선택이 주소에 남고, 주소가 저장값을 덮지 않는다", () => {
    // 주소만 조용히 고친다 — 라우터를 태우면 열려 있는 창·목표 편집 큐가 흔들린다.
    expect(month).toContain("history.replaceState");
    expect(month).not.toContain("router.replace");
    // 🔴 주소를 새로 짓지 않고 **지금 주소를 고친다** — 새로 지으면 week=(왔던 주)와 embed=1(창 표식)이
    //    같이 떨어져 나간다.
    expect(month).toContain("new URL(window.location.href)");
    // 모르는 값은 계정 저장값으로 떨어진다(normalizeEcsMonthView를 쓰면 달력으로 눌러 버린다).
    expect(monthPage).toContain('view === "cal"');
    expect(monthPage).not.toContain("normalizeEcsMonthView");
  });
});

/**
 * 구조 가드 — 좁은 폭에서 **목록·반 정보 보기가 접히되 사라지지는 않는다**
 * (원장 2026-09-01 *"좁은 폭에서 목록/반 정보 보기 접어줘"*).
 *
 * 🔴 접기와 숨기기는 다르다 — '반 정보 보기'는 이 화면에서 그 반으로 가는 **유일한 문**이라,
 *    좁은 폭에서 지우면 폰·좁은 창에선 갈 길이 아예 없어진다(하부탭에만 있던 셔틀 '오늘 등하원'이
 *    폰에서 끊겼던 것과 같은 함정). 그래서 글자만 접고 **아이콘 알약은 남긴다**.
 * 🔴 접히면 보이는 글자가 없어 **접근성 이름이 aria-label에만 남는다** — 그걸 빼면 스크린리더·음성
 *    조작에서 이름 없는 버튼이 된다.
 */
describe("ECS 상단 바 · 좁은 폭에서 접기", () => {
  const chrome = code(read("features/class-sheets/components/sheet-chrome.tsx"));
  // 알약 글자 자리 클래스는 2026-11-05부터 chrome.ts 상수(`SHEET_PILL_GLYPH_*`) — 스켈레톤(sheet-chrome-skeleton.tsx)과 같은 값을 쓰려고
  // 옮겼다(원문 확인처를 옮긴 것이지 없앤 게 아니다). 실물이 그 상수를 쓰는지 + 상수 값을 함께 본다.
  const chromeConsts = code(read("features/class-sheets/chrome.ts"));

  it("글자는 접히고 아이콘이 대신 선다(둘 다 사라지는 폭이 없다)", () => {
    // 아이콘 자리 = 좁은 폭 전용, 글자 자리 = md부터. 한 쌍이라 어느 폭에서도 정확히 하나가 보인다.
    expect(chrome).toContain("className={SHEET_PILL_GLYPH_ICON}");
    expect(chrome).toContain("className={SHEET_PILL_GLYPH_LABEL}");
    expect(chromeConsts).toContain('SHEET_PILL_GLYPH_ICON = "flex h-[18px] items-center md:hidden"');
    expect(chromeConsts).toContain('SHEET_PILL_GLYPH_LABEL = "hidden md:inline"');
    expect(chrome).toContain('<PillGlyph icon="list"');
    expect(chrome).toContain('<PillGlyph icon="info"');
  });

  it("🔴 알약을 통째로 숨기지 않는다 — 접는 것이지 없애는 것이 아니다", () => {
    // 알약 자체에 md 숨김이 붙으면 좁은 폭에서 '반 정보 보기'로 가는 유일한 문이 닫힌다.
    expect(chrome).not.toContain("sheetPill(false)} hidden");
    expect(chrome).not.toContain("hidden md:inline-flex");
  });

  it("🔴 접혔을 때 이름이 남는다(두 알약 다 aria-label)", () => {
    // 2026-09-03 화면 언어(한/영) 전환이 붙으면서 라벨이 사전(`i18n.ts`)에서 온다 — 그래서
    // **문자열이 아니라 배선**을 본다(접근성 이름이 사라지지 않았는지가 이 가드의 뜻이다).
    // 🔴 반 이름은 여전히 호출부가 붙인다 — 다만 2026-09-03부터 **표기가 언어를 따른다**
    //    (`showClass` = [`classNameFor`](@/features/teacher-view/class-name)). 이름이 접근성 이름에서
    //    사라지지 않았는지가 이 가드의 뜻이라, 보간이 남아 있는지를 그 함수 경유로 확인한다.
    expect(chrome).toContain('aria-label={t("chrome.list.aria")}');
    expect(chrome).toContain("ariaLabel={`${showClass(classLabel)} ${t(\"chrome.classInfo.suffix\")}`}");
    // 🔴 표기 함수가 사전이 아니라 **반 이름 규약**을 타는지도 함께 잠근다(화면에서 `lang === "en" ? …`를
    //    직접 적으면 같은 반이 자리마다 다른 이름이 된다).
    expect(chrome).toContain('classNameFor(n, lang)');
    // 🔴 사전 쪽도 함께 잠근다 — 배선만 보면 그 키가 빈 문자열이어도 통과해서, 접힌 알약이
    //    **이름 없는 아이콘**이 되는 것을 이 가드가 놓친다(원문 확인처를 옮긴 것이지 없앤 게 아니다).
    expect(SHEET_DICT["chrome.list.aria"].ko).toBe("반 목록");
    expect(SHEET_DICT["chrome.classInfo.suffix"].ko).toBe("반 정보 보기");
  });

  it("⚠️ 아이콘 자리 높이가 글자 줄상자와 같다 — 접힌 알약만 낮아지지 않게", () => {
    // 12px 글자 × preflight line-height 1.5 = 18px. 이 값을 지우면 옆 요일 알약과 밑줄이 어긋난다.
    expect(chromeConsts).toContain("h-[18px]");
  });

  it("🔴 접기는 공용 조각 한 곳에서만 — 화면마다 라벨을 다시 그리지 않는다", () => {
    // 주간·월간은 `SheetClassPicker`를 그대로 쓴다(상단 바 통일 규약). 화면 파일이 이 두 알약을
    // 스스로 그리기 시작하면 접히는 폭이 화면마다 갈려, 통일 직전 상태로 되돌아간다.
    // ⚠️ 라벨 문자열로 본다 — `md:` 사용 자체를 막으면 이 알약과 무관한 반응형까지 못 쓴다.
    for (const src of [
      code(read("features/class-sheets/components/sheet-toolbar.tsx")),
      code(read("features/class-sheets/components/month-client.tsx")),
    ]) {
      expect(src).not.toContain("반 정보 보기");
      expect(src).not.toContain("PillGlyph");
    }
  });
});
