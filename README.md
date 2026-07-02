# arca-live

아카라이브(arca.live) 채널을 검색·조회하는 MCP 서버와, 더판/더구(중고 거래) 글을 자동 작성해주는 스킬을 담은 Claude Code 플러그인입니다.

## 설치

```
/plugin marketplace add <GitHub유저명>/arca-live-plugin
/plugin install arca-live@arca-live
```

## 요구사항

- **Node.js 18+** — MCP 서버 실행용 (의존성은 단일 파일로 번들되어 있어 `npm install` 불필요)
- **Claude in Chrome 확장** (선택) — 더판글 자동 작성 스킬의 글쓰기 페이지 입력·사진 첨부에 필요. 검색 기능은 확장 없이 동작합니다.
- 더판글 작성 시 브라우저에서 아카라이브 로그인 필요

## 기능

### MCP 서버: arca-search

| 도구 | 설명 |
|------|------|
| `search_posts` | 키워드 검색. 연산자 지원: 공백(AND), `\|`(OR), `-`(NOT), `"정확한 구문"`, 괄호 그룹 |
| `list_posts` | 최신/개념글 목록, 카테고리 필터 |
| `get_post` | 게시글 본문 + 댓글 조회 |
| `list_categories` | 채널 카테고리 목록 (동적 조회) |

모든 도구는 `channel` 파라미터로 임의 채널을 지정할 수 있습니다. 대화 중 "○○ 채널에서 검색해줘"라고 하면 됩니다.

**기본 채널 설정**: 기본값은 에어소프트 채널(`airsoft2077`)입니다. 다른 채널을 기본으로 쓰려면 `settings.json`에:

```json
{ "env": { "ARCA_CHANNEL": "채널슬러그" } }
```

**답변 원칙** (서버 instructions에 내장):
1. 채널에 있는 정보만 우선 취합
2. 외부 인용 시 출처(게시글 URL + 외부 출처) 명시
3. 추측 금지 — 근거가 없으면 "찾지 못했다"고 답변

### 스킬: /arca-live:deopan-post

"더판글 써줘"라고 하면 채널 표준 HTML 템플릿으로 판매글을 만들어 글쓰기 페이지에 제목·카테고리·본문·사진까지 채워줍니다.

- 물품 정보(가격, 하자사항 등)는 추측하지 않고 반드시 물어봅니다
- 사진은 폴더 경로만 주면 일괄 첨부되고, 사진 사이 공백 줄로 정리됩니다
- **⛔ 게시 버튼은 절대 대신 누르지 않습니다** — 내용 확인 후 게시는 항상 사용자가 직접 합니다

## 개발

서버 소스는 `server-src/`에 있습니다. 수정 후 번들:

```bash
npx esbuild server-src/index.js --bundle --platform=node --format=esm \
  --outfile=server/index.mjs \
  --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
```

## 주의

- 비공식 스크레이퍼입니다. arca.live 마크업이 바뀌면 동작하지 않을 수 있습니다.
- 과도한 요청은 IP 차단을 유발할 수 있습니다. 개인 용도로 사용하세요.
- arca.live는 봇 User-Agent를 차단하므로 브라우저 UA로 요청합니다.
