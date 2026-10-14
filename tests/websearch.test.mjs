import test from "node:test";
import assert from "node:assert/strict";
import { createWebSearch, parseDuckDuckGo } from "../server/websearch.mjs";

const page = `<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=x">Example <b>A</b></a>
<a class="result__snippet" href="#">First &amp; best snippet</a></div>
<div class="result"><a class="result__a" href="https://example.org/b">B title</a><div class="result__snippet">Second</div></div>`;

test("DuckDuckGo results: real links, titles and snippets", () => {
  assert.deepEqual(parseDuckDuckGo(page), [
    { url: "https://example.com/a", title: "Example A", snippet: "First & best snippet" },
    { url: "https://example.org/b", title: "B title", snippet: "Second" }
  ]);
});

test("falls back to Wikipedia, caches, rate limits and can be turned off", async () => {
  let calls = 0;
  const fetchFn = async (url) => { calls += 1;
    if (String(url).includes("duckduckgo")) return new Response("<html>no results</html>");
    return Response.json({ query: { search: [{ title: "Ciro Test", snippet: "a <span>match</span>" }] } }); };
  const s = createWebSearch({}, fetchFn);
  const r = await s.search("ciro test");
  assert.equal(r[0].url, "https://en.wikipedia.org/wiki/Ciro_Test");
  assert.equal(r[0].snippet, "a match");
  await s.search("ciro test");
  assert.equal(calls, 2, "second search served from cache");
  for (let i = 0; i < 30; i += 1) assert.equal(s.allow("u"), true);
  assert.equal(s.allow("u"), false);
  assert.equal(createWebSearch({ CIRO_WEBSEARCH: "off" }).enabled(), false);
});

test("CIRO Search first: own index + public sources merged, top pages read in full, token sent", async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push([String(url), init?.headers?.Authorization]);
    const path = new URL(String(url)).pathname;
    if (path === "/v1/web-search") return new Response("not found", { status: 404 }); // an older CIRO Search
    if (path === "/v1/search") return Response.json({ results: [{ url: "https://a.example/1", title: "Own", snippet: "own index" }] });
    if (path === "/v1/source-search") return Response.json({ results: [{ url: "https://zh.wikipedia.org/wiki/X", title: "维基", snippet: "公开源" }, { url: "https://a.example/1", title: "dup" }] });
    if (path === "/v1/read") return Response.json({ markdown: "完整的网页正文，比摘要长得多。".repeat(5) });
    throw new Error("unexpected " + url);
  };
  const s = createWebSearch({ CIRO_SEARCH_URL: "http://127.0.0.1:8789/", CIRO_SEARCH_TOKEN: "tok" }, fetchFn);
  const r = await s.search("测试");
  assert.deepEqual(r.map((x) => x.url), ["https://a.example/1", "https://zh.wikipedia.org/wiki/X"]);
  assert.match(r[0].snippet, /完整的网页正文/);
  assert.ok(seen.every(([, auth]) => auth === "Bearer tok"));
  assert.ok(!seen.some(([u]) => u.includes("duckduckgo")), "no fallback when CIRO Search answers");
});

test("CIRO Search 0.15: one /v1/web-search call, page content used, news category for news questions", async () => {
  const bodies = [];
  const fetchFn = async (url, init) => {
    bodies.push([new URL(String(url)).pathname, JSON.parse(init.body)]);
    return Response.json({ results: [{ url: "https://news.example/a", title: "头条", snippet: "短", content: "正文".repeat(50), published_at: "2026-10-14" }], providers: [] });
  };
  const r = await createWebSearch({ CIRO_SEARCH_URL: "http://127.0.0.1:8789" }, fetchFn).search("今天的新闻");
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0][0], "/v1/web-search");
  assert.equal(bodies[0][1].category, "news");
  assert.equal(bodies[0][1].read, 2);
  assert.match(r[0].snippet, /^正文/);
  assert.equal(r[0].published, "2026-10-14");
});
