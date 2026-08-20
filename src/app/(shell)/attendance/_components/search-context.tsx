"use client";

/**
 * 월별 출석부 **학생 검색** 상태 — 툴바(입력)와 표(행 숨김)와 격자(좌표)가 같은 값을 본다.
 *
 * 🔴 **안 맞는 행은 CSS로 감추지 않고 아예 안 그린다.** 이 표는 키보드 세로 이동·범위 선택·드래그
 *    채우기가 행 배열(`GridProvider`의 rows)을 좌표로 쓰기 때문에, 숨기기만 하면 ↑↓·Tab·Shift 범위가
 *    **보이지 않는 칸으로 들어가고 그 칸이 저장된다**. 반 접기가 같은 이유로 행을 제거하는데
 *    (`class-group.tsx`·`grid-context.tsx`) 검색도 정확히 그 규약을 따른다.
 * 🔴 **검색어는 저장하지 않는다** — 화면을 떠나면 사라진다(`useState`뿐, ui_prefs·URL 아님).
 * 🔴 **새로 열리는 데이터가 없다** — 서버가 이미 그린 행만 좁힌다(강사는 담당 반만 본다, [[#77]]).
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  emptySearchMessage,
  isSearchActive,
  matchesStudentSearch,
} from "@/features/attendance/student-search";
import { SearchScopeChip, StudentSearchBox } from "@/features/attendance/components/student-search-box";

/** 표의 한 행이 들고 있는 검색 재료 — **그 줄에 실제로 그려진 값만**(영문 이름 등은 이 표에 없다). */
export type AttendanceSearchRow = {
  /** 격자 행 키(`classId|studentId`) — 표·격자·접기가 전부 이 키로 말한다. */
  row: string;
  /**
   * 학생 id — **"N명"을 셀 때 쓴다**. 강사 전체 보기에선 한 학생이 여러 반에 나와 줄이 둘 이상이라,
   * 줄 수를 인원으로 적으면 툴바의 '등록 N명'(중복 제거)과 어긋난다.
   */
  studentId: string;
  name: string;
  school?: string | null;
  grade?: string | null;
  /** 화면에 붙어 그려지는 압축 표기("경명여중2") — 친 그대로 걸려야 한다. */
  schoolGrade?: string | null;
};

type Ctx = {
  query: string;
  setQuery: (q: string) => void;
  /** 지금 필터가 걸려 있나(공백만 친 것은 아니다). */
  active: boolean;
  /** 검색에 걸린 행 키 — `active`일 때만 의미가 있다. */
  matched: ReadonlySet<string>;
  /** 표에 있는 **실인원**(반 중복 제거) — 툴바 '등록 N명'과 같은 셈법. */
  totalStudents: number;
  /** 검색에 걸린 실인원. */
  matchedStudents: number;
};

const SearchCtx = createContext<Ctx | null>(null);

/** 격자·표·툴바가 함께 쓰는 검색 상태. 공급자가 없으면 null(= 검색 기능이 없는 화면). */
export function useAttendanceSearch(): Ctx | null {
  return useContext(SearchCtx);
}

export function AttendanceSearchProvider({
  rows,
  children,
}: {
  rows: AttendanceSearchRow[];
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const active = isSearchActive(query);
  const { matched, matchedStudents } = useMemo(() => {
    const out = new Set<string>();
    const people = new Set<string>();
    if (!isSearchActive(query)) return { matched: out, matchedStudents: 0 };
    for (const r of rows) {
      if (matchesStudentSearch(query, [r.name, r.school, r.grade, r.schoolGrade])) {
        out.add(r.row);
        people.add(r.studentId);
      }
    }
    return { matched: out, matchedStudents: people.size };
  }, [rows, query]);
  const totalStudents = useMemo(() => new Set(rows.map((r) => r.studentId)).size, [rows]);
  const value = useMemo<Ctx>(
    () => ({ query, setQuery, active, matched, totalStudents, matchedStudents }),
    [query, active, matched, totalStudents, matchedStudents],
  );
  return <SearchCtx.Provider value={value}>{children}</SearchCtx.Provider>;
}

/** 툴바의 입력칸 + 지금 걸린 필터 표기. 표에 행이 하나도 없으면 아예 안 그린다(검색할 게 없다). */
export function AttendanceSearchBox() {
  const ctx = useAttendanceSearch();
  if (!ctx || ctx.totalStudents === 0) return null;
  return (
    <>
      <StudentSearchBox value={ctx.query} onChange={ctx.setQuery} />
      {ctx.active ? (
        <SearchScopeChip
          shown={ctx.matchedStudents}
          total={ctx.totalStudents}
          totalsNote="시수·출석률·금액은 전체 기준"
        />
      ) : null}
    </>
  );
}

/**
 * 학생 행 하나 — 검색에 안 걸리면 **그리지 않는다**(숨김 아님, 위 주석의 좌표 규약).
 * ⚠️ children은 서버가 이미 그린 `<tr>`이라 여기서 다시 렌더되지 않는다(검색어가 바뀌어도 싸다).
 */
export function SearchedRow({ row, children }: { row: string; children: ReactNode }) {
  const ctx = useAttendanceSearch();
  if (ctx?.active && !ctx.matched.has(row)) return null;
  return <>{children}</>;
}

/**
 * 이 반에 걸린 학생이 하나라도 있나 — 반 블록째 지울지 판정한다.
 * ⚠️ `rowKeys`가 없으면 **판정하지 않는다**(active=false). 없을 때 0으로 떨어뜨리면, 검색을 모르는
 *    호출부가 검색이 걸리는 순간 통째로 사라진다(옵트인이어야 안전하다).
 */
export function useClassMatched(rowKeys: readonly string[] | undefined): {
  active: boolean;
  count: number;
} {
  const ctx = useAttendanceSearch();
  if (!ctx?.active || !rowKeys) return { active: false, count: rowKeys?.length ?? 0 };
  let count = 0;
  for (const k of rowKeys) if (ctx.matched.has(k)) count++;
  return { active: true, count };
}

/** 검색이 걸려 있나 — 검색 중엔 뜻이 없어지는 컨트롤(전체 접기 등)이 스스로 물러날 때 쓴다. */
export function useSearchActive(): boolean {
  return useAttendanceSearch()?.active ?? false;
}

/**
 * 반 머리행에 붙는 "검색 N명" — 인원(전체)과 나란히 서서 **머리행 숫자가 거짓말하지 않게** 한다.
 * (반 시수는 접기와 같은 이유로 전체 기준 그대로다 — 그 사실은 툴바 칩이 말한다.)
 */
export function ClassSearchCount({ rowKeys }: { rowKeys: readonly string[] }) {
  const { active, count } = useClassMatched(rowKeys);
  if (!active) return null;
  return <span className="text-amber-strong num text-[11px] font-bold">검색 {count}명</span>;
}

/**
 * 결과 0명 — **왜 비었는지 한 줄로 밝힌다**. 빈 표만 남기면 "출석부가 고장났다"로 읽힌다.
 * `<tbody>`로 그리는 이유: 표 안이라 `<tr>`이 아니면 브라우저가 밖으로 밀어낸다.
 *
 * ⚠️ `where`는 **문자열**이다 — 문구 조립 함수를 prop으로 받으면 서버 컴포넌트(matrix-table)가
 *    클라 컴포넌트에 함수를 넘기는 꼴이라 직렬화가 안 돼 실행 시점에 터진다(테스트는 전부 클라라 못 잡는다).
 */
export function SearchEmptyRow({ colSpan, where }: { colSpan: number; where: string }) {
  const ctx = useAttendanceSearch();
  if (!ctx?.active || ctx.matched.size > 0) return null;
  return (
    <tbody>
      <tr>
        <td colSpan={colSpan} className="border-line border-b px-4 py-6">
          <div className="sticky left-0 flex w-fit items-center gap-2">
            <span className="text-foreground text-[13px] font-bold">
              {emptySearchMessage(ctx.query, where)}
            </span>
            <button
              type="button"
              onClick={() => ctx.setQuery("")}
              className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition"
            >
              검색 지우기
            </button>
          </div>
        </td>
      </tr>
    </tbody>
  );
}
