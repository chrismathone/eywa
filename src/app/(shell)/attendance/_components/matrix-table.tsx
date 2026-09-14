import type { AttendanceMatrix, AttendanceStatus } from "@/features/attendance/server/queries";
import type { TeacherMoney } from "@/features/attendance/server/teacher-money";
import {
  DAY_TONE,
  HEAD_ROW_H,
  cellDisplay,
  notMineCell,
  sharedOtherSlots,
  statusTextOf,
} from "@/features/attendance/cell-display";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { cellKey, rowKey } from "@/features/attendance/grid/model";
import { countMarks, sumCounts, type Counted } from "@/features/attendance/grid/totals";
import { ClassGroupBody, CollapseAllButton } from "./class-group";
import { ClassSearchCount, SearchEmptyRow, SearchedRow } from "./search-context";
import { LiveRecords, LiveUnits } from "./live-totals";
import { MatrixRow } from "./matrix-row";
import { MatrixTotalsSummary } from "./totals-row";
// 🔴 이 파일은 **서버 컴포넌트**다(GridProvider의 children으로 렌더된다) — 훅을 쓸 수 없어
//    화면 언어를 페이지가 정해 prop으로 내려보낸다. 라벨은 사전, 상태·뱃지 표기는 각각의 단일 소스.
import { sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";

/**
 * sticky 헤더의 선 — `border-collapse` 표에선 테두리 소유권이 **표**에 있어 sticky 셀만 남고 선은 밀려 사라진다(#71).
 * box-shadow도 병합모드 th에선 불안정 → **셀 자식 가상요소 1px 실선**으로 그린다(셀과 함께 고정).
 * ⚠️ sticky 셀은 그 자체가 positioned라 이게 기준이 된다 — `relative`를 덧붙이면 position이 덮여 sticky가 깨진다.
 */
const HEAD_UNDERLINE =
  "after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-line after:content-['']";
/** 가로 스크롤에도 남아야 하는 세로 divider(좌/우 고정 열의 경계). */
const EDGE_RIGHT = "before:absolute before:inset-y-0 before:right-0 before:w-px before:bg-line before:content-['']";
const EDGE_LEFT = "before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-line before:content-['']";
/**
 * 헤더 z단계 — 본문 셀의 선택 오버레이·채우기 손잡이가 z-20~40을 쓰므로(attendance-cell) 헤더는 **그 위**여야
 * 스크롤로 밀려 들어온 칸이 헤더를 뚫고 나오지 않는다. 좌우까지 고정된 모서리 칸은 한 단계 더 위.
 */
const HEAD_Z = "z-50";
const HEAD_CORNER_Z = "z-[60]";

/**
 * 열 폭 — **고정**이다(px). 자동 폭이면 열 너비가 **내용**에서 나오므로, 반을 접어 그 반의 긴 학교 이름이
 * 사라지는 순간 이름·학교 열이 줄고 표 전체가 출렁인다(원장 지적 2026-08-06: "접을 때마다 열너비가 변경").
 * `table-fixed` + `<colgroup>`으로 폭을 내용에서 떼어내면 접든 펼치든 같은 자리에 선다.
 *
 * ⚠️ 날짜 칸만 폭을 **안 준다**(auto) — 남는 가로 폭을 날짜 칸들이 똑같이 나눠 갖는다. 표에 `minWidth`를
 *    걸어 두므로 아무리 좁아져도 한 칸 30px 아래로는 안 내려간다(좁으면 가로 스크롤).
 * ⚠️ 시수·출석률에 폭을 주는 건 sticky `right-[64px]`이 **출석률 폭과 짝**이기 때문 — 이 값이 늘면 두 열이 겹친다.
 * ⚠️ 폭을 넘는 글자는 잘리고 `title`에 원문이 남는다(`truncate`) — 넓히면 그만큼 날짜 칸이 줄어든다.
 */
// 학교·학년은 압축 표기("경명여중2", school-grade.ts) **한 열** — 두 열이던 것을 합쳐 날짜 칸에 폭을
// 돌려줬다(원장 2026-08-10). 되돌려 나누지 말 것.
// 컴팩트(원장 2026-08-10 "최대한 컴팩트. 날짜열은 현재가 아주 좋으니 건드리지말것") — 날짜 칸은 그대로,
// 고정 열만 조인다. ⚠️ rate(64)는 시수 열의 sticky right-[64px]와 짝이라 함께 고치지 않으면 겹친다.
// ⚠️ 폭은 **타입 스케일 v5(2026-09-08)** 기준 실측이다 — 글자 크기를 바꾸면 이 표도 함께 볼 것.
//    (104/84는 12~13px 시절 값이라 16px에서 이름 4자 + 「반이동」 뱃지가 끊겼다.)
// ⚠️ 2026-09-14: 이름 132 → **148**, 학교 96 → **88**(원장 *"이름이 짤리는건 최악. 학교학년 열너비를
//    줄이던지 이름 너비를 더 주고"*). 같은 날 뱃지를 아랫줄로 내려 첫 줄은 이름이 열을 통째로 쓴다.
//    학교는 압축 표기라 88px에 `대구일중2`(5자 ≈ 70px + 좌우 여백 12px)가 들어간다. 날짜 칸 몫은 4px만 준다.
const COL_W = { name: 148, school: 88, money: 68, units: 40, rate: 64, day: 30 } as const;

/** 표에 쌓이는 한 덩어리 = 한 반. 반별 보기는 1개, 강사 전체 보기는 그 강사의 모든 반. */
export type MatrixGroup = {
  classId: string;
  className: string;
  subjectLabel: string;
  matrix: AttendanceMatrix;
  /**
   * 이 반에서 지금 보고 있는 강사의 역할("교시 담당" 등) — 담임이 아닌 반이 목록에 있는 이유를 밝힌다.
   * null이면 담임 반(종전과 같은 표기).
   */
  roleLabel?: string | null;
  /**
   * 그 달 이 반을 **실제로 한 사람**(`유형숙` / `엄소윤 외 2명`) — 원장 2026-09-07 *"누가 수업했는지 …
   * 라벨 끝에 적어줘"* + *"'수업보고서' 발송한 사람을 적어. 담임말고"*.
   * 🔴 담임이 아니다(담임은 시간 축이 없어 지난 달에도 지금 사람이 나온다). 규칙은
   *    [`class-worker.ts`](@/features/attendance/class-worker) 단일 소스. 근거가 없으면 null(안 적는다).
   */
  workerLabel?: string | null;
  /** 그 이름의 근거 — 보고서(강한 근거) / 출결 기록자(대신 찍혔을 수 있다)를 툴팁이 밝힌다. */
  workerSource?: "report" | "attendance" | null;
  /**
   * "8/10부터 담임" — 그 날짜 **이전 칸이 왜 값에서 빠졌는지** 밝힌다(2026-08-19).
   * 담임은 반 단위 속성이라 시간 축이 없어 인계 전 기록까지 새 담임 표에 잡혔다. 이제 값에서 빼되
   * 빗금으로 남기는데, 표식이 없으면 "왜 8월 초가 비었지"가 된다. null이면 종전과 같은 표기.
   */
  sinceLabel?: string | null;
};

/** 그룹(반)의 집계 — 시수는 급여 계산의 기본 단위라 그룹 헤더에 그대로 노출한다. */
function groupCount(matrix: AttendanceMatrix): Counted {
  return sumCounts(
    matrix.students.map((s) => countMarks(matrix.marks[s.id] ?? {}, matrix.units[s.id] ?? {})),
  );
}

/**
 * 격자 좌표·초기값 — 이동·범위 선택이 **화면에 보이는 순서 그대로**를 따라야 하므로 렌더와 같은 순회로 만든다.
 * ⚠️ `cols`는 보이는 날짜뿐이지만(2주 보기는 14칸) `initial`은 **그 달 전체**를 싣는다 — 합계(시수·출석률)는
 *    보이는 열이 아니라 월 전체 기준이라, 안 보이는 날의 기록도 저장소에 있어야 한다.
 */
export function buildGridSource(
  groups: MatrixGroup[],
  days: AttendanceMatrix["days"],
  /** 화면에 그릴 **정렬된 순서**. 방향키·범위 선택이 이 배열의 인덱스로 움직이므로 렌더와 반드시 같아야 한다. */
  ordered: readonly { classId: string; studentId: string }[],
) {
  const rows = ordered.map((r) => rowKey(r.classId, r.studentId));
  const cols = days.filter((d) => !d.placeholder).map((d) => d.date);
  /** `d` = 수업보고서 파생 칸(출결 행 없음) · `g` = 빗금 칸의 표시 전용 값(합계 밖) — grid/store.ts `GridValue` 주석. */
  const initial: Record<string, { s: string; u: number | null; d?: true; g?: true; p?: number | null }> = {};
  // 하루에 교시가 둘 이상인 칸만(0196a) — 한 칸에 친 숫자가 그날 **몇 건**을 고치는지.
  const slotCounts: Record<string, number> = {};
  /**
   * **이 표에 값이 없고 남의 교시만 있는 칸**(강사 전체 보기의 빗금 칸) — 여기선 입력을 받지 않는다.
   *
   * 🔴 받으면 두 가지가 동시에 터진다: ① 저장은 그날 교시에 가서 남의 기록을 조용히 덮거나 지우는데
   *    (save-targets ①) 화면은 그대로라 **무증상**이고(지금은 서버도 제 몫 행이 없는 이 칸을 거절한다 —
   *    noneOwned. 자리 JJ·랩실 행은 아예 안 건드린다, 원장 2026-09-12), ② 낙관값은 서버 값과 같아질 때만
   *    벗겨지는데(grid/store.ts) 서버는 이 칸을 영원히 비워 두므로 **친 숫자가 새로고침 전까지 시수·
   *    출석률에 남는다**(적대적 리뷰 2026-08-18). 잠그는 대신 사유를 말하고 반별 보기로 보낸다 —
   *    같은 칸이 반별 보기에선 그대로 입력 가능하다(#103: 되돌릴 문을 아예 막지는 않는다).
   */
  // 값 = 막는 사유 — `"seat"`는 자리(JJ·랩실) 기록뿐인 칸(사유 문장이 다르다, 원장 2026-09-12), true는 그 밖.
  const notMine: Record<string, true | "seat"> = {};
  /**
   * 값은 **있지만** 그 날 **다른 선생님 교시**도 함께 있는 칸 → 키 → 함께 바뀌는 교시 수.
   * 잠그지는 않는다(내 교시가 있으니 고칠 권리가 있다). 대신 범위 작업에서 **사정거리를 말해 준다** —
   * 종전엔 칸에 `3`이 떠서 "3건이 접혀 있다"가 보였는데, 지금은 `1`만 보이고 툴바 칩이
   * "칸 = 이 선생님 교시"라고 단언해 **"내 것만 지워진다"는 오해를 화면이 심는다**(적대 리뷰 2026-08-18).
   * 🔴 **자리(JJ·랩실)는 세지 않는다**(원장 2026-09-12) — 강사 보기 저장은 그 행을 안 건드리므로, 세면
   *    "함께 바뀝니다"·지우기 막힘이 거짓말이 된다(`sharedOtherSlots` 단일 소스).
   */
  const alsoWrites: Record<string, number> = {};
  for (const g of groups) {
    for (const s of g.matrix.students) {
      const marks = g.matrix.marks[s.id] ?? {};
      const units = g.matrix.units[s.id] ?? {};
      const slots = g.matrix.slots[s.id] ?? {};
      const derived = g.matrix.derived[s.id] ?? {};
      for (const [date, st] of Object.entries(marks)) {
        const key = cellKey(rowKey(g.classId, s.id), date);
        // 🔴 수업보고서 **파생** 칸은 상태가 보여도 출결 행이 없다(`d`) — 저장하면 서버가 새 행을 만들어 수학 자동
        //    시수를 넣으므로, 격자·팝오버가 이 표식으로 '빈 칸'과 같이 다룬다(grid/optimistic-value `isRecordless`).
        initial[key] = derived[date] ? { s: st, u: units[date] ?? null, d: true } : { s: st, u: units[date] ?? null };
        const n = slots[date]?.length ?? 1;
        if (n > 1) slotCounts[key] = n;
      }
      for (const [date, others] of Object.entries(g.matrix.ghosts[s.id] ?? {})) {
        if (others.length === 0) continue;
        const key = cellKey(rowKey(g.classId, s.id), date);
        // 막는 칸(자리뿐 · 담임 이전 기록 · 값이 파생뿐) — 판정은 `notMineCell` 한 곳(행·격자가 같은 답, 리뷰 2026-09-12).
        const locked = notMineCell({ hasValue: !!marks[date], derivedValue: !!derived[date], others });
        if (locked) {
          notMine[key] = locked === "seatOnly" ? "seat" : true;
          continue;
        }
        // 🔴 빗금 칸(값 없음 + 다른 선생님 교시) — 입력은 그 교시에 **상태만** 옮긴다(원장 2026-09-14 *"그 날의 해당 담당
        //    출석으로 전부 이전"*). 칸 값은 **표시 전용**(`g` — 합계·복사 밖)이라 담당 선생님 표와 이중으로 안 센다.
        //    값은 조회가 같은 판정(`ghostCellKind`)으로 만든다. 값이 없는 칸엔 '함께 바뀜'도 없다.
        if (!marks[date]) {
          const gv = g.matrix.ghostValues?.[s.id]?.[date];
          if (gv) initial[key] = { ...gv, g: true };
          continue;
        }
        // 값이 있는 칸 — 함께 바뀌는 건 다른 선생님 교시뿐(자리 JJ·랩실 행은 저장이 안 건드린다, 원장 2026-09-12).
        const shared = sharedOtherSlots(others).length;
        if (shared > 0) alsoWrites[key] = shared;
      }
    }
  }
  /**
   * 반 → 날짜 → 수학 자동 시수(빈 칸에 숫자 없이 찍으면 서버가 넣는 값, auto-units.ts). 반×날짜 크기라
   * 칸마다 싣지 않는다(강사 전체 보기 수천 칸 × 페이로드 곱 방지).
   */
  const autoUnits: Record<string, Record<string, number>> = {};
  for (const g of groups) {
    if (g.matrix.autoUnits && Object.keys(g.matrix.autoUnits).length > 0) autoUnits[g.classId] = g.matrix.autoUnits;
  }
  return { rows, cols, initial, slotCounts, notMine, alsoWrites, autoUnits };
}

/**
 * 출석부 매트릭스 표 — 반별 보기(그룹 1개)와 강사 전체 보기(그룹 N개)를 **하나의 표**로 그린다.
 * 강사 전체 보기는 반마다 그룹 머리행을 얹고 맨 아래 총합 행을 붙인다(급여 계산용 시수 합).
 */
export function MatrixTable({
  groups,
  days,
  holidays,
  showGroups,
  money,
  moneyNote,
  lockBefore,
  ordered,
  lang = "ko",
}: {
  groups: MatrixGroup[];
  days: AttendanceMatrix["days"];
  /** 정렬된 행 순서(sort-rows.ts). 반별이 아니면 반 머리행 없이 이 순서 그대로 한 덩어리로 그린다. */
  ordered: readonly { classId: string; studentId: string }[];
  /** "YYYY-MM-DD" → 휴일명(학원설정). 헤더는 빨간 날짜 + 툴팁, 본문은 회색(수업 없음). */
  holidays: Record<string, string>;
  /** 반 머리행·총합 행 표시(강사 전체 보기). */
  showGroups: boolean;
  /** 원장 전용 금액 열. null/undefined면 열 자체를 안 그린다(강사는 못 본다). */
  money?: TeacherMoney | null;
  /**
   * 금액 합계 옆 한 줄 주석 — 지금은 "표에 있는 반과 금액에 든 반이 다르다"를 밝히는 데 쓴다
   * (표시 축은 담임 ∪ 교시 담당, 금액 축은 담임뿐). 없으면 아무것도 안 그린다.
   */
  moneyNote?: string | null;
  /** 이 날짜 이전 칸은 강사가 수정 못 함(7일 창). null = 관리자 이상이라 제한 없음. */
  lockBefore?: string | null;
  /**
   * 화면 언어 — 페이지가 판정해 내려준다(이 컴포넌트는 **서버**라 훅을 못 쓴다).
   * 안 주면 한국어 — 앱 전역 규약과 같다(테스트·기존 호출부는 한 글자도 안 바뀐다).
   */
  lang?: SheetLang;
}) {
  // 헤더의 수업요일 하이라이트 = 표에 담긴 반들의 수업요일 합집합(강사 전체 보기는 반마다 다르다).
  const t = (key: Parameters<typeof sheetT>[1]) => sheetT(lang, key);
  const tf = (key: Parameters<typeof sheetTf>[1], vars: Record<string, string | number>) =>
    sheetTf(lang, key, vars);
  const classDows = new Set(groups.flatMap((g) => g.matrix.classDows));
  const colSpan = days.length + 4 + (money ? 2 : 0);
  // 단가(티어) 미지정으로 정산에서 빠진 학생 — 이름 칸 배경으로 행 단위 표시(합계 뱃지만으론 못 찾는다).
  const tierMissingIds = new Set(
    money && money.tierSettlement.status !== "unwired" ? money.tierSettlement.missingTierStudentIds : [],
  );
  // 학생별 단가 티어 라벨(학교·학년 열 아랫줄) — 라벨만이라 금액 비노출. 원장 전용 금액 보기에서만 존재.
  const tierByStudent: Record<string, string> =
    money && money.tierSettlement.status !== "unwired" ? money.tierSettlement.tierByStudent : {};
  const totalCount = sumCounts(groups.map((g) => groupCount(g.matrix)));
  /**
   * 행 키 → 서버 집계 — 클라 합계의 폴백이자 **검색 모수로 다시 세는 재료**(2026-08-20).
   * ⚠️ 격자(GridProvider)가 있으면 격자가 이긴다 — 이건 격자가 없을 때만 탄다(첫 렌더·테스트).
   *    안 넘기면 검색 중 시수가 좁혀지지 않은 값으로 떨어진다(live-totals `serverCount` 주석).
   */
  const countByRow: Record<string, Counted> = {};
  for (const g of groups) {
    for (const s of g.matrix.students) {
      countByRow[rowKey(g.classId, s.id)] = countMarks(g.matrix.marks[s.id] ?? {}, g.matrix.units[s.id] ?? {});
    }
  }
  // 표 최소 폭 = 고정 열 합 + 날짜 칸 최소치. 화면이 이보다 넓으면 남는 폭은 날짜 칸이 나눠 갖는다.
  const tableMinWidth =
    COL_W.name +
    COL_W.school +
    days.length * COL_W.day +
    (money ? COL_W.money * 2 : 0) +
    COL_W.units +
    COL_W.rate;

  return (
    // 격자가 **화면의 유일한 세로 스크롤**이다(scrollY) — 그래야 `thead sticky top-0`이 실제로 붙고
    // 스크롤바도 하나만 생긴다. 높이는 부모(page.tsx의 `min-h-0 flex-1`)가 정해 준다 — 상수·vh 계산 없음.
    <DragScrollArea scrollY className="bg-card shadow-card h-full rounded-2xl">
      <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth: tableMinWidth }}>
        {/* 열 폭의 단일 소스 — 셀의 `w-*`가 아니라 여기가 정한다(table-fixed). 접기와 무관하게 불변. */}
        <colgroup>
          <col style={{ width: COL_W.name }} />
          <col style={{ width: COL_W.school }} />
          {days.map((d) => (
            <col key={d.date} />
          ))}
          {money ? (
            <>
              <col style={{ width: COL_W.money }} />
              <col style={{ width: COL_W.money }} />
            </>
          ) : null}
          <col style={{ width: COL_W.units }} />
          <col style={{ width: COL_W.rate }} />
        </colgroup>
        <thead>
          {/* 높이 고정 — 칸의 scroll-margin-top과 짝을 이룬다(cell-display.ts `HEAD_ROW_H` 주석). */}
          <tr className={HEAD_ROW_H}>
            <th
              className={`bg-bg-soft sticky top-0 left-0 ${HEAD_CORNER_Z} ${HEAD_UNDERLINE} ${EDGE_RIGHT} px-2 py-1 text-center whitespace-nowrap`}
            >
              {/* 반 접기가 있는 보기에서만 — 별도 줄 없이 이름 열 머리에 얹는다. */}
              {showGroups ? <CollapseAllButton classIds={groups.map((g) => g.classId)} /> : null}
              <span className="micro">{t("att.col.name")}</span>
            </th>
            <th
              className={`bg-bg-soft border-line sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} border-r px-1.5 py-1 text-center whitespace-nowrap`}
            >
              <span className="micro">{t("att.col.schoolGrade")}</span>
            </th>
            {days.map((d) => {
              // 그 달에 없는 날 — 빈 여백(번호·요일 없음). 폭은 다른 날 칸과 동일(min-w)로 고정.
              if (d.placeholder) {
                // ⚠️ 불투명이어야 한다(#74) — sticky 헤더가 반투명이면 밑으로 지나가는 학생 행이 비쳐 보인다.
                return (
                  <th
                    key={d.date}
                    className={`bg-bg-soft border-line sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} min-w-[30px] border-r`}
                    aria-hidden
                  />
                );
              }
              const holiday = holidays[d.date];
              const isClassDay = classDows.has(d.dow) && !holiday;
              // 배경 = 오늘 > 수업요일(민트) > 주말·휴일(회색) > 수업 없는 평일(흰색). 본문 셀과 같은 DAY_TONE.
              // 글자색 = 일요일·공휴일이면 빨강(달력 관행).
              // 🔴 휴일은 주말보다 **먼저** 본다(2026-09-07 "셀을 구분") — 뒤에 두면 토요일 휴일이
              //    회색으로 덮여 왜 쉬는지가 사라진다. 본문 셀(cellDisplay)과 **같은 순서**여야 열이 안 어긋난다.
              const bg = d.isToday
                ? "bg-primary"
                : isClassDay
                  ? DAY_TONE.classDay
                  : holiday
                    ? DAY_TONE.holiday
                    : d.isWeekend
                      ? DAY_TONE.weekend
                      : "bg-card";
              const fg = d.isToday
                ? "text-primary-foreground"
                : holiday || d.dow === 0
                  ? "text-danger"
                  : isClassDay
                    ? "text-foreground"
                    : d.isWeekend
                      ? "text-text-dim"
                      : "text-text-faint";
              return (
                <th
                  key={d.date}
                  title={holiday ?? undefined}
                  className={`border-line num sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} min-w-[30px] border-r px-0.5 py-1 text-center text-xs ${bg} ${fg}`}
                >
                  <div className="font-bold">{d.day}</div>
                  <div className="opacity-70">{d.label}</div>
                </th>
              );
            })}
            {money ? (
              <>
                <th
                  className={`bg-bg-soft border-line sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} border-l px-2 py-2 text-right whitespace-nowrap`}
                  title={t("att.col.billedTitle")}
                >
                  <span className="micro">{t("att.col.billed")}</span>
                </th>
                <th className={`bg-bg-soft sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} px-2 py-2 text-center whitespace-nowrap`}>
                  <span className="micro">{t("att.col.paid")}</span>
                </th>
              </>
            ) : null}
            {/* 폰에서는 합계 열의 가로 고정을 푼다 — 이름·우측 합계가 날짜 칸 전체를 덮어 터치할 수 없었다. */}
            {/* 시수 합 — 소비 상태(출석·지각·조퇴·보강) 셀의 배수 합(기본 1). 구 출석부 '합계' 관행. */}
            <th
              className={`bg-bg-soft sticky top-0 sm:right-[64px] ${HEAD_CORNER_Z} ${HEAD_UNDERLINE} ${EDGE_LEFT} w-[40px] min-w-[40px] px-1.5 py-2 text-center whitespace-nowrap`}
            >
              <span className="micro">{t("att.col.units")}</span>
            </th>
            <th
              className={`bg-bg-soft sticky top-0 sm:right-0 ${HEAD_CORNER_Z} ${HEAD_UNDERLINE} w-[64px] min-w-[64px] px-2 py-2 text-center whitespace-nowrap`}
            >
              <span className="micro">{t("att.col.rate")}</span>
            </th>
          </tr>
        </thead>
        {/* 반별이 아닌 정렬(가나다·학년·담임순)은 **반 구분을 없애고** 정렬된 순서 그대로 한 덩어리로.
            행마다 classId를 들고 있어 저장 대상 반은 그대로 유지된다(칸을 쳐도 옳은 반에 기록된다). */}
        {showGroups ? null : (
          <tbody>
            {ordered.map((r) => {
              const g = groups.find((x) => x.classId === r.classId);
              const s = g?.matrix.students.find((x) => x.id === r.studentId);
              if (!g || !s) return null;
              return (
                // 검색에 안 걸린 행은 **안 그린다**(숨김 아님) — 격자 좌표와 같은 규약(search-context.tsx).
                <SearchedRow key={`${g.classId}:${s.id}`} row={rowKey(g.classId, s.id)}>
                  <MatrixRow
                    student={s}
                    classId={g.classId}
                    matrix={g.matrix}
                    days={days}
                    holidays={holidays}
                    money={money ? money.byStudent[s.id] ?? null : undefined}
                    lockBefore={lockBefore}
                    classLabel={g.className}
                    tierMissing={tierMissingIds.has(s.id)}
                    tierLabel={tierByStudent[s.id] ?? null}
                    lang={lang}
                  />
                </SearchedRow>
              );
            })}
          </tbody>
        )}
        {!showGroups ? null : groups.map((g) => {
          const groupRowKeys = g.matrix.students.map((s) => rowKey(g.classId, s.id));
          const rows = g.matrix.students.map((s) => (
            <SearchedRow key={`${g.classId}:${s.id}`} row={rowKey(g.classId, s.id)}>
              <MatrixRow
                student={s}
                classId={g.classId}
                matrix={g.matrix}
                days={days}
                holidays={holidays}
                money={money ? money.byStudent[s.id] ?? null : undefined}
                lockBefore={lockBefore}
                classLabel={g.className}
                tierMissing={tierMissingIds.has(s.id)}
                tierLabel={tierByStudent[s.id] ?? null}
                lang={lang}
              />
            </SearchedRow>
          ));
          return (
            <ClassGroupBody
              key={g.classId}
              classId={g.classId}
              colSpan={colSpan}
              // 검색에 걸린 학생이 하나도 없는 반은 **머리행까지 통째로** 안 그린다.
              rowKeys={groupRowKeys}
              summary={
                <>
                  <span className="text-foreground text-xs font-bold">{g.className}</span>
                  <span className="text-text-faint text-xs">{g.subjectLabel}</span>
                  {g.roleLabel ? (
                    <span
                      className="border-line text-text-dim rounded-full border px-1.5 py-px text-xs"
                      title={t("att.group.slotTitle")}
                    >
                      {g.roleLabel}
                    </span>
                  ) : null}
                  {/* 🔴 **라벨 맨 끝**에 그 달 담당자(원장 지시) — 반 이름·과목·역할 배지 뒤. */}
                  {g.workerLabel ? (
                    <span
                      className="text-text-dim text-xs"
                      title={t(
                        g.workerSource === "attendance"
                          ? "att.group.workerAttendance"
                          : "att.group.workerReport",
                      )}
                    >
                      {g.workerLabel}
                    </span>
                  ) : null}
                  {g.sinceLabel ? (
                    <span
                      className="border-line text-text-dim rounded-full border px-1.5 py-px text-xs"
                      title={t("att.group.sinceTitle")}
                    >
                      {g.sinceLabel}
                    </span>
                  ) : null}
                  <span className="text-text-dim text-xs">
                    {tf("att.group.students", { n: g.matrix.students.length })}
                  </span>
                  {/* 검색 중이면 이 반에서 몇 명이 걸렸는지 — 머리행 인원(전체)만 두면 숫자가 거짓말한다. */}
                  <ClassSearchCount rowKeys={groupRowKeys} />
                  {/* 검색 중이면 `시수 12 / 53`(검색분 / 전체) — 옆의 "검색 N명"과 같은 규약이다.
                      한 머리행에서 인원만 검색 기준이고 시수는 전체이면 그게 제일 나쁘다. */}
                  <span className="text-text-dim num text-xs">
                    {t("att.group.units")}
                    <LiveUnits rows={groupRowKeys} countByRow={countByRow} fallback={groupCount(g.matrix)} />
                  </span>
                </>
              }
            >
              {rows}
            </ClassGroupBody>
          );
        })}
        {/* 결과 0명 — 왜 비었는지 한 줄로(빈 표만 남기면 고장으로 읽힌다). */}
        <SearchEmptyRow colSpan={colSpan} where={t("att.searchEmpty.where")} />
        <tfoot>
          {/* ⚠️ 합계는 **반이 여럿이면 항상** 그린다 — `showGroups`(반 머리행 여부)에 묶으면 가나다·학년·
              담임순으로 바꾸는 순간 시수 총합·정산 안내가 통째로 사라진다(적대 리뷰 2026-08-06). */}
          {groups.length > 1 ? (
            <tr className="bg-bg-soft">
              <td colSpan={colSpan} className="border-line border-t p-0">
                {/* 검색이 걸리면 이 줄의 숫자가 **전부 검색 기준**이 된다(클라 — totals-row.tsx). */}
                <MatrixTotalsSummary
                  classCount={groups.length}
                  fallback={totalCount}
                  countByRow={countByRow}
                  money={money}
                  moneyNote={moneyNote}
                />
              </td>
            </tr>
          ) : null}
          <tr>
            {/* 범례 1행: 좌측 요약 노트 + 우측(ml-auto) 범례 나열(좁으면 가로 스크롤, 줄바꿈 X) */}
            <td colSpan={colSpan} className="bg-bg-soft border-line border-t px-3 py-2">
              <div className="flex items-center gap-2 overflow-x-auto text-xs [&>*]:shrink-0 [&_*]:whitespace-nowrap">
                {/* 조작법을 여기 한 줄로 — 시트처럼 쓰는 화면이라 "클릭해서 고르는 곳"으로 오해하면 느려진다. */}
                {/* ⚠️ 조각 사이 공백은 **사전 값 안에** 담았다 — JSX 줄바꿈은 공백을 지우고,
                    `{" "}`로 넣으면 한국어에 없어야 할 공백이 생긴다(언어마다 붙임이 다르다). */}
                <span className="text-text-faint text-xs">
                  {t("att.help.a")}
                  <LiveRecords countByRow={countByRow} fallback={totalCount} />
                  {t("att.help.b")}
                  <b className="text-text-dim">{t("att.help.number")}</b>
                  {t("att.help.c")}
                  {t("att.help.d")}
                  <b className="text-text-dim">{t("att.help.rightClick")}</b>
                  {" "}
                  {t("att.help.e")}
                </span>
                <span className="micro ml-auto">{t("att.legend")}</span>
                {/* 범례 칩은 셀과 **같은 함수**로 그린다 — 색·숫자가 실제 셀과 어긋날 수 없게. */}
                {(["present", "late", "early_leave", "makeup", "absent"] as AttendanceStatus[]).map((s) => {
                  const chip = cellDisplay(s, null);
                  return (
                    <span key={s} className="text-text-dim inline-flex items-center gap-1">
                      <span
                        className={`inline-flex size-5 items-center justify-center rounded-sm text-xs font-bold ${chip.className}`}
                      >
                        {chip.text}
                      </span>
                      {statusTextOf(s, lang)}
                    </span>
                  );
                })}
                <span className="text-text-dim inline-flex items-center gap-1">
                  <span className={`border-line inline-block size-5 rounded-sm border ${DAY_TONE.classDay}`} />
                  {t("att.legend.classDay")}
                </span>
                <span className="text-text-dim inline-flex items-center gap-1">
                  <span className={`border-line inline-block size-5 rounded-sm border ${DAY_TONE.weekend}`} />
                  {t("att.legend.off")}
                </span>
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </DragScrollArea>
  );
}
