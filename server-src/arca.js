// arca.live 채널 스크레이퍼 (채널 범용)
import * as cheerio from "cheerio";

const BASE = "https://arca.live";
export const DEFAULT_CHANNEL = process.env.ARCA_CHANNEL || "airsoft2077";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
  });
  if (res.status === 404) {
    throw new Error(`채널 또는 게시글을 찾을 수 없습니다 (404): ${url}`);
  }
  if (!res.ok) {
    throw new Error(`arca.live 요청 실패: HTTP ${res.status} (${url})`);
  }
  return res.text();
}

function cleanText(s) {
  return s.replace(/\s+/g, " ").trim();
}

// 채널별 카테고리 캐시 (프로세스 생명주기 동안 유지)
const categoryCache = new Map();

export async function listCategories(channel = DEFAULT_CHANNEL) {
  if (categoryCache.has(channel)) return categoryCache.get(channel);
  const html = await fetchHtml(`${BASE}/b/${channel}`);
  const $ = cheerio.load(html);
  const cats = [];
  $(`a[href*="/b/${channel}?category="]`).each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/category=([^&"]+)/);
    if (!m) return;
    const value = decodeURIComponent(m[1].replace(/\+/g, "%20"));
    const label = cleanText($(el).text());
    if (value && !cats.some((c) => c.value === value)) {
      cats.push({ value, label: label || value });
    }
  });
  categoryCache.set(channel, cats);
  return cats;
}

function parsePostRows($, channel) {
  const posts = [];
  $("a.vrow.column").each((_, el) => {
    const $el = $(el);
    if ($el.hasClass("notice") || $el.hasClass("head")) return;
    const href = $el.attr("href") || "";
    const m = href.match(/\/b\/([^/]+)\/(\d+)/);
    if (!m) return;

    const $title = $el.find(".title").first().clone();
    $title.find(".media-icon").remove();

    posts.push({
      id: Number(m[2]),
      url: `${BASE}/b/${m[1]}/${m[2]}`,
      category: cleanText($el.find(".badges .badge").first().text()) || null,
      title: cleanText($title.text()),
      commentCount: Number(
        (cleanText($el.find(".comment-count").first().text()).match(/\d+/) || [0])[0]
      ),
      author: cleanText($el.find(".col-author .user-info").first().text()),
      time: $el.find(".col-time time").attr("datetime") || null,
      views: Number(cleanText($el.find(".col-view").text())) || 0,
      rating: Number(cleanText($el.find(".col-rate").text())) || 0,
      hasMedia: $el.find(".title .media-icon").length > 0,
    });
  });
  return posts;
}

export async function listPosts({ channel = DEFAULT_CHANNEL, category, page = 1, best = false } = {}) {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (best) params.set("mode", "best");
  if (page > 1) params.set("p", String(page));
  const qs = params.toString();
  const html = await fetchHtml(`${BASE}/b/${channel}${qs ? "?" + qs : ""}`);
  return parsePostRows(cheerio.load(html), channel);
}

export async function searchPosts({ channel = DEFAULT_CHANNEL, keyword, target = "all", category, page = 1 }) {
  const params = new URLSearchParams();
  params.set("target", target);
  params.set("keyword", keyword);
  if (category) params.set("category", category);
  if (page > 1) params.set("p", String(page));
  const html = await fetchHtml(`${BASE}/b/${channel}?${params.toString()}`);
  return parsePostRows(cheerio.load(html), channel);
}

export async function getPost(postId, channel = DEFAULT_CHANNEL) {
  const html = await fetchHtml(`${BASE}/b/${channel}/${postId}`);
  const $ = cheerio.load(html);

  const $head = $(".article-head");
  if ($head.length === 0) {
    throw new Error(`게시글을 찾을 수 없습니다: ${postId} (채널: ${channel})`);
  }

  const $title = $head.find(".title-row .title").clone();
  const category = cleanText($title.find(".category-badge").text()) || null;
  $title.find(".category-badge").remove();

  const infoBodies = $head
    .find(".article-info .body")
    .map((_, el) => cleanText($(el).text()))
    .get();
  // 순서: 추천, 비추천, 댓글, 조회수, 작성일

  const $content = $(".article-content").first();
  // 이미지는 텍스트 참조로 치환
  $content.find("img, video").each((_, el) => {
    const $el = $(el);
    let src = $el.attr("data-originalurl") || $el.attr("src") || "";
    if (src.startsWith("//")) src = "https:" + src;
    $el.replaceWith(`\n[이미지: ${src}]\n`);
  });
  $content.find("p, br, div").each((_, el) => {
    $(el).append("\n");
  });

  const comments = [];
  $(".comment-item").each((_, el) => {
    const $c = $(el);
    const text = cleanText($c.find(".message .text").text());
    const emoticon = $c.find(".message .emoticon-wrapper, .message img.emoticon").length > 0;
    comments.push({
      id: ($c.attr("id") || "").replace(/^c_/, ""),
      author: cleanText($c.find(".user-info").first().text()),
      time: $c.find("time").attr("datetime") || null,
      text: text || (emoticon ? "(이모티콘)" : ""),
      isReply: $c.parents(".comment-item").length > 0,
    });
  });

  return {
    id: Number(postId),
    url: `${BASE}/b/${channel}/${postId}`,
    channel,
    category,
    title: cleanText($title.text()),
    author: cleanText($head.find(".member-info .user-info").first().text()),
    upvotes: Number(infoBodies[0]) || 0,
    downvotes: Number(infoBodies[1]) || 0,
    commentCount: Number(infoBodies[2]) || 0,
    views: Number(infoBodies[3]) || 0,
    time: $head.find(".article-info time").attr("datetime") || null,
    content: $content
      .text()
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    comments,
  };
}
