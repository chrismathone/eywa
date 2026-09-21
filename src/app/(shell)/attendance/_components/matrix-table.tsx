import type { AttendanceMatrix } from "@/features/attendance/server/queries";
import type { TeacherMoney } from "@/features/attendance/server/teacher-money";
import {
  DAY_TONE,
  HEAD_ROW_H,
  TODAY_HEAD,
  notMineCell,
  type NotMineReason,
} from "@/features/attendance/cell-display";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { cellKey, rowKey } from "@/features/attendance/grid/model";
import type { AttendanceUnitSuffix } from "@/features/attendance/unit-suffix";
import { attendanceSalaryRate, type AttendanceSalaryRates } from "@/features/attendance/salary-rates";
import type { ReactNode } from "react";
import { suppressedTransferRows, transferRowKey } from "@/features/attendance/transfer-badge";
import { countMarks, sumCounts, type Counted } from "@/features/attendance/grid/totals";
import type { AttendanceConfirmedPrice, AttendanceInvoiceGap, AttendanceTermSessions } from "@/features/attendance/class-billing";
import { ClassGroupBody, CollapseAllButton } from "./class-group";
import { ClassSearchCount, SearchEmptyRow, SearchedRow } from "./search-context";
import { LiveRecords, MatrixColumnTotalsRow } from "./live-totals";
import { columnTotals } from "@/features/attendance/grid/column-totals";
import { MatrixRow } from "./matrix-row";
import { hasNoLessonDays, noLessonZeroView } from "@/features/attendance/no-lesson-row";
import { MatrixTotalsSummary } from "./totals-row";
import { StickyFitRow } from "./sticky-fit-row";
import { AttendanceColumns, AttendanceColSpan, type AttendanceColumn } from "./columns";
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
 *    걸어 두므로 아무리 좁아져도 한 칸 28px 아래로는 안 내려간다(좁으면 가로 스크롤).
 * ⚠️ 출석률(맨 오른쪽)에 폭을 주는 건 `sm:right-0` sticky라서다. 2026-09-17에 시수를 청구액 옆으로 옮기면서
 *    옛 짝(`right-[64px]`)은 **사라졌다** — 되살리면 두 열이 겹친다(가드가 그 클래스가 없음을 잠근다).
 * ⚠️ 폭을 넘는 글자는 잘리고 `title`에 원문이 남는다(`truncate`) — 넓히면 그만큼 날짜 칸이 줄어든다.
 */
// 학교·학년은 압축 표기("경명여중2", school-grade.ts) **한 열** — 두 열이던 것을 합쳐 날짜 칸에 폭을
// 돌려줬다(원장 2026-08-10). 되돌려 나누지 말 것.
// ⚠️ 폭은 **타입 스케일 v5(2026-09-08)** 기준 실측이다 — 글자 크기를 바꾸면 이 표도 함께 볼 것.
//    (104/84는 12~13px 시절 값이라 16px에서 이름 4자 + 「반이동」 뱃지가 끊겼다.)
// 이름은 148px을 유지하고 뱃지는 아랫줄에 둔다. 학교·학년은 압축 표기와 원문 툴팁을 사용한다.
// 2026-09-18: 이름 148→**96**(원장 *"이름 열을 너비 줄일것"*) — 생애주기 표식(신입·반이동·종강)이 이름 칸을 떠나
//   **수강 기간 양옆 회색 날짜 칸**으로 갔다(`badge-placement.ts`). 이름 칸에 남은 건 이름·등원 요일·「단가」뿐이다.
//   🔴 표식을 이름 칸으로 되돌리면 이 폭으론 이름이 잘린다(그래서 148이었다).
// 2026-09-17: 학교 88→80, 날짜 최소 30→28로 줄여 학교 오른쪽 청구액 열을 마련한다.
// 2026-09-17: 맨 오른쪽 학생 총액 '청구·납입' 두 열은 없앴다(원장 *"이미 학교학년 옆에 청구액이 배정되어있으므로 의미없음"*) —
//   합계 줄의 청구·납입 합과 정산액은 그대로다(같은 `money` 조회). 🔴 되살리지 말 것.
// 2026-09-17(2): 오른쪽 sticky였던 '시수'를 **청구액 옆**으로 옮기고 이름을 '수업 차수'로, 그 옆에 '등록 차수'
//   (회차 확정의 확정 시수)를 더했다(원장 *"우측 시수를 청구액 우측으로 이동. 수업 차수로 이름 변경"* ·
//   *"그 옆에 등록 차수 열 추가하고. 그걸 회차 확정에서 확정된 시수로"*). 오른쪽 고정은 이제 출석률 하나뿐이라
//   `right-[64px]` 짝이 사라졌다.
// 2026-09-18: 원장 *"열 너비 최대한 압축. 그렇다고 자동으로 늘어나게는 하지말고 고정된 최대한 압축"* —
//   학교 80→72 · 청구액/수업 차수/등록 차수 88→76으로 줄이고, 그 자리에 **차이확인**(64) 열을 더했다.
//   🔴 `auto`로 바꾸지 말 것 — 폭이 내용에서 나오면 반을 접을 때마다 표가 출렁인다(위 문단, 원장 2026-08-06).
// ⚠️ 이 폭은 **머리 글자**가 정한다(`th`엔 말줄임이 없어 넘친 글자가 옆 칸 머리에 덮여 **잘린 채** 보인다).
//    실측(`.micro` = Pretendard 14px · letter-spacing 0.02em): 한글 12.4px/자 · 라틴 7.7px/자이고,
//    2026-09-18에 머리·본문을 **굵게**(원장 지시) 바꿔 약 4% 넓어졌다 → 가드는 한글 12.9 · 라틴 8.0으로 잰다.
//    그래서 영어 라벨을 짧은 낱말로 줄였다(`Sch·Gr`·`Billed`·`Attended`·`Reg.`·`Diff`) — 뜻은 머리 툴팁이 편다.
//    🔴 짧게 고를 땐 **다른 뜻이 이미 쓰는 영어**를 피할 것(`School`·`Enrolled`로 한 번 lang-wiring 가드를 깼다).
//    `name-wiring.test.ts`가 이 상수를 **읽어** 한·영 라벨 길이를 잠근다.
//    🔴 48px(옛 `시수` 두 글자 자리)로 되돌리지 말 것.
const COL_W = { name: 88, school: 72, unitPrice: 96, classBilled: 76, actualAmount: 80, actualSalary: 80, units: 76, termSessions: 76, diff: 64, day: 22 } as const;

/** 표에 쌓이는 한 덩어리 = 한 반. 반별 보기는 1개, 강사 전체 보기는 그 강사의 모든 반. */
export type MatrixGroup = {
  classId: string;
  className: string;
  subjectLabel: string;
  /**
   * 차수 뒤 단위 한 글자 — 영어 `U` · 수학 `T`(원장 2026-09-18). 반 **과목**이 정한다
   * ([`unit-suffix.ts`](@/features/attendance/unit-suffix)) — 겸직 강사의 표엔 두 과목이 섞여 선다.
   */
  unitSuffix?: AttendanceUnitSuffix;
  /** 특강 토글(0133a) — '반이동' 표식을 뗀다([`transfer-badge.ts`](@/features/attendance/transfer-badge)). */
  isSpecial?: boolean;
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
   * 담임은 반 단위 속성이라 시간 축이 없어 인계 전 기록까지 새 담임 표에 잡혔다. 이제 그 날짜는 그리지 않는데
   * (2026-09-17 — 그전엔 빗금), 표식이 없으면 "왜 8월 초가 비었지"가 된다. null이면 종전과 같은 표기.
   */
  sinceLabel?: string | null;
};

/**
 * 그룹(반)의 집계 — 표 전체 합(`totalCount`)의 재료다.
 * ⚠️ 2026-09-17부터 **반 머리행엔 안 쓴다**(원장 *"정정. 반별 시수 삭제"*).
 */
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
  // ⚠️ **날짜로 막지 않는다** — 강사 보기도 모든 날짜 칸이 열려 있다(원장 2026-09-17 저녁 *"다른 요일도 보강 등으로 수업할 수
  //    있으니까 숫자 입력가능하게"*). 수업요일 색만 `ownDates`로 갈린다(matrix-row).
  const notMine: Record<string, NotMineReason> = {};
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
        // 본인 기록 저장은 이 표의 교시만 고친다. 다른 선생님 기록은 함께 쓰지 않는다.
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
  return { rows, cols, initial, slotCounts, notMine, autoUnits };
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
  classBilledAmounts,
  termSessionsByRow,
  confirmedPricesByRow,
  showActualAmount = false,
  salaryRates,
  optionsExtra,
  priceConfirmedRows,
  noInvoiceRows,
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
  /** 학생×반별 청구액(회차 확정과 동일). 빈 객체도 열을 표시하고 미매칭은 '미확정'. */
  classBilledAmounts?: Record<string, number>;
  /** 회차 확정에 저장된 단가·월 수강료. undefined면 열을 생략한다. */
  confirmedPricesByRow?: Record<string, AttendanceConfirmedPrice[]>;
  /** Server-authorized: freelance teacher views only. */
  showActualAmount?: boolean;
  /** Supplied only to the authorized administrator's teacher view. */
  salaryRates?: AttendanceSalaryRates;
  optionsExtra?: ReactNode;
  /**
   * 학생×반별 **등록 차수** — 회차 확정에서 확정한 시수(원장 2026-09-17). 청구액과 **같은 조회**에서 온다.
   * 키가 없으면 '미확정'(0을 지어내지 않는다). `daysBasis`면 그 숫자는 시수가 아니라 옛 **출석 일수**다.
   */
  termSessionsByRow?: Record<string, AttendanceTermSessions>;
  /**
   * 회차 확정에서 **단가까지 확정된** 학생×반 줄(`rowKey`) — 이 줄엔 「단가」 표식을 달지 않는다(원장 2026-09-18
   * *"회차 확정의 단가가 확정되었으면 출석부 단가 라벨 지울것"*). 표시 전용 — 수학 줄은 정산 자체가 회차 단가를 읽어
   * 이미 `missingTierRowKeys`에서 빠진다(tier-rows.ts). 이 목록은 영어 줄·정산에 못 쓰는 확정분의 표식을 뗀다.
   */
  priceConfirmedRows?: readonly string[];
  /**
   * 그 달 **청구서가 없거나 취소된** 학생×반 줄(`rowKey` → 이유, 2026-09-18) — 청구액·등록 차수·차이확인이 '미확정' 대신 `—`.
   * 회차 행이 없어도 청구서가 있으면 이 맵에 없다(종전 '미확정' — 회차 확정에서 만들 수 있다). 판정은 순수
   * [`attendanceNoInvoiceRows`](@/features/attendance/class-billing). 🔴 수업날 없는 줄의 0(`noLessonZeroView`)이 이긴다.
   */
  noInvoiceRows?: ReadonlyMap<string, AttendanceInvoiceGap>;
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
  // 강사 전체 보기의 그리는 날 합집합(`ownDates`) — 반별 보기는 null(요일로 칠한다, 종전).
  const ownDateUnion = groups.some((g) => g.matrix.ownDates)
    ? new Set(
        groups.flatMap((g) =>
          (g.matrix.ownDates ?? []).filter((date) => {
            const day = days.find((x) => x.date === date);
            return !!day && g.matrix.classDows.includes(day.dow);
          }),
        ),
      )
    : null;
  const showPrice = confirmedPricesByRow !== undefined;
  const showClassBilled = classBilledAmounts !== undefined;
  const showActualSalary = showActualAmount && salaryRates !== undefined;
  const salaryRatesByRow = showActualSalary ? Object.fromEntries(groups.flatMap((g) => g.matrix.students.map((s) => [
    rowKey(g.classId, s.id), attendanceSalaryRate(salaryRates!, { classId: g.classId, className: g.className, isSpecial: g.isSpecial, grade: s.grade }),
  ]))) as Record<string, number | null> : undefined;
  // 🔴 열의 유무는 **제 데이터**가 정한다 — 청구액에 묶어 두면 등록 차수를 안 받은 호출부에서 열만 서고
  //    전 행이 '미확정'이 된다("확정을 안 했다"는 거짓 사실). 지금 두 값은 같은 조회에서 함께 온다.
  const showTermSessions = termSessionsByRow !== undefined;
  /**
   * 그 달 **수업날이 하나도 없는** 줄 → 청구액·등록 차수·수업 차수를 0으로(원장 2026-09-18 *"'미확정' 이 아니라 등록차수를 0,
   * 청구액을 0, 수업차수도 0"*). 🔴 **여기 한 곳**에서 정해 줄 칸과 합계 행이 같은 두 벌(`billedView`·`termView`)을 본다.
   * 판정 = 줄이 수업요일 색을 칠하는 기준(`hasNoLessonDays`) · 청구액과 등록 차수가 둘 다 빈 줄만(`noLessonZeroView`).
   */
  const noLesson = noLessonZeroView({
    rows: groups.flatMap((g) =>
      g.matrix.students.map((s) => ({
        key: rowKey(g.classId, s.id),
        noLessons: hasNoLessonDays({
          days,
          holidays,
          attendDows: s.attendDows,
          spans: s.spans,
          marks: g.matrix.marks[s.id] ?? {},
          derived: g.matrix.derived[s.id],
        }),
      })),
    ),
    ...(classBilledAmounts ? { billed: classBilledAmounts } : {}),
    ...(termSessionsByRow ? { term: termSessionsByRow } : {}),
  });
  const billedView = noLesson.billed;
  const termView = noLesson.term;
  // 이름·학교·수업 차수·출석률(4) + 날짜 + 청구액 + 등록 차수·차이확인(둘은 한 짝).
  const colSpan = days.length + 3 + (showPrice ? 1 : 0) + (showClassBilled ? 1 : 0) + (showActualAmount ? 1 : 0) + (showActualSalary ? 1 : 0) + (showTermSessions ? 2 : 0);
  const optionalColumns: { key: AttendanceColumn; width: number }[] = [
    { key: "school", width: COL_W.school },
    ...(showPrice ? [{ key: "unitPrice" as const, width: COL_W.unitPrice }] : []),
    ...(showClassBilled ? [{ key: "classBilled" as const, width: COL_W.classBilled }] : []),
    ...(showActualAmount ? [{ key: "actualAmount" as const, width: COL_W.actualAmount }] : []),
    ...(showActualSalary ? [{ key: "actualSalary" as const, width: COL_W.actualSalary }] : []),
    { key: "units", width: COL_W.units },
    ...(showTermSessions ? [{ key: "termSessions" as const, width: COL_W.termSessions }, { key: "diff" as const, width: COL_W.diff }] : []),
  ];
  // 단가(티어) 미지정으로 정산에서 빠진 **반·학생 줄** — 「단가」 표식(합계 뱃지만으론 못 찾는다).
  // 🔴 학생 id가 아니라 **줄**(`classId|studentId`)로 가린다(원장 2026-09-18 제보) — 단가는 학생 × 반마다 따로라
  //    학생 id로 가리면 한 반만 비어도 그 학생의 모든 반 줄에 「단가」가 붙었다(표식이 실제보다 훨씬 많았다).
  // 🔗 회차 확정에서 단가를 확정한 줄은 뺀다(원장 2026-09-18) — 표식은 "아직 아무 데서도 단가를 안 정했다"는 뜻이 된다.
  const priceConfirmed = new Set(priceConfirmedRows ?? []);
  const tierMissingRows = new Set(
    (money && money.tierSettlement.status !== "unwired" ? money.tierSettlement.missingTierRowKeys : []).filter(
      (key) => !priceConfirmed.has(key),
    ),
  );
  // 학생별 단가 티어 라벨(학교·학년 열 아랫줄) — 라벨만이라 금액 비노출. 원장 전용 금액 보기에서만 존재.
  const tierByStudent: Record<string, string> =
    money && money.tierSettlement.status !== "unwired" ? money.tierSettlement.tierByStudent : {};
  /**
   * '반이동' 표식을 떼는 (반·학생) — 특강 반 + "다른 수강 구간 안에 통째로 든 수강"(원장 2026-09-18).
   * 🔴 재료는 **이 표의 모든 묶음**이라 여기서 한 번에 센다(행 컴포넌트는 제 반밖에 모른다).
   */
  const noTransferBadge = suppressedTransferRows(
    groups.map((g) => ({
      classId: g.classId,
      className: g.className,
      isSpecial: g.isSpecial,
      students: g.matrix.students.map((s) => ({ id: s.id, spans: s.spans })),
    })),
  );
  const totalCount = sumCounts(groups.map((g) => groupCount(g.matrix)));
  /**
   * 합계 행의 서버 첫 렌더 값 — 격자와 **같은 함수**(`columnTotals` → `countCells`)로 만든다. 격자가 뜨면 격자가 이긴다.
   * 🔴 마크(기록)만 센다 — 빗금 칸(다른 선생님 교시)은 이 표의 값이 아니다(countMarks와 같은 규약).
   */
  const columnTotalsFallback = columnTotals(
    groups.flatMap((g) =>
      g.matrix.students.map((s) =>
        Object.entries(g.matrix.marks[s.id] ?? {}).map(
          ([date, st]) => [date, { s: st, u: g.matrix.units[s.id]?.[date] ?? null }] as const,
        ),
      ),
    ),
  );
  /** 합계 행 단위 글자 — 표의 반이 **한 단위**일 때만(영어만 U · 수학만 T). 섞이면 숫자만(한 글자로 묶으면 거짓). */
  const suffixes = new Set(groups.map((g) => g.unitSuffix ?? null));
  const totalsSuffix = suffixes.size === 1 ? ([...suffixes][0] ?? null) : null;
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
    (showPrice ? COL_W.unitPrice : 0) +
    (showClassBilled ? COL_W.classBilled : 0) +
    (showActualAmount ? COL_W.actualAmount : 0) +
    (showActualSalary ? COL_W.actualSalary : 0) +
    COL_W.units +
    (showTermSessions ? COL_W.termSessions + COL_W.diff : 0) +
    days.length * COL_W.day;

  return (
    // 격자가 **화면의 유일한 세로 스크롤**이다(scrollY) — 그래야 `thead sticky top-0`이 실제로 붙고
    // 스크롤바도 하나만 생긴다. 높이는 부모(page.tsx의 `min-h-0 flex-1`)가 정해 준다 — 상수·vh 계산 없음.
    <AttendanceColumns columns={optionalColumns} minWidth={tableMinWidth} dayCount={days.length} dayMinWidth={COL_W.day} lang={lang} extra={optionsExtra}>
    <DragScrollArea pan={false} scrollY className="bg-card shadow-card h-full rounded-2xl">
      <table className="table-fixed border-collapse text-sm" style={{ width: "calc(var(--att-full-width) - var(--att-hidden-width))", minWidth: `calc(${tableMinWidth}px - var(--att-hidden-width))` }}>
        {/* 열 폭의 단일 소스 — 셀의 `w-*`가 아니라 여기가 정한다(table-fixed). 접기와 무관하게 불변. */}
        <colgroup>
          <col style={{ width: COL_W.name }} />
          <col data-att-column="school" style={{ width: COL_W.school }} />
          {showPrice ? <col data-att-column="unitPrice" style={{ width: COL_W.unitPrice }} /> : null}
          {showClassBilled ? <col data-att-column="classBilled" style={{ width: COL_W.classBilled }} /> : null}
          {showActualAmount ? <col data-att-column="actualAmount" style={{ width: COL_W.actualAmount }} /> : null}
          {showActualSalary ? <col data-att-column="actualSalary" style={{ width: COL_W.actualSalary }} /> : null}
          <col data-att-column="units" style={{ width: COL_W.units }} />
          {showTermSessions ? <col data-att-column="termSessions" style={{ width: COL_W.termSessions }} /> : null}
          {showTermSessions ? <col data-att-column="diff" style={{ width: COL_W.diff }} /> : null}
          {days.map((d) => (
            <col key={d.date} data-att-day={d.date} style={{ width: "var(--att-day-width, 22px)" }} />
          ))}
        </colgroup>
        <thead>
          {/* 높이 고정 — 칸의 scroll-margin-top과 짝을 이룬다(cell-display.ts `HEAD_ROW_H` 주석). */}
          <tr className={HEAD_ROW_H}>
            {/* 이름 열 머리는 본문 이름(왼쪽, flex)과 같은 축 — 칸 가운데에 머리만 서면 이름과 다른 자리에 선다(원장 2026-09-18). */}
            <th
              className={`bg-bg-soft sticky top-0 left-0 ${HEAD_CORNER_Z} ${HEAD_UNDERLINE} ${EDGE_RIGHT} px-2 py-1 text-left whitespace-nowrap`}
            >
              {/* 반 접기가 있는 보기에서만 — 별도 줄 없이 이름 열 머리에 얹는다. */}
              {showGroups ? <CollapseAllButton classIds={groups.map((g) => g.classId)} /> : null}
              <span className="micro">{t("att.col.name")}</span>
            </th>
            <th
              data-att-column="school"
              className={`bg-bg-soft border-line sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} border-r px-1.5 py-1 text-center whitespace-nowrap`}
              title={t("att.col.schoolGradeTitle")}
            >
              <span className="micro font-bold">{t("att.col.schoolGrade")}</span>
            </th>
            {showPrice ? (
              <th
                data-att-column="unitPrice"
                className={`bg-bg-soft border-line sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} border-r px-1 py-1 text-right whitespace-nowrap`}
                title={t("att.col.unitPriceTitle")}
              >
                <span className="micro font-bold">{t("att.col.unitPrice")}</span>
              </th>
            ) : null}
            {showClassBilled ? (
              <th
                data-att-column="classBilled"
                className={`bg-bg-soft border-line sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} border-r px-1 py-1 text-right whitespace-nowrap`}
                title={t("att.col.classBilledTitle")}
              >
                <span className="micro font-bold">{t("att.col.classBilled")}</span>
              </th>
            ) : null}
            {showActualAmount ? <th data-att-column="actualAmount"
              className={`bg-bg-soft border-line sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} border-r px-1 py-1 text-right whitespace-nowrap`}
              title={t("att.col.actualAmountTitle")}>
              <span className="micro font-bold">{t("att.col.actualAmount")}</span>
            </th> : null}
            {showActualSalary ? <th data-att-column="actualSalary"
              className={`bg-bg-soft border-line sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} border-r px-1 py-1 text-right whitespace-nowrap`}
              title={t("att.col.actualSalaryTitle")}>
              <span className="micro font-bold">{t("att.col.actualSalary")}</span>
            </th> : null}
            {/* 수업 차수 = 출석부에서 센 시수(소비 상태 칸의 배수 합) · 등록 차수 = 회차 확정의 확정 시수(원장 2026-09-17).
                청구액·수업 차수·등록 차수는 본문 값이 오른쪽 정렬이라 머리도 오른쪽(같은 축, 원장 2026-09-18). */}
            <th
              data-help="att-lesson-count"
              data-att-column="units"
              className={`bg-bg-soft border-line sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} border-r px-1 py-1 text-right whitespace-nowrap`}
              title={t("att.col.lessonCountTitle")}
            >
              <span className="micro font-bold">{t("att.col.lessonCount")}</span>
            </th>
            {showTermSessions ? (
              <th
                data-att-column="termSessions"
                className={`bg-bg-soft border-line sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} border-r px-1 py-1 text-right whitespace-nowrap`}
                title={t("att.col.termSessionsTitle")}
              >
                <span className="micro font-bold">{t("att.col.termSessions")}</span>
              </th>
            ) : null}
            {/* 차이확인 = **수업 차수 − 등록 차수**(원장 2026-09-18). 등록 차수와 한 짝이라 같은 조건으로 선다 —
                뺄 수가 없으면 열만 서고 전 행이 `—`가 된다. */}
            {showTermSessions ? (
              <th
                data-att-column="diff"
                className={`bg-bg-soft border-line sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} border-r px-1 py-1 text-center whitespace-nowrap`}
                title={t("att.col.sessionDiffTitle")}
              >
                <span className="micro font-bold">{t("att.col.sessionDiff")}</span>
              </th>
            ) : null}
            {days.map((d) => {
              // 그 달에 없는 날 — 빈 여백(번호·요일 없음). 폭은 다른 날 칸과 동일(min-w)로 고정.
              if (d.placeholder) {
                // ⚠️ 불투명이어야 한다(#74) — sticky 헤더가 반투명이면 밑으로 지나가는 학생 행이 비쳐 보인다.
                return (
                  <th
                    key={d.date}
                    className={`bg-bg-soft border-line sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} min-w-[22px] border-r`}
                    aria-hidden
                  />
                );
              }
              const holiday = holidays[d.date];
              // 강사 전체 보기는 **그 강사가 수업하는 날**만 수업요일로 칠한다(원장 2026-09-17) — 반 요일 합집합이면
              // 안 가르치는 요일 머리까지 민트가 되어 본문(빈 칸)과 어긋난다.
              const isClassDay = (ownDateUnion ? ownDateUnion.has(d.date) : classDows.has(d.dow)) && !holiday;
              // 배경 = 오늘 > 수업요일(민트) > 주말·휴일(회색) > 수업 없는 평일(흰색). 본문 셀과 같은 DAY_TONE.
              // 글자색 = 일요일·공휴일이면 빨강(달력 관행).
              // 🔴 휴일은 주말보다 **먼저** 본다(2026-09-07 "셀을 구분") — 뒤에 두면 토요일 휴일이
              //    회색으로 덮여 왜 쉬는지가 사라진다. 본문 셀(cellDisplay)과 **같은 순서**여야 열이 안 어긋난다.
              const bg = d.isToday
                ? TODAY_HEAD.bg
                : isClassDay
                  ? DAY_TONE.classDay
                  : holiday
                    ? DAY_TONE.holiday
                    : d.isWeekend
                      ? DAY_TONE.weekend
                      : "bg-card";
              const fg = d.isToday
                ? TODAY_HEAD.fg
                : holiday || d.dow === 0
                  ? // 빨간 날짜 — 공용 `text-danger`는 톤업한 휴일·주말 배경 위에서 3.88·3.75로 WCAG 4.5를 깼다
                    //   (적대적 리뷰 2026-09-14). 출석부 전용 휴일 잉크로 칠한다(휴일 7.62 · 주말 7.37).
                    "text-att-holiday-ink"
                  : isClassDay
                    ? "text-foreground"
                    : d.isWeekend
                      ? "text-text-dim"
                      : "text-text-faint";
              return (
                <th
                  key={d.date}
                  title={holiday ?? undefined}
                  className={`border-line num sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} min-w-[22px] border-r px-0.5 py-1 text-center text-xs ${bg} ${fg}`}
                >
                  <div className="font-bold">{d.day}</div>
                  <div className="opacity-70">{d.label}</div>
                </th>
              );
            })}
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
                    confirmedPrices={showPrice ? confirmedPricesByRow?.[rowKey(g.classId, s.id)] ?? null : undefined}
                    showActualAmount={showActualAmount}
                    actualSalaryRate={salaryRatesByRow?.[rowKey(g.classId, s.id)]}
                    classBilled={showClassBilled ? billedView?.[rowKey(g.classId, s.id)] ?? null : undefined}
                    termSessions={showTermSessions ? termView?.[rowKey(g.classId, s.id)] ?? null : undefined}
                    noLessonZero={noLesson.zeroRows.has(rowKey(g.classId, s.id))}
                    noInvoice={noInvoiceRows?.get(rowKey(g.classId, s.id)) ?? null}
                    unitSuffix={g.unitSuffix ?? null}
                    noTransferBadge={noTransferBadge.has(transferRowKey(g.classId, s.id))}
                    lockBefore={lockBefore}
                    classLabel={g.className}
                    tierMissing={tierMissingRows.has(rowKey(g.classId, s.id))}
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
                confirmedPrices={showPrice ? confirmedPricesByRow?.[rowKey(g.classId, s.id)] ?? null : undefined}
                showActualAmount={showActualAmount}
                actualSalaryRate={salaryRatesByRow?.[rowKey(g.classId, s.id)]}
                classBilled={showClassBilled ? billedView?.[rowKey(g.classId, s.id)] ?? null : undefined}
                termSessions={showTermSessions ? termView?.[rowKey(g.classId, s.id)] ?? null : undefined}
                noLessonZero={noLesson.zeroRows.has(rowKey(g.classId, s.id))}
                noInvoice={noInvoiceRows?.get(rowKey(g.classId, s.id)) ?? null}
                unitSuffix={g.unitSuffix ?? null}
                noTransferBadge={noTransferBadge.has(transferRowKey(g.classId, s.id))}
                lockBefore={lockBefore}
                classLabel={g.className}
                tierMissing={tierMissingRows.has(rowKey(g.classId, s.id))}
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
                  {/* 🔴 반 머리행의 시수 표기는 **없앴다**(원장 2026-09-17 *"정정. 반별 시수 삭제"*) —
                      학생 줄의 '수업 차수'와 합계 줄이 같은 숫자를 이미 말한다. 되살리지 말 것. */}
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
          {/* 🔴 합계와 조작 안내를 **한 줄**로 둔다(원장 2026-09-14 *"한행으로. 2행은 1행 우측 끝으로 간략하게"*).
              그전엔 합계 줄 + (조작법·범례) 줄 두 줄이었다. 범례는 같은 날 **표 위로** 올렸고
              (`attendance-legend.tsx` — *"범례 가장 위로"*), 조작법은 짧게 줄여 합계 **뒤에 이어 붙이고** 전문은
              툴팁에 남긴다(입력 격자의 키보드 조작법이라 폰에선 쓰지 않는다).
              🔴 안내를 합계 **밖에 `sticky right-0`로 따로 세우지 말 것** — 표가 화면보다 넓으면(금액 열이 있으면
                 1,406px~) 두 sticky가 제 폭을 지키며 안내가 **합계·정산액을 덮는다**(폰 375px에선 합계가 0% 보였다 —
                 적대적 리뷰 2026-09-14). 합계 덩어리 안에 두고, 그 덩어리 폭을 `StickyFitRow`가 **보이는 폭**으로
                 묶는다 — 안 묶으면 `w-fit`이 표 전체 폭까지 늘어 접히지 않고, 폰에서 끝까지 밀면 합계가 화면 밖으로
                 나간다(재리뷰 2026-09-14). */}
          {/* 합계 행(원장 2026-09-18) — 열에 맞춘 한 줄. 요약 줄(아래)은 그대로 둔다(반 수·정산·조작 안내). */}
          <MatrixColumnTotalsRow
            rows={groups.flatMap((g) => g.matrix.students.map((s) => rowKey(g.classId, s.id)))}
            days={days}
            showPrice={showPrice}
            showActualAmount={showActualAmount}
            pricesByRow={showActualAmount ? confirmedPricesByRow : undefined}
            countsByRow={countByRow}
            salaryRatesByRow={salaryRatesByRow}
            showClassBilled={showClassBilled}
            billedColumnWidth={COL_W.classBilled}
            showTermSessions={showTermSessions}
            billedByRow={billedView}
            termByRow={termView}
            suffix={totalsSuffix}
            fallback={columnTotalsFallback}
            lang={lang}
          />
          <tr className="bg-bg-soft">
            <AttendanceColSpan colSpan={colSpan} className="border-line border-t p-0">
              {/* 검색이 걸리면 이 줄의 숫자가 **전부 검색 기준**이 된다(클라 — totals-row.tsx). */}
              {groups.length > 1 ? (
                <MatrixTotalsSummary
                  classCount={groups.length}
                  fallback={totalCount}
                  countByRow={countByRow}
                  money={money}
                  showLegacySettlement={!showActualSalary}
                  moneyNote={moneyNote}
                  trailing={<ControlGuide countByRow={countByRow} fallback={totalCount} lang={lang} />}
                />
              ) : (
                <StickyFitRow className="px-3 py-2">
                  <ControlGuide countByRow={countByRow} fallback={totalCount} lang={lang} />
                </StickyFitRow>
              )}
            </AttendanceColSpan>
          </tr>
        </tfoot>
      </table>
    </DragScrollArea>
    </AttendanceColumns>
  );
}

/**
 * 합계 줄 끝의 **짧은 조작 안내** — 전문(방향키·범위·복사·채우기…)은 툴팁(`att.help.full`).
 * ⚠️ 조각 사이 공백은 **사전 값 안에** 담았다 — JSX 줄바꿈은 공백을 지우고, `{" "}`로 넣으면 한국어에 없어야 할
 *    공백이 생긴다(언어마다 붙임이 다르다). 기록 수는 격자와 함께 움직이는 `LiveRecords`.
 * ⚠️ 줄바꿈을 막지 않는다(`whitespace-nowrap`·`shrink-0` 없음) — 자리가 모자라면 flex가 먼저 이 조각을 둘째 줄로
 *    내리고, 폰처럼 그 줄도 좁으면 문장이 보이는 폭 안에서 접힌다(재리뷰 2026-09-14).
 */
function ControlGuide({
  countByRow,
  fallback,
  lang,
}: {
  countByRow: Record<string, Counted>;
  fallback: Counted;
  lang: SheetLang;
}) {
  return (
    <span className="text-text-dim text-xs" title={sheetT(lang, "att.help.full")}>
      {sheetT(lang, "att.help.briefPre")}
      <LiveRecords countByRow={countByRow} fallback={fallback} />
      {sheetT(lang, "att.help.brief")}
    </span>
  );
}
