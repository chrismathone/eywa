"use client";

/**
 * 출석부 **허브 툴바의 학생 검색** — 강사를 고르기 전에 "이 학생이 누구 반이지"를 푼다.
 *
 * 원장 제보 2026-08-20: *"진입하기 전에도 검색가능하도록 해주고, 검색한 채로 선생님 출석부에 진입하면
 * [그 학생 줄만 남은 화면]이 되도록"*. 그래서 결과 줄을 누르면 그 강사 출석부가 **검색어를 들고**
 * 열린다(`attHref`의 `q` = 씨앗).
 *
 * 🔑 시트 안 검색(`AttendanceSearchBox`)과 **자리가 겹치지 않는다** — 저건 반이 그려졌을 때만,
 *    이건 허브(반 미선택)일 때만 뜬다. 그래서 URL 씨앗을 적는 주인도 언제나 하나다.
 * 🔴 조회는 서버에 있고(반 스코프 판정 포함) 여기서 권한을 판정하지 않는다([[#77]]).
 * ⚠️ 결과 패널은 **툴바(relative)에 붙는 absolute**다 — 새 줄을 만들지 않는다(툴바 한 줄 규약).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { StudentSearchBox } from "@/features/attendance/components/student-search-box";
import { isSearchActive } from "@/features/attendance/student-search";
import {
  HUB_SEARCH_LIMIT,
  hubEmptyMessage,
  hubTruncatedNote,
  type HubSearchResult,
} from "@/features/attendance/hub-search";
import { searchAttendanceHubStudents } from "@/features/attendance/server/hub-search-actions";
import { attHref } from "./att-href";
import { syncSearchSeedInUrl } from "./att-search-seed";

/** 입력이 멎고 이만큼 지나면 서버에 묻는다(결석 접수 다이얼로그와 같은 리듬). */
const DEBOUNCE_MS = 250;

export function HubStudentSearch({
  month,
  initialQuery = "",
  initialResult = null,
}: {
  month: string;
  /** URL 씨앗(`?q=`) — 링크로 들어왔으면 입력칸에 그대로 보여 준다(보이지 않는 필터 금지). */
  initialQuery?: string;
  /** 씨앗이 있을 때 **서버가 미리 돌린** 결과 — 첫 렌더에 결과가 이미 있어 마운트 조회가 필요 없다. */
  initialResult?: HubSearchResult | null;
}) {
  const [query, setQueryState] = useState(initialQuery);
  const [result, setResult] = useState<HubSearchResult | null>(initialResult);
  const [loading, setLoading] = useState(false);
  // 늦게 온 옛 응답이 최신 결과를 덮지 않게(결석 접수 다이얼로그와 같은 규약).
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const run = useCallback(
    (term: string) => {
      setQueryState(term);
      if (timer.current) clearTimeout(timer.current);
      const mine = ++seq.current;
      // 🔴 지우기(X·Esc)는 **즉시** — 결과도 URL 씨앗도 같이 걷는다(안 걷으면 새로고침에 되살아난다).
      if (!isSearchActive(term)) {
        setResult(null);
        setLoading(false);
        syncSearchSeedInUrl("");
        return;
      }
      setLoading(true);
      timer.current = setTimeout(() => {
        // 씨앗을 주소창에 맞춰 둔다 — 여기서 강사·과목 드롭다운(FilterSelect)을 눌러도 검색어가 따라간다.
        syncSearchSeedInUrl(term);
        void searchAttendanceHubStudents({ query: term, month })
          .then((r) => {
            if (mine !== seq.current) return;
            setResult(r);
            setLoading(false);
          })
          .catch(() => {
            // 서버가 던지면(네트워크·배포 교체) 목록이 조용히 옛 상태로 남는다 — 사유를 보여준다.
            if (mine !== seq.current) return;
            setResult({
              hits: [],
              truncated: false,
              limit: HUB_SEARCH_LIMIT,
              where: "",
              error: "학생을 찾지 못했습니다 — 잠시 후 다시 시도해 주세요",
            });
            setLoading(false);
          });
      }, DEBOUNCE_MS);
    },
    [month],
  );

  const open = isSearchActive(query);
  return (
    // ⚠️ 라벨 칸('학생')을 두지 않는다 — 시트 검색과 같은 모양이고, 폰에서 툴바가 한 줄 더 감기는 것을
    //    막는다(placeholder·aria-label이 이미 무엇을 찾는지 말한다).
    // 🔴 `sm:relative` = 결과 패널의 **기준점**(넓은 화면만). 예전엔 툴바(relative)에 붙어 툴바 **왼쪽
    //    끝**에 떴는데 입력칸은 툴바 오른쪽 끝이라 "친 자리와 답이 뜨는 자리가 화면 반대편"이었다
    //    (원장 제보 2026-08-20).
    // ⚠️ 좁은 화면에선 기준점을 **두지 않는다** — 그러면 패널이 툴바 기준으로 돌아가 종전처럼 툴바 왼쪽에
    //    붙는다. 여기서도 입력칸에 붙이면 460px 패널이 입력칸 오른쪽 끝에서 왼쪽으로 뻗어 **화면 밖으로**
    //    나간다(툴바가 감기면 입력칸이 줄 왼쪽에 설 수 있다).
    <div className="flex items-center gap-1.5 sm:relative">
      <StudentSearchBox
        value={query}
        onChange={run}
        placeholder="학생 이름으로 찾기"
        inputWidth="w-[116px]"
      />
      {open ? (
        // 🔑 넓은 화면 = **입력칸 바로 아래**(위 `sm:relative`가 기준, `right-0`으로 칸 오른쪽 끝에 맞춤)
        //    · 좁은 화면 = 종전대로 툴바 왼쪽(`left-4` = 툴바 px-4). 어느 쪽이든 툴바 줄 수는 그대로다.
        // ⚠️ `sm:left-auto`를 빼면 두 값이 함께 걸려 패널이 좌우로 늘어난다(폭 지정이 무시된다).
        <div className="border-line bg-card absolute top-full left-4 z-40 mt-1 w-[min(460px,calc(100vw-3rem))] rounded-2xl border p-2 shadow-lg sm:left-auto sm:right-0">
          {/* 🔴 결과가 없는 채로 다시 묻는 중이면 **"없습니다"라고 말하지 않는다** — 방금 친 말의 답이
              아직 안 왔을 뿐인데 못 찾았다고 하면 사람이 검색을 그만둔다. */}
          {loading && (!result || result.hits.length === 0) ? (
            <p className="text-text-dim px-2 py-3 text-[12.5px]">찾는 중…</p>
          ) : result?.error ? (
            <p className="text-danger px-2 py-3 text-[12.5px]">{result.error}</p>
          ) : result && result.hits.length === 0 ? (
            <p className="text-text-dim px-2 py-3 text-[12.5px] break-keep">
              {hubEmptyMessage(query, result.where || "출석부")}
            </p>
          ) : result ? (
            <>
              {/* 검색어를 바꾸는 동안엔 **옛 결과**가 잠깐 남는다 — 그 사실을 한 줄로 밝힌다
                  (아무 표시가 없으면 지금 목록이 방금 친 말의 답인 줄로 읽힌다). */}
              {loading ? <p className="text-text-faint px-2 pb-1 text-[11.5px]">찾는 중…</p> : null}
              <ul className="max-h-[min(46vh,360px)] space-y-0.5 overflow-y-auto px-1">
                {result.hits.map((h) => (
                  <li key={`${h.classId}:${h.studentId}`}>
                    <Link
                      href={attHref({
                        // 강사가 정해지면 그 강사 **전체 출석부**(허브 카드와 같은 목적지),
                        // 담임이 없는 반(자리 등)은 그 반만 연다.
                        classId: h.linkTeacherId ? null : h.classId,
                        month,
                        teacherId: h.linkTeacherId,
                        mode: h.linkTeacherId ? "teacher" : "class",
                        // 🔑 씨앗은 **친 말이 아니라 그 학생 이름** — 학교로 찾았든 한 글자만 쳤든
                        //    도착한 표에는 그 학생 줄만 남아야 "검색한 채로 진입"이 성립한다.
                        q: h.studentName,
                      })}
                      className="hover:bg-bg-soft flex items-baseline gap-2 rounded-lg px-2 py-1.5"
                    >
                      <span className="text-foreground shrink-0 text-[13px] font-bold">{h.studentName}</span>
                      {h.schoolGrade ? (
                        <span className="text-text-faint shrink-0 text-[11.5px]">{h.schoolGrade}</span>
                      ) : null}
                      <span className="text-text-dim min-w-0 flex-1 truncate text-[12px]">
                        {h.className}
                        {h.teacherName ? ` · ${h.teacherName}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {/* 🔴 잘랐으면 **밝힌다** — 상한을 숨기면 "그 학생은 없다"는 거짓말이 된다([[#89]]). */}
              {result.truncated ? (
                <p className="text-amber border-line mt-1 border-t px-2 pt-1.5 text-[11.5px]">
                  {hubTruncatedNote(result.limit)}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-text-dim px-2 py-3 text-[12.5px]">찾는 중…</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
