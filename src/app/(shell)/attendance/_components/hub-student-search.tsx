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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
// 결과 줄은 창 안에서 처음부터 embed를 싣는다(EmbedLink — 맨 Link면 창 주소 되붙이기에 기대게 되고 그 뒤 첫 새로고침이
// 라우터 트리와 어긋나 한 번 더 받는다, 전수검사 리뷰 2026-09-11).
import { EmbedLink } from "@/components/embed-link";
import { StudentSearchBox } from "@/features/attendance/components/student-search-box";
import { isSearchActive } from "@/features/attendance/student-search";
import { useSubjectMaps } from "@/features/owner/operations-context";
import {
  HUB_SEARCH_LIMIT,
  groupHitsBySubject,
  hubEmptyMessage,
  hubSubjectHeading,
  hubTruncatedNote,
  type HubSearchResult,
} from "@/features/attendance/hub-search";
import { searchAttendanceHubStudents } from "@/features/attendance/server/hub-search-actions";
import { attHref } from "./att-href";
import { syncSearchSeedInUrl } from "./att-search-seed";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { classNameFor } from "@/features/teacher-view/class-name";

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
  const lang = useSheetLang();
  const t = useSheetT();
  const tf = useSheetTf();
  // 🔴 `run`이 useCallback이라 문구를 **밖에서 뽑아** 의존성에 넣는다(안에서 t()를 부르면 옛 언어로 굳는다).
  const errorText = t("att.search.error");
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
              error: errorText,
            });
            setLoading(false);
          });
      }, DEBOUNCE_MS);
    },
    [month, errorText],
  );

  // 🔴 과목 라벨·순서는 **학원설정이 단일 소스**다([[운영 enum 하드코딩 절대 금지]]).
  //    `(shell)/layout`이 OperationsProvider로 감싸므로 창(iframe) 안에서도 부모 prop 배선 없이 읽힌다.
  const subjects = useSubjectMaps();
  const subjectOrder = useMemo(() => subjects.options.map((o) => o.value), [subjects]);
  // 설정에 없는 과목 키는 `groupHitsBySubject`가 **맨 뒤**로 보낸다(사라지지 않는다).
  const groups = useMemo(
    () => (result ? groupHitsBySubject(result.hits, subjectOrder) : []),
    [result, subjectOrder],
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
        placeholder={t("att.search.ph")}
        // 18px 라벨(control-scale, v5) 기준 — 안내 문구가 잘리지 않는 폭(옛 12px 시절 116px).
        inputWidth="w-[168px]"
      />
      {open ? (
        // 🔑 넓은 화면 = **입력칸 바로 아래**(위 `sm:relative`가 기준, `right-0`으로 칸 오른쪽 끝에 맞춤)
        //    · 좁은 화면 = 종전대로 툴바 왼쪽(`left-4` = 툴바 px-4). 어느 쪽이든 툴바 줄 수는 그대로다.
        // ⚠️ `sm:left-auto`를 빼면 두 값이 함께 걸려 패널이 좌우로 늘어난다(폭 지정이 무시된다).
        <div className="border-line bg-card absolute top-full left-4 z-40 mt-1 w-[min(460px,calc(100vw-3rem))] rounded-2xl border p-2 shadow-lg sm:left-auto sm:right-0">
          {/* 🔴 결과가 없는 채로 다시 묻는 중이면 **"없습니다"라고 말하지 않는다** — 방금 친 말의 답이
              아직 안 왔을 뿐인데 못 찾았다고 하면 사람이 검색을 그만둔다. */}
          {loading && (!result || result.hits.length === 0) ? (
            <p className="text-text-dim px-2 py-3 text-xs">{t("att.search.loading")}</p>
          ) : result?.error ? (
            <p className="text-danger px-2 py-3 text-xs">{result.error}</p>
          ) : result && result.hits.length === 0 ? (
            <p className="text-text-dim px-2 py-3 text-xs break-keep">
              {hubEmptyMessage(query, result.where || t("att.search.where"), lang)}
            </p>
          ) : result ? (
            <>
              {/* 검색어를 바꾸는 동안엔 **옛 결과**가 잠깐 남는다 — 그 사실을 한 줄로 밝힌다
                  (아무 표시가 없으면 지금 목록이 방금 친 말의 답인 줄로 읽힌다). */}
              {loading ? (
                <p className="text-text-faint px-2 pb-1 text-xs">{t("att.search.loading")}</p>
              ) : null}
              {/* 🔑 **과목 그룹**(원장 2026-08-24 *"이런식으로 구분되게 · 과목 라벨을 붙이라는 소리임"*).
                  스크롤은 **바깥 한 곳**에만 둔다 — 그룹마다 스크롤을 주면 짧은 그룹이 각자 잘린다.
                  🔴 머리글 라벨은 학원설정이 단일 소스(`labelOf`) — 화면 파일에 과목 맵을 만들지 말 것. */}
              {/* 🔑 **열 맞춤 격자**(원장 2026-08-24 *"열너비 맞춤해서 흐트러지지 않게 · 지금 담임선생님
                     이름이 정렬 안되어있음"*). 종전엔 줄마다 flex라 반 이름 길이에 따라 담임 이름이
                     제각각 자리에 섰다 — 다섯 칸(이름·학교/학년·반·담임·요일)을 **한 격자**로 묶는다.
                  🔴 격자를 **패널 전체에 하나만** 둔다(그룹마다 두면 수학·영어 열 폭이 서로 어긋난다).
                     그래서 머리글·구분선도 이 격자의 `col-span-full` 칸이다.
                  🔴 줄어드는 칸은 **반 이름 하나**(`minmax(0,1fr)`) — 나머지는 `auto`라 내용만큼 서고,
                     특히 요일은 절대 잘리지 않는다(이번 요청의 본체).
                  ⚠️ 스크롤은 바깥 한 곳에만 — 그룹마다 주면 짧은 그룹이 각자 잘린다. */}
              <ul className="grid max-h-[min(46vh,360px)] grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-baseline gap-x-2 gap-y-0.5 overflow-y-auto px-1">
                {groups.map((g, gi) => (
                  <Fragment key={g.subject || "(unclassified)"}>
                    {/* 그룹이 하나뿐이어도 머리글은 그린다 — 글자를 치는 동안 줄이 튀지 않고,
                        지금 보는 게 무슨 과목인지 말해 준다.
                        구분선은 **그룹 사이에만** — 마지막 그룹 아래에 선이 남으면 잘린 목록처럼 읽힌다. */}
                    <li
                      className={`text-text-faint col-span-full px-2 pb-0.5 text-xs font-bold ${
                        gi > 0 ? "border-line mt-1.5 border-t pt-1.5" : ""
                      }`}
                    >
                      {hubSubjectHeading(g.subject, subjects.labelOf, lang)}
                    </li>
                    {g.hits.map((h) => (
                      <li key={`${h.classId}:${h.studentId}`} className="col-span-full grid grid-cols-subgrid">
                        <EmbedLink
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
                          className="hover:bg-bg-soft col-span-full grid grid-cols-subgrid items-baseline gap-x-2 rounded-lg px-2 py-1.5"
                        >
                          <span className="text-foreground text-sm font-bold">{h.studentName}</span>
                          {/* 🔴 값이 없어도 칸은 **비워서 그린다** — 안 그리면 그 줄만 열이 하나 밀린다. */}
                          <span className="text-text-faint text-xs">{h.schoolGrade}</span>
                          <span
                            className="text-text-dim min-w-0 truncate text-xs"
                            title={classNameFor(h.className, lang)}
                          >
                            {classNameFor(h.className, lang)}
                          </span>
                          <span className="text-text-dim text-xs">{h.teacherName ?? ""}</span>
                          {/* 🔑 **등원 요일**(원장 2026-08-24) — 한 학생이 여러 반이면 줄이 이름·학교·담임
                              까지 똑같아 보여 어느 줄이 어느 요일 반인지 구분이 안 됐다. 반 운영 요일이
                              아니라 **그 학생이 그 반에 오는 요일**이고(분리등원), 시트가 이름 아래
                              그리는 값과 같다.
                              🔴 빈 문자열이면 **글자를 안 그린다** — 그 달 유효 슬롯이 0인 활성 반이
                                 실제로 있어서, `—` 같은 자리표시를 두면 "요일이 없는 반"이 아니라
                                 고장으로 읽힌다(칸 자체는 열 맞춤 때문에 남긴다). */}
                          <span
                            // `pl-2` = 담임 이름과 붙어 한 덩어리로 읽히지 않게(열 간격만으론 좁다).
                            className="text-text-dim pl-2 text-right text-xs font-medium"
                            title={
                              h.attendLabel ? tf("att.search.attendDows", { dows: h.attendLabel }) : undefined
                            }
                          >
                            {h.attendLabel}
                          </span>
                        </EmbedLink>
                      </li>
                    ))}
                  </Fragment>
                ))}
              </ul>
              {/* 🔴 잘랐으면 **밝힌다** — 상한을 숨기면 "그 학생은 없다"는 거짓말이 된다([[#89]]). */}
              {result.truncated ? (
                <p className="text-amber border-line mt-1 border-t px-2 pt-1.5 text-xs">
                  {hubTruncatedNote(result.limit, lang)}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-text-dim px-2 py-3 text-xs">{t("att.search.loading")}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
