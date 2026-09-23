# 학원 설정 — 배선 현황·미구현

> CLAUDE.md '학원 설정'에서 옮긴 원문이다(2026-09-23).

### 배선 현황 (2026-06-19 Phase 1·2 픽스 후 — "동작 예시" 인용 시 ✅만)
- **✅ 배선 완료**: profile `name`·`branchLabel`·`logoText`, operations `subjects`·`jobTitles`·`gradeLevels`·
  `weekdayPeriods`·`weekendPeriods`·`holidays`, billing `dueDay`, notifications `printHeader` (기존) +
  **Phase 1·2 신규**: profile `brandColor`(layout가 `--primary` 등 CSS 변수 주입, `src/lib/color-utils.ts`),
  profile `representativeName`·`phone`·`email`·`address` + billing `latePolicy`(등록 인쇄물 푸터/안내,
  `(print)/enrollment/[id]/print`), notifications `alimtalkSenderKey`(kakao `pf_id` 지연 폴백, `messaging/provider.ts`)·
  `googleSheetId`(시트 동기 폴백, `integrations/server/{actions,queries}.ts`).
  - ~~⚠️ 영어 교시는 여전히 `ENGLISH_PERIODS` 하드코딩~~ → **✅ 해소(2026-07-06)**: 과목 운영 탭 `subjects[].weekdayPeriods`로 과목별 설정 가능(미설정=english 내장→전역 폴백).
  - **(2026-07-20) 비로그인(pre-auth) 표면도 배선 완료** — 로그인 화면·루트 탭 제목이 제품 기본값/하드코딩 "인재원"이던 것을
    [`getPublicBranding()`](src/features/owner/server/public-branding.ts)로 전환(profile `logoUrl`·`logoText`·`name`·`branchLabel` 소비).
    ⚠️ **로그인 전엔 세션이 없어 테넌트를 모른다** — 그래서 이 헬퍼는 "어느 지점"이 아니라 **회사 브랜드 학원** 하나를
    고른다(2026-09-18 갱신, 결정 로그 "멀티테넌트 URL = C안" 참조): 학원이 1개면 그 학원, 2개 이상이면 env
    `PUBLIC_BRAND_TENANT_SLUG`의 학원, 아니면 **null → 제품 중립 표기**(임의 선택 = 남의 학원 이름 노출). 지점을 알아야 하는
    비로그인 화면(자리 PIN)은 `listPublicBranchChoices`로 고르게 하고, 지점이 정해진 뒤엔 `getPublicBrandingByTenantId`.
    새 비로그인 화면에서 학원 브랜드가 필요하면 `getTenantSettings()`(세션 필요, 여기선 빈 값)가 아니라 **이 헬퍼**를 쓸 것.
  - **(2026-06-19) operations `subjects`/`gradeLevels` 하드코딩 소비처 전수 배선 완료(20건/17파일)** — 멀티에이전트
    전수감사로 "설정 무시" 위반 20건 적발·수정. 첫 발견은 학생목록·수업목록·성적관리 과목 드롭다운에 설정에 없는
    "예술(arts)" 누출(`SUBJECT_FILTERS`/`SUBJECT_META`)이었고, 이어 과목 라벨/색/선택지/엑셀출력을 하드코딩한
    14개 추가 파일을 전부 설정 기반으로 전환. **클라 단일 소스 신설**: `(shell)/layout`이 3경로(embed창·미니셸·풀셸)를
    [`OperationsProvider`](src/features/owner/operations-context.tsx)로 감싸 `useSubjectMaps()`/`useGradeLevels()`
    훅 제공(클라는 부모 prop 배선 불필요·창 안까지 커버). 서버는 `buildSubjectMaps(getTenantSettings)` 직접.
    수정 파일: dashboard `now-cockpit`(+`subject-meta.ts`는 시간헬퍼만 남기고 과목 라벨/색 제거)·`student-summary-view`·
    `student-quick-popover`·`classes/[id]`·`enrollment-assign-dialog`·`convert-dialog`·`withdrawals`·`timetable/page`(SUBJECT_ORDER
    닫힌 enum→설정 도출)·`class-cell`·`level-tests`·`catalog-table`(과목만; 학년 초/중/고는 교재 coarse 버킷이라 유지)·
    `exam-form-dialog`·`staff/[id] basic-info`·`exports/{timetable,students}-excel`·`students/_components/student-filter-bar`(학년필터).
    **규칙은 위 "⚠️⚠️ 운영체계 enum 하드코딩 절대 금지" 섹션 참조.** 새 목록/필터/표시는 반드시 그 단일 소스로 — native 하드코딩 과목/학년 맵 금지.
- **🚫 입력 숨김(소비처 없어 v1 비노출 — 상태·스키마·저장은 보존, 소비처 생기면 입력만 복원)**: operations `terms`,
  billing `taxMode`·`defaultMethod`(invoices에 결제수단 컬럼 없음), notifications `kakaoChannelId`(발송 경로에 미사용·대응 컬럼 없음).
- **✅ 배선 완료(2026-06-23)**: notifications `privacyTerms`·`serviceTerms` → **학부모 QR 공개접수 폼**(`(intake)/intake/[token]`)의
  개인정보/환불·학칙 동의 블록으로 소비(notifications-section에 TextAreaField 입력 복원). + operations `shuttle`
  (enabled/fee/routes 신규) → 공개접수 폼 셔틀 섹션으로 소비(operations-section `ShuttleEditor`). 둘 다 owner 폼 저장 →
  공개 폼 즉시 반영(실검증: fee "월 35,000원" 저장→공개폼 반영). ⚠️ 공개 폼은 인재원 데모 정적 텍스트를 더 이상
  하드코딩하지 않고 전부 학원설정에서 읽음(소비처 0 orphan 해소).

### DB가 필요한데 없는 것 (jsonb로 못 담는 것 포함)
`tenant_settings.data`는 텍스트/숫자/배열만 담는다 — **이미지·파일은 Supabase Storage 버킷이 별도 필요**:
- 로고 **이미지**(현재 `logoText` 텍스트 워드마크뿐)·직인/도장 이미지 → Storage 버킷 + `…profile.logoUrl`/`sealUrl` 경로.
- 사업자등록번호·운영시간(영업시간, 교시와 별개) → jsonb 필드 추가만으로 가능(스키마 확장).
- ~~**과목별 교시 세트**~~ → **✅ 완료(2026-07-06)**: `subjects[].weekdayPeriods`(jsonb, 마이그 0) + 과목 운영 탭 편집기
  + `weekdayTableFor` 폴백 체인(과목 전용→english 내장→전역). 시간표 기본뷰·통합뷰·강사뷰·학생 상세 라벨 전부 소비.
- **역할/권한 편집**(현재 `permissions.ts` 코드 하드코딩 — ijw 패리티 갭) → `tenant_role_permissions` 테이블 또는
  `…data.permissions` jsonb + 편집 UI(RLS와의 경계 설계 필요).

---
