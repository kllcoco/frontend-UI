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
