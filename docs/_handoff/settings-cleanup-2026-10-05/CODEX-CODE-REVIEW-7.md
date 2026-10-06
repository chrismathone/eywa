# 적대적 코드 리뷰 7

보강 운영 면 분리·강의실/공휴일 접기만 검토했다. 차단 0건·중요 0건·경미 2건이다. 테스트·서버·DB·브라우저 실행은 하지 않았다.

| 번호 | 심각도 | file:line | 구체적 실행 경로 | 수정 제안 |
|---|---|---|---|---|
| C1 | 경미 | `src/app/(shell)/owner/_components/modules-section.tsx:42`; `src/app/(shell)/owner/page.tsx:247` | 일반판 원장이 ‘기능’의 ‘보강관리 운영 모드 설정’을 누르면 여전히 `tab=operations`로 간다. 보강 폼은 이제 `tab=makeups`에만 있어 링크가 지목한 설정이 없다. 새 탭으로는 접근 가능하다. | 링크를 `/owner?tab=makeups`로 변경하고 링크 목적지도 검증한다. |
| C2 | 경미 | `src/app/(shell)/owner/_components/settings-collapse.test.tsx:36`; 같은 파일 `:56` | ‘저장에 실린다’ 테스트는 이름 없는 입력의 초기 값·위치만 검사한다. 펼침 테스트도 `details.open = true` 뒤 같은 값을 확인하므로 제출 누락이나 실제 클릭 취소를 검증하지 않는다. 현재 저장 코드의 결함은 발견하지 못했다. | 후속으로 실제 `OperationsSection`에서 휴일 수정→접기→저장한 payload·미저장 기준을 확인한다. 직접 `open` 대입 사례는 DOM 구조 확인으로 이름을 좁힌다. |

확인한 실행 경로:

- **권한:** 새 면은 `owner` 게이트·쓰기 잠금 뒤 `canReadAudit`일 때만 폼을 세운다(`face-access.ts:16`, `page.tsx:130`, `:142`, `:226`, `:247`). 저장도 종전부터 `owner` 쓰기와 원장급 판정을 모두 요구했다(`server/actions.ts:110`, `:150`; `src/features/makeups/server/settings.ts:16`). 운영 설정만 위임받은 계정에게 폼이 새로 열리지 않는다. 원장급이어도 `owner` 쓰기가 없으면 전부터 저장은 거절됐다.
- **입구·주소:** 목록의 `masterOnly`가 탭·메뉴 판으로 전달되며 침산 목록은 15면이다(`tabs.ts:77`, `:106`; `page.tsx:220`; `menu-hub.ts:267`, `:326`). 대신 보내기도 권한 있는 후보만 고르고 도착 후 다시 게이트를 지난다(`face-access.ts:53`; `page.tsx:130`). 새 면만을 위한 게이트 우회는 없다.
- **소비처:** 하부탭·주소 해석·제목·이용 분석은 목록에서 파생한다(`navigation.ts:153`; `tabs.ts:111`, `:116`; `page.tsx:97`; `src/features/usage/labels.ts:42`). 새 주소는 메뉴 구성의 알려진 주소·고정 목적지에 포함되고, 창은 기존 `owner` 창이며 자주 방문 집계에서는 제외된다(`settings-types.ts:663`; `menu-layout.ts:68`; `window-link.tsx:79`; `menu-visits.ts:29`). 빠진 직접 링크는 C1이다.
- **접힌 입력:** 공휴일 입력에 `required`·범위 제한이 없고 값은 계속 draft에 들어간다(`list-editors.tsx:423`; `operations-section.tsx:65`, `:153`). 제출은 payload JSON, 두 편집 가드는 숨은 JSON을 포함한 `FormData`를 읽는다(`section-form.tsx:95`, `:98`, `:171`; `src/lib/realtime/form-snapshot.ts:10`). 강의실 필수 입력은 별도 폼이며 운영 폼 밖이다(`classroom-manager.tsx:33`, `:73`; `section-form.tsx:175`, `:178`). 이 폼들에 로컬 초안 자동저장 훅을 새로 연결하거나 제거한 변경은 없다.
- **접힘·문서:** `details`의 첫 자식이 `summary`이며 입력을 조건부로 제거하지 않는다(`section-form.tsx:221`). `rebaselineNonce`는 가드 기준만 바꾸고 remount하지 않아 저장으로 펼침이 초기화되지 않는다(`:147`); 다시 마운트하면 접힌다. 운영 설명서의 번호 대상은 접힌 두 카드 안에 없다(`docs/manual/pages/owner/operations.json:5`). 보강의 모드·읽기 전용 과목 안내와 켜짐 시 메뉴 복원은 실제 폼·RPC와 맞는다(`makeups-section.tsx:21`, `:28`; `supabase/migrations/0346l_makeup_cmd_configure.sql:80`). 네이티브 키보드·브라우저 검증의 실측은 미확인이다.

판정: 커밋 가능
