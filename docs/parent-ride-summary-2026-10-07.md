# 학부모 알림 · 셔틀 운행 흐름 — 2026-10-07 정리

로컬 테스트 복사본에서 10/7 오후에 만든 **학부모 알림(푸시 가정판)** 과 **셔틀 '오늘 등하원' 운행 흐름** 변경을 정리한다.
앞 단계: [9/30 정리](parent-ride-summary-2026-09-30.md) · DB 정의: [`parent-ride-schema/`](parent-ride-schema/README.md)

- 본서버 마이그레이션: `0354a_parent_departure_acks` → `0354b_parent_notice_key` → `0354c_boarding_notify_parent`
  (로컬 번호 0294a~0294c). 손으로 적용하는 alpha 파일이고 **앱 배포보다 먼저**. origin/main 최대 번호가 0353b라 그다음을 썼다.
- ⚠️ 로컬 폴더는 git이 아니라 바뀐 파일은 **파일 수정 시각**(직전 커밋 10/7 13:32 이후)으로 추렸고, 로컬 번호(0290a~0294c)를
  본서버 번호(0320a~0323a · 0354a~0354c)로 바꿔 옮겼다.

---

## 1. 운행 흐름 (셔틀 선생님 · 관리자)

```
[출발 30분 전부터] 하원 아이 체크 (안 타면 [하원 안함])
      → [출발]  — 하원 체크 안 된 아이가 있으면 "다시 확인해 주세요" 창, 출발 안 됨
      → 등원: [탑승]/[미탑승] → [전송](알림) 또는 [저장](알림 없음)
        하원: (체크된 아이만) [하차] → [전송](알림, 그 정류장이 내린 곳)
      → [종료]  — 명단 중 상태가 안 정해진 아이가 있으면 "누구누구 학생 확인이 필요합니다", 종료 안 됨
      → 종료된 회차는 판 전체가 회색 + [운행 종료] 배지
```

| # | 요청 | 바뀐 것 | 어디 |
|---|---|---|---|
| 1 | 차가 출발하면 학부모에게 "차량이 출발했습니다" | 학부모 화면 맨 위에 알림 줄 + [확인]하면 사라짐. 그날 그 회차에 **실제로 타는** 아이의 학부모에게만(타지 않기·결석이면 없음). 형제는 한 줄 | `departure-notices.ts` · `departure-notice-list.tsx` · `parent/layout.tsx` · **0354a** |
| 2 | 등원 [탑승]→[전송]이면 "아이가 지금 차량을 탔습니다" | 등원 탑승 알림(초록). 아이마다 한 줄 | 같은 곳 · **0354b**(알림 종류별 확인) |
| 3 | 등원 줄 체크박스 대신 [저장] — 알림 없이 DB만 | [저장] = [전송]과 같은 저장 + `notify_parent=false`. 이름 옆에 "학부모님에게 알람 전송했습니다" / "데이터를 저장만 했습니다" | `ride-row-item.tsx` · `recordBoarding` · **0354c** |
| 4 | [미탑승]→[전송]이면 "탑승하지 않았습니다" · [등원 안함]은 저장만 | 미탑승 알림(빨강). [저장]이면 없음. [등원 안함]은 예정 변경이라 원래부터 알림 없음 | `departure-notices.ts` |
| 5 | 종료 전 전원 상태 확인 | 탑승·미탑승 기록(전송·저장) 또는 오늘 안 탐이 아니면 종료 거절 + 이름. **9/30까지의 "미기록이 남아도 종료는 막지 않는다"를 뒤집음.** 오류 띠가 화면 밖이면 끌어온다 | `trip-end-guard.ts` · `uncheckedRiderNames` · `endTrip` · `day-board-client.tsx` |
| 6 | 출발 전 하원 체크 확인 | 하원 아이 중 체크도 [하원 안함]도 아닌 아이가 있으면 출발 안 하고 확인 창. 체크는 탭 세션 저장(DB 아님)이라 **화면에서만** 확인 | `check-store.ts` · `uncheckedDropOffNames` · `trip-control.tsx` · `confirm-dialog.tsx`(`cancelLabel={null}`) |
| 7 | 하원은 [탑승]/[미탑승] → [하차] 하나 | 값은 그대로 `boarded`(하원의 boarded = 내림). [전송]하면 그 줄 정류장이 내린 곳 + 하차 알림 "OO에서 내렸습니다" | `ride-row-item.tsx` · `departure-notices.ts` |
| 8 | 하원은 체크된 아이만 [하차]·[전송] | 체크 안 된 하원 줄은 잠금. [하원 안함]·[등하원 수정]·[취소]는 열어 둠 | `ride-row-item.tsx` |
| 9 | 직원 [출발]·기록 시간 제한 | 10분 → **30분 전부터**(`STAFF_OPEN_MINUTES`). 학부모 수정 마감(`EDIT_CUTOFF_MINUTES`, 10분)과 **숫자를 분리** | `trip-open-guard.ts` |
| 10 | 탑승·미탑승·하차는 [출발] 뒤에만 | 출발 전 회차는 칩 잠금 + 서버도 거절(오늘만, 운행 표 없으면 안 막음). 체크·안함·수정은 출발 전에도 됨 | `run-panel.tsx` · `ride-row-item.tsx` · `recordBoarding` |
| 11 | 종료된 회차를 확실히 | 판 회색 + 흑백 + [운행 종료] 배지. [종료 취소]·종료 배지는 색 유지 | `run-panel.tsx` |
| 12 | 직원이 적은 내용은 학부모에게 안 보이게 | **이미 그렇다 — 고칠 곳 없음.** 김민준의 실제 직원 사유·이름으로 학부모 화면 15곳(HTML + RSC 데이터)을 검사해 0건. 새 알림에도 사유·직원 이름은 싣지 않는다 | 확인만 |

## 2. 학부모 알림 설계

- **알림은 저장하지 않고 도출한다** — 오늘 구간(`RideLeg`)이 이미 "누가 어느 회차에 타나 + 운행 상태 + 탑승 기록"을 들고 있다.
  그래서 [취소]→[전송]으로 기록을 지우면 알림도 사라지고, '타지 않기'·결석한 날은 출발해도 알림이 없다.
  DB에는 **학부모가 [확인]했다**는 사실만 쌓는다(`parent_departure_acks`, 학부모 계정마다 따로).
- 알림 키(`notice_key`): `depart` · `board:<학생>` · `miss:<학생>` · `drop:<학생>` — 미탑승을 확인한 뒤 탑승으로 고쳐 보내면 탑승 알림은 새로 뜬다.
- 진짜 푸시가 없어서 학부모 화면이 보이는 동안 **15초마다 다시 읽는다**(`POLL_MS`). 실제 앱 푸시를 붙일 땐
  `startTrip`·`recordBoarding`(notify_parent=true)에서 같은 대상에게 보내면 된다 — 대상 판정은 `parentNotices` 그대로.
- [확인] 액션은 **지금 그 학부모에게 실제로 떠 있는 알림**만 받는다(service_role이라 아무 키나 적지 않게).

## 3. 남은 것 · 주의

1. **체크는 DB에 없다** — 같은 탭에서만 유지되고 다른 폰엔 안 보인다. 두 사람이 다른 폰으로 같은 회차를 돌리면 체크가 공유되지 않는다.
2. **종료 확인은 '오늘 등하원' 화면과 같은 명단 계산**을 서버에서 한 번 더 한다(`getShuttleBoard` 등) — 종료는 드물어 비용은 괜찮지만, 조회가 실패하면 막지 않는다.
3. 알림 폴링은 학부모 화면 전체를 15초마다 다시 그린다. 학부모가 많아지면 실제 푸시(또는 Realtime)로 바꾸는 게 맞다.
4. 하원 미탑승 칸이 없어졌다 — 옛 하원 `missed` 기록은 줄이 빨갛게 보일 뿐 새로 찍을 수는 없다.
5. 전체 `tsc`는 로컬 PC 메모리(8GB) 문제로 돌리지 못했다 — 셔틀 테스트(237)·eslint로 확인. 본서버 CI의 typecheck를 꼭 볼 것.

## 4. 바뀐 파일

- 새 파일: `src/features/shuttle/{check-store,departure-notices,departure-notices.test}.ts` · `components/departure-notice-list.tsx` ·
  `server/{parent-departure,parent-departure-actions,trip-end-guard}.ts` · `supabase/migrations/0354{a,b,c}_*.sql`
- 고친 파일: `parent/layout.tsx` · 셔틀 today `{day-board-client,ride-row-item,run-panel,trip-control}.tsx` · `ui/confirm-dialog.tsx` ·
  `shuttle/{parent-rides,roster,trip-state}.ts`(+테스트) · `server/{actions,parent-ride-data,queries,trip-open-guard}.ts`
