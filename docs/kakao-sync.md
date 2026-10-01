# Kakao 일정 동기화와의 약속

카카오톡 일정 동기화는 별도 비공개 저장소에서 관리한다.

- 소스: `/Users/dorm/coding/tennis-kakao-sync` (GitHub `cafeSowoo/tennis-kakao-sync`, private)
- 실행: `~/Applications/TennisBomSync.app` + launchd `com.cafesowoo.tennisbom-headless-sync` (매시 00/20/40분)
- 배포: 그 저장소의 `scripts/deploy-release.py` (되돌리기 `--rollback`)
- 실행 기록: Supabase `kakao_sync_runs`, 상태: `kakao_sync_state`

## 동기화가 기대하는 DB 권한

동기화는 관리자 계정(harminis) 세션으로 읽고 쓴다. 공개 키만으로 읽지 않는다.

| 테이블 / 함수 | 동기화가 하는 일 |
|---|---|
| `schedules`, `members`, `events` | 관리자 세션으로 읽기 (비교) |
| `courts`, `court_units` | 읽기 (공개) |
| `kakao_schedule_comments` | 관리자 세션으로 읽기·쓰기 |
| `schedules` 쓰기, `record_kakao_sync` RPC | 관리자 세션 |

이 테이블의 RLS·권한이나 컬럼을 바꾸면, 바꾼 직후 동기화를 한 번 돌려
`kakao_sync_runs`에 `status=ok`가 남는지 확인한다.

```bash
launchctl kickstart gui/$(id -u)/com.cafesowoo.tennisbom-headless-sync
```

`discussions`, `schedule_declines`, `schedule_rsvp_overrides`는 동기화가 읽지 않는다.
