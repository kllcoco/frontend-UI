// Web search for any model (the composer's 联网 button): the server looks the question up and the client hands the
// results to whichever model answers — the Ciro service's or the user's own API model. No search API key needed:
// DuckDuckGo's HTML results, with Wikipedia as the fallback. CIRO_WEBSEARCH=off turns it off.
//   CIRO_WEBSEARCH_DDG_URL   (default https://html.duckduckgo.com/html/)
//   CIRO_WEBSEARCH_WIKI_URL  (default https://{lang}.wikipedia.org/w/api.php)

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const strip = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#x27;|&#39;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export function webSearchEnabled(env) { return !/^(0|off|false|no)$/i.test(String(env.CIRO_WEBSEARCH || "")); }

/** Results from DuckDuckGo's HTML page: [{ url, title, snippet }]. */
export function parseDuckDuckGo(html) {
  const out = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="[^"]*result__a|$)/g;
  for (const m of String(html).matchAll(re)) {
    let url = m[1].replace(/&amp;/g, "&");
    const redirect = /[?&]uddg=([^&]+)/.exec(url);
    if (redirect) url = decodeURIComponent(redirect[1]);
    if (url.startsWith("//")) url = "https:" + url;
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
    const snippet = strip(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/.exec(m[3])?.[1]);
    out.push({ url, title: strip(m[2]).slice(0, 160), snippet: snippet.slice(0, 400) });
    if (out.length >= 6) break;
  }
  return out;
}

export function createWebSearch(env, fetchFn = fetch) {
  const cache = new Map(), hits = new Map();
  async function ddg(q, signal) {
    const res = await fetchFn(env.CIRO_WEBSEARCH_DDG_URL || "https://html.duckduckgo.com/html/", { method: "POST", signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
      body: new URLSearchParams({ q }).toString() });
    return res.ok ? parseDuckDuckGo(await res.text()) : [];
  }
  async function wiki(q, signal) {
    const lang = /[一-鿿]/.test(q) ? "zh" : "en";
    const base = (env.CIRO_WEBSEARCH_WIKI_URL || "https://{lang}.wikipedia.org/w/api.php").replace("{lang}", lang);
    const res = await fetchFn(base + "?action=query&list=search&format=json&srlimit=5&srsearch=" + encodeURIComponent(q), { signal, headers: { "User-Agent": UA } });
    if (!res.ok) return [];
    const body = await res.json().catch(() => ({}));
    const site = base.replace(/\/w\/api\.php.*$/, "");
    return (body?.query?.search || []).map((x) => ({ url: site + "/wiki/" + encodeURIComponent(String(x.title).replace(/ /g, "_")),
      title: strip(x.title), snippet: strip(x.snippet).slice(0, 400) }));
  }
  return {
    enabled: () => webSearchEnabled(env),
    /** Allowed for this caller now (30 searches a minute per user / address). */
    allow(key) {
      const now = Date.now(), list = (hits.get(key) || []).filter((t) => now - t < 60_000);
      if (list.length >= 30) return false;
      list.push(now); hits.set(key, list);
      if (hits.size > 5000) hits.clear();
      return true;
    },
    async search(q) {
      const query = String(q || "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (!query) return [];
      const cached = cache.get(query);
      if (cached && Date.now() - cached.at < 5 * 60_000) return cached.results;
      const signal = AbortSignal.timeout(10_000);
      let results = [];
      try { results = await ddg(query, signal); } catch { /* blocked or offline: fall back */ }
      if (!results.length) { try { results = await wiki(query, AbortSignal.timeout(8_000)); } catch { /* none */ } }
      cache.set(query, { at: Date.now(), results });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      return results;
    }
  };
}
