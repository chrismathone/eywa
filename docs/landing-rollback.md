# 공개 랜딩·로그인 되돌리기 (rollback)

공개 화면(`/`·`/login`)은 2026-09-22 하루에 세 번 바뀌었다. **이전으로 되돌릴 수 있게** 기준점과 명령을 여기 한 곳에 적어 둔다
(원장 2026-09-22 *"다 기억해놓으라는거야. 이전으로 롤백가능하게"*). 옛 코드 사본은 따로 두지 않는다 — git이 원본이다.

| 판 | 내용 | 기준 커밋 |
|---|---|---|
| **(A) 어제까지 운영하던 판** | 어두운 네이비 히어로·제품 쇼케이스 랜딩 + 사진 패널 로그인 | `4ec22cae9abdc91e0852bcdcbefddb3ffcdf335e` (2026-09-22 16:00, 재설계 직전 main) |
| **(B) 오늘 낮 판** | 흰 면·초록 톤 '학원 도입' 랜딩 + 두 칸 로그인 | `ee7cc124` (3+5 병합 시점의 origin/main) |
| **(C) 스크롤 판** | 애플식 긴 스크롤 랜딩 + 오늘 낮 판 구성·네이비 로그인(무음 영상) | `e63f1ae63` (2026-11-10, (D) 직전 main — 랜딩은 09-28 이후 그대로) |
| **(D) 지금 판** | AI원장키트 플래그십(라임 히어로 · 세 제품 가로 쇼룸 · 학원 비서 장면 · 업무별 메뉴 목록 · 운영 현황 비교) — (C)의 장면을 같은 팔레트로 다시 칠함 · 로그인은 (C) 그대로 | 이 줄을 담은 커밋 |
| (참고) 3+5 판 | 모형 속 작업 공간(섞기 3+5) — main에 **올라간 적 없다**(원장이 스크롤 시안으로 바꿈) | `a1277366`(브랜치 커밋, 병합으로 main 이력에 남는다) |

> ⚠️ (B)는 **병합 시점의 origin/main**(2026-09-22 19:45, `ee7cc124`)이다. 그날 낮의 `8247b4a1`과 공개 화면 파일이
> **한 글자도 다르지 않다**(그 사이 커밋은 성적·서류·셔틀·운영실만 건드렸다 — `git diff 8247b4a1...ee7cc124 -- "src/app/(marketing)" …` 가 빈 결과).
> 병합이 더 미뤄져 main이 또 나가면 그때의 SHA로 이 줄을 고칠 것 — 그 사이 커밋이 공개 화면을 안 건드렸으면 상관없다.

## 판마다 어떤 파일이 그 판을 이루나

- `src/app/(marketing)/**` — 랜딩 페이지·레이아웃·섹션. (C)는 여기에 `_scroll/**`(장면별 컴포넌트·CSS 5벌·스크롤 연출 `landing-motion.tsx`)가 있다.
- `src/app/(auth)/login/**` — 로그인 페이지·폼. (A)는 `page.tsx`·`login-form.tsx`·`actions.ts`이고 (B)·(C)엔 `login-form.test.tsx`가 더 있다.
- `src/components/public-site/**` — (B)에서 생긴 공개 화면 모듈(로그인 CSS·브랜드). (A)엔 **없다**.
- `src/data/marketing.ts` — 랜딩 카피. 판마다 내용이 전혀 다르다.
- 자산: (A)·(B)는 `public/photos/login-panel.webp`(+`src/app/(marketing)/_img/*.webp`), (C)는 `public/landing/scroll-*.webp`(사진 5장)와 로그인 패널 **영상** `public/photos/login-panel.mp4`·포스터 `login-panel-poster.webp`(2026-09-22 원장 *"이미지 대신에 이 영상 사용"* — 옛 `login-panel.webp`는 (C)에서 지웠다. (A)·(B)로 되돌리는 checkout이 되살린다).
- (A)만 쓰는 것: `src/app/(marketing)/_motion/landing.css`·`_sections/**`·`_ui/**`(그 판 안에 들어 있다).

## 되돌리는 명령

되돌릴 때는 **지금 판의 파일을 먼저 지우고** 그 판을 통째로 꺼낸다(`git checkout <sha> -- <경로>`만 하면 지금 판에만 있는 파일이 남는다).

### (A) 어제까지 운영하던 판으로

```bash
A=4ec22cae9abdc91e0852bcdcbefddb3ffcdf335e
git rm -r -q "src/app/(marketing)" "src/app/(auth)/login" src/components/public-site public/landing
git checkout $A -- "src/app/(marketing)" "src/app/(auth)/login" src/data/marketing.ts
```

- `src/components/public-site/**`·`public/landing/**`은 (A)에 없으므로 지우기만 한다.
- `src/lib/auth/login-next.ts`·`login-error.ts`(+그 테스트)는 (B)에서 생긴 도우미인데 (A) 로그인 폼이 안 읽으므로 남겨 둬도 무해하다.
- 🔴 **(A)에는 '무료'·요금 문구가 있다**(`_sections/hero.tsx`·`pricing.tsx`·`closing.tsx`·`layout.tsx`·`marketing.ts`의 "무료로 시작"·"베타 기간 전 기능 무료"·"카드 등록 없이"). 원장이 그 뒤에 금지한 문구라, **(A)로 되돌리면 그 문구가 공개 사이트에 다시 뜬다.** 되돌린 뒤 문구부터 지울 것.

### (B) 오늘 낮 판으로

```bash
B=ee7cc124   # 3+5 병합 시점의 origin/main(= 그날 낮 판의 공개 화면)
git rm -r -q "src/app/(marketing)" "src/app/(auth)/login" src/components/public-site public/landing
git checkout $B -- "src/app/(marketing)" "src/app/(auth)/login" src/components/public-site src/data/marketing.ts
```

### (C) 스크롤 판으로 — (D)를 걷을 때

```bash
C=e63f1ae63   # (D) 직전 main
git rm -r -q "src/app/(marketing)" public/landing/flagship
git checkout $C -- "src/app/(marketing)"
```

- (D)가 새로 만든 것 = `_scroll/flagship*.{tsx,css}` · `scene-assistant.tsx` · `scene-player.tsx`(자동 재생) · `dash-mock.tsx` · `strip-cards-c.tsx` · `strip-toggle.tsx` · `public/landing/flagship/**`(위 명령이 지운다). 로그인·`src/data/marketing.ts`는 (D)에서 안 바꿨다.
- 옛 장면 CSS(`landing-*.css`)는 (D)에서 고치지 않았다 — 그 위에 `flagship-scenes.css`로 덮었다. `landing-motion.tsx`는 한 줄(`.pin:not([data-play])` — 자동 재생 장면 제외)만 바꿨다. 위 checkout이 둘 다 (C)로 되돌린다.

### 스크롤 판(C)이 새로 만든 것 — 되돌릴 때 지우는 것

- `src/app/(marketing)/_scroll/**` (히어로·대시보드 목업·장면 A~C·메뉴 격자·화면 스트립·문의 띠·연출·CSS)
- `public/landing/scroll-{hero,office,class,teacher,shuttle}.webp`
- (3+5 판이 만들었던 `_desk/**`·`_parts/**`·`landing.css`·`public-site/brand-mark.tsx`·`fonts.ts`·`public/landing/{academy-model,floor-*}.webp`는
  (C)에서 이미 지웠다 — 3+5를 다시 보려면 `git checkout a1277366 -- "src/app/(marketing)" src/components/public-site public/landing src/data/marketing.ts`.)
- (`src/components/public-site/public-site.module.css`는 (B)에서 온 파일을 고친 것이라 checkout으로 그 판 모습이 그대로 돌아온다.)

## 실제로 해 본 결과 (2026-09-22, 임시 워크트리에서 명령을 그대로 적용)

| 판 | 명령 적용 | `tsc --noEmit` | 손봐야 하는 것 |
|---|---|---|---|
| **(A)** | 됨 | ❌ → ✅ | **한 줄**: `_ui/mock-workspace.tsx`의 `LayoutDashboard` → **`LayoutGrid`**(import 1 · 사용 1) |
| **(B)** | 됨 | ✅ 0건 | 없음 |

- 🔴 **(A)는 그대로 되돌리면 타입 검사가 안 된다** — 그 판 이후 아이콘 호환 모듈에서 `LayoutDashboard`가
  **`LayoutGrid`로 이름이 바뀌었다**. 되돌린 뒤 그 파일에서 두 곳을 바꾸면 0건이 된다(실제로 해서 확인).
  🔑 **판이 오래될수록 이런 드리프트가 는다** — (A)로 되돌릴 일이 생기면 타입 검사부터 한 번 돌릴 것.
- (B)는 오늘 낮 판이라 드리프트가 없다(0건).
- ⚠️ 임시 워크트리에서만 나는 잡음: `next-env.d.ts`가 git에 없어(gitignore) 처음엔 `*.webp` import 3건이
  "모듈을 찾을 수 없다"로 떴다. 실제 저장소엔 그 파일이 있으니 **되돌리기와 무관**하다(복사하니 사라졌다).
- 검증에 쓴 명령(그대로 재현 가능):
  `git worktree add --detach <임시폴더> <지금 커밋>` → node_modules 정션 → 위 되돌리기 명령 → `tsc --noEmit`.
  🔴 정션은 **링크만** 지우고(`[System.IO.Directory]::Delete(...)`) 워크트리를 제거할 것(원본 node_modules 보호).
