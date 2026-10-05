# 학원 설정 정리 적대적 코드 리뷰 4

검토일: 2026-10-06. 기준: `8b5231423` 위의 미커밋 P2-A·P2-B 변경, PLAN §2·§7 및 `docs/decisions/settings-wiring.md`의 면 목록 계약. 소스는 수정하지 않았다. 차단 0건, 중요 0건, 경미 2건이며 경미 항목은 후속으로 처리할 수 있다.

## 발견 사항

| 번호 | 심각도 | file:line | 구체적 실행 경로(입력 → 잘못된 결과) | 수정 제안 |
| --- | --- | --- | --- | --- |
| C1 | 경미 | `src/features/owner/face-access.ts:45`, `src/features/owner/tabs.ts:76`, `src/app/(shell)/owner/page.tsx:143`, `src/app/(shell)/owner/page.tsx:283`, `src/features/owner/face-access.test.ts:87` | 실제 역할이 원장이 아닌 위임 계정에 `owner=full`, `navigation_settings=full`, `profile_settings=none`, 그 밖의 개별 설정 키는 `none`을 부여하고 `/owner`를 연다. 후보 목록에서 역할·권한이 메뉴 구성보다 앞서므로 `/owner?tab=permissions`로 보내지만, 이 계정에게 그 본문은 안내뿐이다. 메뉴 구성은 실제로 편집할 수 있어도 탭을 한 번 더 눌러야 한다. 무한 redirect·권한 확대·저장 실패는 아니므로 커밋 차단 사항은 아니다. 새 테스트는 오히려 이 안내 면을 후보로 기대하면서 describe에는 ‘안내 문구뿐인 면으로 보내지 않는다’고 적었다. | 후속으로 fallback 후보에서는 안내뿐인 역할·권한보다 사용 가능한 면을 우선하도록 하거나, 테스트의 계약 설명을 실제 동작에 맞춘다. 직접 요청한 권한 있는 면을 안내로 남기는 정책은 유지한다. 역할·권한 본문의 조건은 **실제 역할이 원장인지**이므로, 이 보정에 `isMasterLevel`만 재사용하면 관리자 역할인 운영자 계정도 여전히 안내로 갈 수 있다. |
| C2 | 경미 | `src/lib/menu-hub.ts:225`, `src/components/icons/menu-glyph.test.ts:50`, `src/components/icons/menu-glyph.test.ts:93`, `src/features/owner/tabs.test.ts:87` | 기존 `icon: "tag"` 등의 리터럴을 `OWNER_FACE_ICON`의 `subjects: "tag"` 등으로 옮겼다. 기존 그림 가드는 `icon: "…"`만 추출하므로 이 표의 직접 문자열 7개를 더는 검사하지 않는다. 예를 들어 후속 변경에서 `subjects: "history"`를 넣으면 감사로그와 그림이 같아져도 두 줄 모두 기존 추출기에 잡히지 않고, 새 테스트의 ‘부모 톱니와 다름’ 검사도 통과한다. 현재 그림 자체는 이전 값과 같지만, 이번 추출로 기존 회귀 가드가 약해졌다. | 후속으로 실제 파생 목적지의 아이콘을 수집해 그림 존재·중복을 검사하거나, 별도 표도 추출하게 가드를 수정한다. `sync`의 기존 동일 목적지 예외는 유지한다. `menu-hub.ts:222`의 가드 설명도 그때 함께 확인한다. |

## 이 변경으로 달라지는 화면

### 공통 배치·명칭

설정 메뉴 판의 기본 배치는 아래처럼 바뀐다. 사용자 지정 배치가 없고 모든 해당 면을 볼 수 있는 계정 기준이다. 기존 메뉴 판은 프로필 → 메뉴 구성 → 대시보드 구성 → 기능 → 운영 체계 → 과목 운영 → 수납 → 알림 → 상담 → 팝업 → 역할·권한 → 데이터 정리 → 가져오기 → 감사로그 → 연동 순이었다. 근거: `8b5231423:src/lib/menu-hub.ts:238`부터의 기존 목록, 새 `src/features/owner/tabs.ts:69`, `src/lib/menu-hub.ts:264`.

| 새 묶음 제목 | 기본 버튼 순서 | 기존 대비 이동 |
| --- | --- | --- |
| 학원 정보 | 프로필·브랜드 | 메뉴 구성·대시보드·기능이 권한·화면으로 이동 |
| 수업·운영 | 운영 체계 → 과목 운영 | 버튼 순서는 같고 전체 목록에서는 학원 정보 바로 뒤 |
| 청구·안내 | 수납·청구 → 알림·약관 → 상담 양식 | 팝업 공지가 관리로 이동 |
| 권한·화면 | 역할·권한 → 탭 및 메뉴 구성 → 기능 → 대시보드 관리 | 기존 계정·권한 묶음을 확장; 기능은 일반판의 조건 충족 계정에게만 표시 |
| 관리 | 팝업 공지 → 데이터 정리 → 데이터 가져오기 → 감사로그 → 연동 | 기존 시스템 묶음 이름 변경 및 팝업 공지 합류 |

- 화면 상단 탭의 면 순서는 이전과 같다. 기능의 위치도 메뉴 구성 뒤·대시보드 앞이다. 새 범주 5개는 메뉴 판의 묶음이며, 상단 탭의 기존 `설정/관리` group을 바꾸지 않는다. `src/features/owner/tabs.ts:70`, `src/features/owner/tabs.ts:80`, `src/features/owner/tabs.ts:87`, `src/app/(shell)/owner/page.tsx:60`.
- ‘대시보드 구성’이 ‘대시보드 관리’로 바뀐다. 상단 탭·사이드바 하부탭·메뉴 판·그 정의를 사용하는 검색 결과·모바일 메뉴의 목적지 이름과 해당 페이지 문서 제목에 반영된다. `src/features/owner/tabs.ts:85`, `src/features/owner/tabs.ts:105`, `src/lib/navigation.ts:153`, `src/components/command-palette.tsx:112`, `src/components/mobile-top-nav.tsx:74`, `src/app/(shell)/owner/page.tsx:102`.
- 각 면의 그림은 기존과 같다. 별도 표로 이동했을 뿐이다. 예전 리터럴은 `8b5231423:src/lib/menu-hub.ts:249`·`:251`·`:256`·`:257`·`:260`·`:266`·`:269`, 새 표는 `src/lib/menu-hub.ts:225`에 있다. 다만 그림 가드의 추출 누락은 C2다.
- 기존 `href`가 유지되므로 사용자 지정 `order/hidden` 행이 다른 면에 붙거나 초기화되지 않는다. 고정 목적지의 이동·이름·그림 변경 제한도 유지된다. 저장 순서는 계속 적용되지만 **메뉴 판은 새 범주로 다시 묶이므로 범주를 가로지르는 시각적 배치는 달라진다**. 묶음 제목은 정렬된 항목에서 처음 나타난 범주 순서이며, 항목 없는 범주는 서지 않는다. `src/features/owner/menu-layout.ts:67`, `src/features/owner/menu-layout.ts:78`, `src/features/owner/menu-layout.ts:127`, `src/lib/menu-hub.ts:362`, `src/lib/menu-hub.ts:371`, `src/components/workspace/menu-hub-panel.tsx:68`.

### 계정·학원 종류별 변화

| 계정·조건 | 달라지는 것 | 근거 |
| --- | --- | --- |
| 원장, 일반판 | 기본 메뉴 판은 새 5개 범주·순서·명칭으로 표시되고 기능 면을 포함한다. 기능의 직접 주소는 이제 `owner`로 판정한다. 상단 탭에 새 면이 추가되지는 않는다. | `src/features/owner/tabs.ts:82`, `src/app/(shell)/owner/page.tsx:115`, `src/app/(shell)/owner/page.tsx:224` |
| 원장, 침산(프리셋 없음 포함) | 같은 배치·명칭 변경을 받으며 기능 버튼은 생기지 않는다. 직접 `?tab=modules`로 와도 프로필로 해석한 뒤 그 면의 권한을 검사한다. | `src/features/owner/tabs.ts:101`, `src/app/(shell)/owner/page.tsx:75`, `src/app/(shell)/owner/page.tsx:115`, `src/lib/menu-hub.ts:320` |
| 원장 위 계정이면서 실제 역할은 관리자 | 전용 면 표시는 실제 역할뿐 아니라 운영자 표식도 반영해 유지된다. 단, 일반판 기능의 직접 주소를 종전 `profile_settings`에서 `owner`로 바꿨으므로 **개별 설정은 자동 부여되지만 `owner`가 없는 계정은 종전에 가능했던 기능 직접 진입을 잃고 열 수 있는 다른 면으로 이동한다**. 이는 이번 명시된 권한 키 변경의 실제 영향이다. 역할·권한 본문이 원장 전용인 기존 조건은 그대로다. | `src/lib/auth/perm-matrix.ts:104`, `src/lib/settings-role-catalog.ts:7`, `src/app/(shell)/owner/page.tsx:115`, `src/app/(shell)/owner/page.tsx:128`, `src/app/(shell)/owner/page.tsx:143`, `src/components/app-sidebar.tsx:241` |
| 원장이 아닌 위임 계정 | 사이드바·설정 메뉴 판·검색 팰릿·모바일 목적지에서 대시보드 관리와 기능 버튼이 빠진다. 상단 탭은 이전에도 두 면을 숨겼으므로 그 부분은 변화가 없다. 권한 키가 있는 직접 주소에는 기존 안내가 남으며 편집 폼은 열리지 않는다. | `8b5231423:src/lib/menu-hub.ts:246`, `8b5231423:src/lib/menu-hub.ts:249`, `src/features/owner/tabs.ts:82`, `src/features/owner/tabs.ts:85`, `src/lib/menu-hub.ts:319`, `src/app/(shell)/owner/page.tsx:308`, `src/app/(shell)/owner/page.tsx:322` |
| 개별 설정만 위임받았고 프로필 권한은 없는 계정 | 기본 `/owner` 또는 권한 없는 면 주소로 들어가면 운영실로 보내는 대신 열 수 있는 첫 면으로 이동한다. 예: 운영 설정만 있는 계정은 운영 체계로 이동한다. 요청한 면 권한이 이미 있으면 이동하지 않는다. `readonly`·개인별 예외도 같은 최종 권한 표로 판단한다. | `src/app/(shell)/owner/page.tsx:121`, `src/features/owner/face-access.ts:35`, `src/features/owner/face-access.ts:43`, `src/features/owner/face-access.test.ts:37`, `src/features/owner/face-access.test.ts:47`, `src/features/owner/face-access.test.ts:52` |
| 설정 읽기 전용이면서 다른 메뉴의 전체 권한이 있는 계정 | 데이터 가져오기에서 해당 메뉴의 엑셀 버튼을 이제 누를 수 있다. 가져오기는 설정 쓰기 권한이 아닌 각 가져오기 대상 메뉴의 전체 권한을 검사한다. 감사로그를 볼 자격이 있는 읽기 전용 계정은 기간·검색 입력을 사용할 수 있다. 두 면에는 설정 ‘읽기 전용입니다.’ 안내가 빠진다. 일반 설정 폼의 잠금은 유지한다. | `src/app/(shell)/owner/page.tsx:229`, `src/app/(shell)/owner/page.tsx:349`, `src/app/(shell)/owner/page.tsx:362`, `src/app/(shell)/owner/_components/import-hub-face.tsx:19`, `src/features/excel-import/server/run.ts:24` |
| 데이터 정리 권한만 별도로 가진 계정 | 데이터 정리는 1단계에서 이미 fieldset 밖에 있었으므로 이번에 정리 버튼의 권한이 바뀌지 않는다. 기본 입구 fallback을 통해 도달하는 방식은 달라질 수 있다. | `src/app/(shell)/owner/page.tsx:180`, `src/app/(shell)/owner/page.tsx:355`, `src/features/owner/face-access.ts:45` |
| 강사 미니셸·다른 강사 보기 | 미니셸의 기존 상위 게이트를 먼저 지나야 한다. 개별 설정이 실제 계정과 강사 역할 모두에 위임된 경우에만 설정 경로가 상위 게이트를 통과하며, 페이지는 실제 행위자 권한으로 fallback을 고른다. 다른 강사 보기의 쓰기 금지는 그대로다. | `src/app/(shell)/layout.tsx:218`, `src/app/(shell)/layout.tsx:221`, `src/app/(shell)/owner/page.tsx:121`, `src/lib/auth/perm-matrix.ts:136` |
| 로그인하지 않은 계정·열 수 있는 면이 없는 계정 | 로그인하지 않으면 기존 로그인 redirect, 후보가 없으면 기존 `requireAccess`의 역할 홈 처리다. 새로운 폼이나 조회 권한을 얻지 않는다. | `src/app/(shell)/owner/page.tsx:122`, `src/app/(shell)/owner/page.tsx:135`, `src/features/owner/face-access.ts:45`, `src/lib/auth/require-access.ts:22`, `src/lib/auth/require-access.ts:28` |

일반판 기능 주소의 추가 차이: `owner`는 있고 `profile_settings`는 없는 위임 계정은 이제 직접 주소에서 기능 안내를 볼 수 있지만 편집할 수 없다. 반대로 프로필만 있고 `owner`가 없으면 종전에 직접 주소에서 보던 기능 안내 대신 다른 허용 면으로 이동한다. 메뉴 버튼은 두 경우 모두 전용 면 필터가 숨긴다. `src/app/(shell)/owner/page.tsx:115`, `src/features/owner/face-access.ts:44`, `src/app/(shell)/owner/page.tsx:308`.

## 확인했고 문제 없음

- **목록 파생**: 화면 탭은 `OWNER_FACES`, 사이드바 하부탭·도움말은 일반판 전용 면을 뺀 `OWNER_TABS`, 설정 메뉴 판은 `OWNER_FACES.map`으로 만들어진다. 권한 키는 기존 주소 해석기를 사용하고, 아이콘은 클라이언트에서도 읽을 수 있는 별도 표다. `src/app/(shell)/owner/page.tsx:60`, `src/lib/navigation.ts:153`, `src/features/help/manual-toc.test.ts:38`, `src/lib/menu-hub.ts:264`, `src/lib/menu-hub.ts:88`.
- **침산에 기능 버튼이 새로 서지 않음**: 공용 하부탭·도움말에서 제외되고, 실제 사이드바·허브·팰릿·모바일은 `genericOnly`를 거른다. 자주 방문한 메뉴도 같은 `allowed`를 거치며, 방문 키를 부모 메뉴 주소로 찾으므로 새 기능 면을 별도로 만들지 않는다. 메뉴 구성 편집기는 고정 목적지를 편집 후보에서 제외하므로 새 기능 편집 행도 생기지 않는다. `src/features/owner/tabs.ts:101`, `src/lib/menu-hub.ts:320`, `src/components/command-palette.tsx:104`, `src/lib/menu-hub.ts:390`, `src/lib/menu-hub.ts:393`, `src/app/(shell)/owner/_components/admin-menu-editor.tsx:23`.
- **전용 면 조건의 호출부 정합**: 사이드바·허브·팰릿·모바일 모두 원장 역할 또는 운영자 표식으로 `Gate.isMaster`를 넘기며 일반판 여부도 넘긴다. 일반 역할인 운영자 계정이 단지 역할 이름 때문에 새 `masterOnly` 필터에서 빠지는 경로는 없다. 메뉴 접근 권한 자체는 별도로 필요하다. `src/components/app-sidebar.tsx:235`, `src/components/workspace/menu-hub-panel.tsx:56`, `src/components/command-palette.tsx:104`, `src/components/mobile-top-nav.tsx:70`, `src/lib/menu-hub.ts:317`.
- **주소·타입·제목**: 기존 면의 href·키는 유지되고, 일반판 전용 키는 넓힌 `OwnerFaceKey`에서만 다룬다. `resolveOwnerTab`은 여전히 공용 allowlist만 인정하며, 기능은 페이지의 일반판 검사로만 열린다. metadata와 본문은 같은 `effectiveTab` 판정을 쓰며 실제 fallback 뒤 목적지 요청에서 제목도 바뀐다. `src/features/owner/tabs.ts:30`, `src/features/owner/tabs.ts:110`, `src/app/(shell)/owner/page.tsx:75`, `src/app/(shell)/owner/page.tsx:98`, `src/app/(shell)/owner/page.tsx:149`.
- **redirect 반복·새 권한 부여 없음**: 안정된 동일 권한 상태에서 후보는 자신을 제외하고 같은 `canAccess`를 만족하는 면만 고른다. 목적지에서도 같은 최종 표를 사용하는 `requireAccess`를 통과하므로 제 주소·양방향 반복 또는 후보가 다시 권한 없음으로 운영실에 가는 경로가 없다. 요청 사이 권한 자체가 바뀌는 것은 이 보장의 전제가 달라지는 경우다. `src/features/owner/face-access.ts:35`, `src/features/owner/face-access.ts:44`, `src/app/(shell)/owner/page.tsx:124`, `src/lib/auth/require-access.ts:23`.
- **전용 면 직접 요청 처리**: 메뉴 권한이 있는 직접 요청은 redirect하지 않는 명시된 정책이다. 일반 위임 계정의 대시보드·감사로그 요청은 본문에서 안내로 바뀌며, 대시보드 스냅샷·감사 조회 컴포넌트는 호출되지 않는다. 메뉴 권한이 없는 계정은 허용 면으로 보내거나 기존 가드가 처리한다. `src/features/owner/face-access.ts:44`, `src/app/(shell)/owner/page.tsx:322`, `src/app/(shell)/owner/page.tsx:365`.
- **후보 경계·embed**: 알 수 없는 원시 tab은 공용 allowlist에서 프로필로 해석되고, 공용 목록에 없는 기능은 일반판 검사 후에만 요청 키가 된다. 후보가 없으면 null, readonly도 읽기 후보, `embed=1`은 기본 주소에는 `?`, tab 주소에는 `&`로 유지된다. `src/features/owner/tabs.ts:110`, `src/app/(shell)/owner/page.tsx:115`, `src/features/owner/face-access.ts:43`, `src/features/owner/face-access.ts:49`, `src/features/owner/face-access.test.ts:119`.
- **인증·조회 순서**: 옛 report_mgmt/report/ai_ment/sessions redirect와 dup 흡수는 종전 위치·주소를 유지한다. 로그인 없는 요청은 fallback 계산에 들어가지 않는다. 평소 경로의 추가 함수 호출은 요청 캐시된 사용자·권한 표·설정 읽기를 공유한다. 추가 DB 라운드트립이 생기는 코드는 찾지 못했다. 실측 쿼리 수는 DB 접속 금지로 **미확인**이다. `src/app/(shell)/owner/page.tsx:108`, `src/app/(shell)/owner/page.tsx:79`, `src/app/(shell)/owner/page.tsx:121`, `src/lib/auth/current-user.ts:25`, `src/lib/auth/perm-matrix.ts:82`, `src/features/owner/server/queries.ts:82`, `src/lib/auth/super-admin.ts:45`.
- **PIN·기존 저장 계약**: fallback/allowedTabs 일반화는 운영 섹션을 전달하지 않는다. 운영 편집 읽기·token 생성은 여전히 실제 운영 면이면서 운영 쓰기가 가능한 경우에만 수행되고, 열람자 payload는 PIN을 지운다. 권한 면의 fresh 읽기가 운영 token을 새로 생성하는 경로도 없다. 이번 변경에 저장 액션·draft 훅 수정은 없다. `src/app/(shell)/owner/page.tsx:157`, `src/app/(shell)/owner/page.tsx:167`, `src/app/(shell)/owner/page.tsx:171`, `src/app/(shell)/owner/page.tsx:172`.
- **자체 게이트 면 이동**: 가져오기 버튼과 업로드 서버는 동일한 `canManageTenant(def.menu)`를 쓴다. audit는 조회 조건 입력이며 새 변이 버튼이 없다. 일반 설정 fieldset은 유지되고, 데이터 정리의 별도 변이 게이트도 그대로다. `src/app/(shell)/owner/_components/import-hub-face.tsx:19`, `src/features/excel-import/server/run.ts:21`, `src/app/(shell)/owner/_components/audit-face.tsx:119`, `src/app/(shell)/owner/page.tsx:180`, `src/app/(shell)/owner/page.tsx:230`.
- **새 사용자 문구**: 새 범주명·대시보드 명칭·입구 정리는 일반 지점 화면에 내부 역할 코드나 우회 설명을 새로 붙이지 않는다. 직접 주소의 기존 권한 안내 문구는 P2-C 범위라 이번 발견 사항으로 올리지 않았다. 새 주석의 ‘메뉴 판 주소·권한·화면은 그대로’는 모든 변경을 포괄하는 설명으로 읽으면 부정확하다. 정확한 차이는 위 계정별 표와 PLAN §7에 적힌 masterOnly·기능 권한 키 변경이다. `src/features/owner/tabs.ts:69`, `src/lib/menu-hub.ts:261`, `src/app/(shell)/owner/page.tsx:114`.

## 테스트 검토·실행

다음 10개 특정 파일만 실행했고 **134개 테스트가 통과**했다. `--no-cache`를 사용하지 않았다. dev 서버·빌드·DB·네트워크·프로덕션 스크립트는 실행하지 않았다.

```text
npx --no-install vitest run src/features/owner/face-access.test.ts src/features/owner/tabs.test.ts src/lib/menu-hub.test.ts src/features/owner/menu-layout.test.ts src/features/owner/navigation-customization.test.ts src/components/icons/menu-glyph.test.ts src/features/help/manual-toc.test.ts src/lib/auth/settings-permissions.test.ts src/features/audit/audit-read-gate.test.ts src/features/search/palette-wiring.test.ts
```

- 새 순수 함수 테스트는 개별 설정 위임·읽기 전용·개인 예외·전용 면·일반판/침산·후보 없음·embed를 실제 함수 호출로 검증한다. 같은 후보 순서와 요청 권한이 있는 경우의 null도 검사한다. 목록 테스트는 실제 `SUPPORT_GROUPS`·`SUBTABS_BY_MENU`를 가져와 주소·명칭·범주·표식·순서를 대조하므로 단순 소스 문자열 검사만은 아니다. `src/features/owner/face-access.test.ts:37`, `src/features/owner/face-access.test.ts:47`, `src/features/owner/face-access.test.ts:52`, `src/features/owner/face-access.test.ts:66`, `src/features/owner/face-access.test.ts:93`, `src/features/owner/face-access.test.ts:119`, `src/features/owner/tabs.test.ts:67`, `src/features/owner/tabs.test.ts:81`.
- 실제 페이지의 redirect 순서·allowedTabs·fieldset 위치 검사는 소스 문자열/인덱스 단언이다. 로그인·강사 미니셸·metadata·실제 서버 페이지 실행을 통한 검증과 요청당 DB 쿼리 수 실측은 **미확인**이다. 이번 검토는 해당 연결을 코드로 추가 대조했다. C1은 새 테스트의 기대값에 이미 들어 있어 현재 테스트로는 UX 문제가 잡히지 않고, C2도 기존 가드 통과만으로는 해소되지 않는다. `src/features/owner/face-access.test.ts:127`, `src/features/owner/face-access.test.ts:150`, `src/features/owner/tabs.test.ts:85`.

판정: 커밋 가능
