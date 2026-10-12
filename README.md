# 프렙 카페 운영 기록

현재 구현 범위는 개발계획의 **EPIC 1: 판매 기록과 메뉴 수익성(S01~S04)**입니다. 사용자 테스트 완료 전까지 EPIC 완료로 표시하지 않습니다.

- 판매 등록·수정·삭제, 일·월 메뉴 수익성, 당시 원가 보존, 필수값·중복·저장 실패·다른 창 충돌 처리.
- 가상 샘플만 앱에 포함하고 IndexedDB에 한 번 준비합니다. 기록은 같은 주소·브라우저 프로필에 저장합니다.
- 비용·손익·재고·전체 백업·복원은 EPIC 2~3에 남아 있습니다.
- 브라우저 저장 정리로 기록이 사라질 수 있습니다. 현재 단계는 가상 자료로 확인하세요.

## 실행과 검사

Node.js 24 LTS를 사용합니다. 정확한 라이브러리 버전은 `package-lock.json`에 고정했습니다.

```powershell
npm ci
npm test
npm run build
npm run preview
```

검사 화면: http://127.0.0.1:5173/ (서버가 실행되는 동안 사용 가능합니다).

Windows에서 시스템 Node가 22인 이번 실습 환경은 앱에서 제공한 Node 24 런타임을 사용해 검사·빌드·미리보기를 실행했습니다. 개발 시 `.nvmrc`에 맞는 Node를 사용하세요.

검사 기록과 사용자 확인 순서는 `docs/05_테스트결과.md`를 참조합니다. 소스는 [GitHub planning_test](https://github.com/chaebin-e/planning_test)의 `main` 브랜치에 보관합니다. 사용자 지정 저장소는 공개이며 가상 자료만 포함합니다. Vercel 운영 배포는 아직 수행하지 않았습니다. GitHub 보관은 EPIC의 사용자 테스트 완료 판정과 별개입니다.

참고 기술 문서: [Vite 시작](https://vite.dev/guide/), [Dexie 트랜잭션](https://dexie.org/docs/Dexie/Dexie.transaction()), [Vitest 검사](https://vitest.dev/guide/). 구현은 PRD·FRD·TRD를 기준으로 합니다.
