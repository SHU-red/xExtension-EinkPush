const http = require("http");
const { Readability } = require("@mozilla/readability");
const { JSDOM } = require("jsdom");

const PORT = parseInt(process.env.PORT || "3000", 10);

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * Follow a URL through HTTP redirects manually so we can also
 * detect meta-refresh / JS redirects (Google News uses these).
 * Returns { finalUrl, html }.
 */
async function fetchWithRedirects(url, maxHops = 5) {
  let currentUrl = url;

  for (let hop = 0; hop < maxHops; hop++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let res;
    try {
      res = await fetch(currentUrl, {
        signal: controller.signal,
        headers: HEADERS,
        redirect: "follow",  // follow HTTP 3xx
      });
    } finally {
      clearTimeout(timeout);
    }

    // Get the final URL after any HTTP redirects
    currentUrl = res.url || currentUrl;

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${currentUrl}`);
    }

    const html = await res.text();

    // Check for meta-refresh redirect (Google News sometimes uses this)
    const metaMatch = html.match(
      /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]+content\s*=\s*["']?\d+;\s*url=["']?([^"'>\s]+)/i
    );
    if (metaMatch && metaMatch[1]) {
      const nextUrl = new URL(metaMatch[1], currentUrl).href;
      console.log(`[redirect] meta-refresh: ${currentUrl} -> ${nextUrl}`);
      currentUrl = nextUrl;
      continue;
    }

    // Check for JS-based redirect in very short pages (Google News interstitial)
    if (html.length < 2000) {
      const jsMatch =
        html.match(/window\.location\s*=\s*["']([^"']+)["']/i) ||
        html.match(/location\.replace\s*\(\s*["']([^"']+)["']\s*\)/i) ||
        html.match(/location\.href\s*=\s*["']([^"']+)["']/i);
      if (jsMatch && jsMatch[1]) {
        const nextUrl = new URL(jsMatch[1], currentUrl).href;
        console.log(`[redirect] JS: ${currentUrl} -> ${nextUrl}`);
        currentUrl = nextUrl;
        continue;
      }
    }

    return { finalUrl: currentUrl, html };
  }

  throw new Error("Too many redirects");
}

function extract(html, url) {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) {
    return null;
  }

  return {
    title: article.title || "",
    content: article.content || "",
    textContent: article.textContent || "",
    excerpt: article.excerpt || "",
    byline: article.byline || "",
    length: article.length || 0,
    siteName: article.siteName || "",
  };
}

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"status":"ok"}');
    return;
  }

  // Extract endpoint
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  if (parsed.pathname !== "/extract") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end('{"error":"Not found. Use GET /extract?url=..."}');
    return;
  }

  const targetUrl = parsed.searchParams.get("url");
  if (!targetUrl) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end('{"error":"Missing ?url= parameter"}');
    return;
  }

  // Validate URL scheme
  try {
    const u = new URL(targetUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("bad scheme");
    }
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end('{"error":"Invalid URL (must be http/https)"}');
    return;
  }

  try {
    console.log(`[extract] Fetching: ${targetUrl}`);
    const { finalUrl, html } = await fetchWithRedirects(targetUrl);
    if (finalUrl !== targetUrl) {
      console.log(`[extract] Resolved to: ${finalUrl}`);
    }

    const article = extract(html, finalUrl);

    if (!article) {
      console.log(`[extract] Readability returned null for: ${finalUrl}`);
      res.writeHead(422, { "Content-Type": "application/json" });
      res.end('{"error":"Could not extract article content"}');
      return;
    }

    console.log(
      `[extract] OK: ${article.title.substring(0, 60)} (${article.length} chars)`
    );
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(article));
  } catch (err) {
    const msg = err.name === "AbortError" ? "Timeout fetching URL" : err.message;
    console.log(`[extract] Error for ${targetUrl}: ${msg}`);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: msg }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Readability API listening on port ${PORT}`);
});
