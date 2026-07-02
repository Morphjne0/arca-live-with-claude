#!/usr/bin/env node
// MCP server: 아카라이브(arca.live) 채널 검색/조회
// 기본 채널은 ARCA_CHANNEL 환경변수로 설정 (기본값: airsoft2077)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DEFAULT_CHANNEL, listCategories, listPosts, searchPosts, getPost } from "./arca.js";

const server = new McpServer(
  {
    name: "arca-search",
    version: "0.2.0",
  },
  {
    instructions: [
      `이 서버로 아카라이브 채널 정보 기반 질문에 답할 때 반드시 지켜야 할 규칙 (기본 채널: ${DEFAULT_CHANNEL}):`,
      "1. 해당 아카라이브 채널에 있는 정보만을 우선적으로 취합해 답한다.",
      "2. 채널 게시글/댓글이 외부 정보(다른 사이트, 유튜브 등)를 인용한 경우 그 정보도 수집해 답하되, 출처(게시글 URL과 외부 출처 모두)를 반드시 밝힌다.",
      "3. 추측으로 답하는 것을 절대 금지한다. 채널에서 근거를 찾지 못하면 '채널에서 해당 정보를 찾지 못했다'고 명시한다.",
      "모든 답변에는 근거가 된 게시글의 URL을 출처로 표기한다.",
    ].join("\n"),
  }
);

const channelParam = z
  .string()
  .optional()
  .describe(`아카라이브 채널 슬러그 (URL의 /b/ 뒤 부분). 생략 시 기본 채널(${DEFAULT_CHANNEL})`);

function formatPostList(posts) {
  if (posts.length === 0) return "결과가 없습니다.";
  return posts
    .map(
      (p) =>
        `- [${p.id}] ${p.category ? `(${p.category}) ` : ""}${p.title}` +
        (p.commentCount ? ` [댓글 ${p.commentCount}]` : "") +
        `\n  작성자: ${p.author} | ${p.time ?? "?"} | 조회 ${p.views} | 추천 ${p.rating}${p.hasMedia ? " | 📷" : ""}`
    )
    .join("\n");
}

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

function errorResult(err) {
  return {
    content: [{ type: "text", text: `오류: ${err.message}` }],
    isError: true,
  };
}

server.registerTool(
  "search_posts",
  {
    title: "게시글 검색",
    description: [
      `아카라이브 채널(기본: ${DEFAULT_CHANNEL})에서 키워드로 게시글을 검색합니다. 결과의 [번호]를 get_post에 넘기면 본문을 볼 수 있습니다.`,
      "",
      "검색 연산자 (SQLite FTS 기반):",
      '- 공백 = AND: `핸드가드 mp5` → 두 단어 모두 포함',
      '- `|` = OR: `sl핸드가드|mp5sl` → 둘 중 하나 포함',
      '- `-` = NOT: `핸드가드 -레플` → 레플 제외',
      '- 쌍따옴표 = 정확한 구문: `"sl 핸드가드"` → 띄어쓰기 그대로 일치',
      '- 괄호 그룹: `핸드가드 (sl|엠락)`',
      "",
      "팁: 한국어 커뮤니티 특성상 같은 대상도 표기가 제각각입니다(띄어쓰기 유무, 한/영, 축약어). 정확한 구문 검색과 OR을 조합해 표기 변형을 한 번에 커버하세요.",
      '예: `"sl 핸드가드"|sl핸드가드|mp5sl` — 토큰이 다르게 잘리는 붙여쓰기 표기는 별도 OR 항으로 넣어야 잡힙니다.',
    ].join("\n"),
    inputSchema: {
      keyword: z.string().describe('검색 키워드. 연산자 지원: 공백(AND), |(OR), -(NOT), "정확한 구문", 괄호'),
      target: z
        .enum(["all", "title_content", "title", "content", "nickname", "comment"])
        .default("all")
        .describe("검색 대상: all(전체), title_content(제목/내용), title(제목), content(내용), nickname(글쓴이), comment(댓글)"),
      category: z.string().optional().describe("카테고리 필터 (선택). 채널의 카테고리 목록은 list_categories로 확인"),
      page: z.number().int().min(1).default(1).describe("페이지 번호 (1부터)"),
      channel: channelParam,
    },
  },
  async ({ keyword, target, category, page, channel }) => {
    try {
      const posts = await searchPosts({ channel, keyword, target, category, page });
      return textResult(
        `"${keyword}" 검색 결과 (채널=${channel ?? DEFAULT_CHANNEL}, target=${target}${category ? `, category=${category}` : ""}, p.${page}) — ${posts.length}건\n\n` +
          formatPostList(posts)
      );
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "list_posts",
  {
    title: "게시글 목록",
    description: `아카라이브 채널(기본: ${DEFAULT_CHANNEL})의 최신 게시글 목록을 가져옵니다. best=true면 개념글(베스트)만 표시합니다.`,
    inputSchema: {
      category: z.string().optional().describe("카테고리 필터 (선택). 채널의 카테고리 목록은 list_categories로 확인"),
      best: z.boolean().default(false).describe("개념글(베스트)만 보기"),
      page: z.number().int().min(1).default(1).describe("페이지 번호 (1부터)"),
      channel: channelParam,
    },
  },
  async ({ category, best, page, channel }) => {
    try {
      const posts = await listPosts({ channel, category, best, page });
      return textResult(
        `게시글 목록 (채널=${channel ?? DEFAULT_CHANNEL}, ${category ?? "전체"}${best ? ", 개념글" : ""}, p.${page}) — ${posts.length}건\n\n` +
          formatPostList(posts)
      );
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "get_post",
  {
    title: "게시글 본문 조회",
    description: "게시글 번호로 아카라이브 게시글의 본문과 댓글을 가져옵니다.",
    inputSchema: {
      postId: z.number().int().describe("게시글 번호 (search_posts/list_posts 결과의 [번호])"),
      channel: channelParam,
    },
  },
  async ({ postId, channel }) => {
    try {
      const post = await getPost(postId, channel);
      const lines = [
        `# ${post.category ? `(${post.category}) ` : ""}${post.title}`,
        `작성자: ${post.author} | ${post.time ?? "?"} | 조회 ${post.views} | 추천 ${post.upvotes} / 비추 ${post.downvotes}`,
        post.url,
        "",
        post.content || "(본문 없음)",
        "",
        `## 댓글 (${post.commentCount})`,
        ...post.comments.map(
          (c) => `${c.isReply ? "  ↳ " : "- "}${c.author}: ${c.text || "(내용 없음)"}`
        ),
      ];
      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "list_categories",
  {
    title: "채널 카테고리 목록",
    description: `아카라이브 채널(기본: ${DEFAULT_CHANNEL})의 카테고리 목록을 가져옵니다. search_posts/list_posts의 category 값으로 사용하세요.`,
    inputSchema: {
      channel: channelParam,
    },
  },
  async ({ channel }) => {
    try {
      const cats = await listCategories(channel ?? DEFAULT_CHANNEL);
      return textResult(
        `채널 "${channel ?? DEFAULT_CHANNEL}" 카테고리 ${cats.length}개\n\n` +
          cats.map((c) => `- ${c.label}${c.label !== c.value ? ` (값: ${c.value})` : ""}`).join("\n") +
          "\n\n※ category 파라미터에는 '값'을 사용하세요."
      );
    } catch (err) {
      return errorResult(err);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`arca-search MCP server running (stdio, 기본 채널: ${DEFAULT_CHANNEL})`);
