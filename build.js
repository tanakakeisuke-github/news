const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

// ===== ニュースソース =====
const SOURCES = [
  { id: "nhk", name: "NHKニュース", url: "https://www3.nhk.or.jp/news/", rss: "https://www3.nhk.or.jp/rss/news/cat0.xml" },
  { id: "itmedia", name: "ITmedia", url: "https://www.itmedia.co.jp/", rss: "https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml" },
  { id: "gigazine", name: "GIGAZINE", url: "https://gigazine.net/", rss: "https://gigazine.net/news/rss_2.0/" },
  { id: "cnet", name: "CNET Japan", url: "https://japan.cnet.com/", rss: "https://japan.cnet.com/rss/index.rdf" },
  { id: "impress", name: "Impress Watch", url: "https://www.watch.impress.co.jp/", rss: "https://www.watch.impress.co.jp/data/rss/1.0/ipw/feed.rdf" },
  { id: "zenn", name: "Zenn", url: "https://zenn.dev/", rss: "https://zenn.dev/feed" },
  { id: "hatena", name: "はてなブックマーク IT", url: "https://b.hatena.ne.jp/hotentry/it", rss: "https://b.hatena.ne.jp/hotentry/it.rss" },
  { id: "publickey", name: "Publickey", url: "https://www.publickey1.jp/", rss: "https://www.publickey1.jp/atom.xml" },
  { id: "nikkansports", name: "nikkansports.com", url: "https://www.nikkansports.com/", rss: "https://www.nikkansports.com/rss/nikkansports_all.rdf" },
  { id: "techcrunch", name: "TechCrunch Japan", url: "https://jp.techcrunch.com/", rss: "https://jp.techcrunch.com/feed/" },
];

// ===== HTTP fetch（依存なし）=====
function fetchURL(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many redirects"));
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, {
      timeout: 15000,
      headers: { "User-Agent": "BulknewsBot/1.0", Accept: "application/rss+xml, application/atom+xml, text/xml, */*" },
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        return resolve(fetchURL(new URL(res.headers.location, url).href, redirects + 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

// ===== 軽量XMLパーサ =====
function decodeEntities(s) {
  return s.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1");
}
function cleanText(s) {
  return decodeEntities(s).replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim();
}
function getTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : "";
}
function getAllBlocks(xml, tag) {
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[0]);
  return out;
}

function parseArticles(xml) {
  const articles = [];

  // RSS 2.0 <item>
  const items = getAllBlocks(xml, "item");
  if (items.length > 0) {
    for (const b of items) {
      const title = cleanText(getTag(b, "title"));
      let link = cleanText(getTag(b, "link")).split("\n")[0].trim();
      const date = cleanText(getTag(b, "pubDate") || getTag(b, "dc:date"));
      if (title && link) articles.push({ title, url: link, date });
    }
    return articles;
  }

  // Atom <entry>
  const entries = getAllBlocks(xml, "entry");
  if (entries.length > 0) {
    for (const b of entries) {
      const title = cleanText(getTag(b, "title"));
      const lm = b.match(/<link[^>]*rel\s*=\s*["']alternate["'][^>]*href\s*=\s*["']([^"']*)["'][^>]*\/?>/i)
        || b.match(/<link[^>]*href\s*=\s*["']([^"']*)["'][^>]*rel\s*=\s*["']alternate["'][^>]*\/?>/i)
        || b.match(/<link[^>]*href\s*=\s*["']([^"']*)["'][^>]*\/?>/i);
      const link = lm ? decodeEntities(lm[1]) : "";
      const date = cleanText(getTag(b, "published") || getTag(b, "updated"));
      if (title && link) articles.push({ title, url: link, date });
    }
    return articles;
  }

  return articles;
}

// ===== フィルタ =====
function isRecent(dateStr, hours = 48) {
  if (!dateStr) return true;
  try { const d = new Date(dateStr); return isNaN(d.getTime()) ? true : (Date.now() - d.getTime()) < hours * 3600000; } catch { return true; }
}
function esc(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ===== ソース取得 =====
async function fetchSource(src) {
  try {
    console.log(`  ${src.name}`);
    const xml = await fetchURL(src.rss);
    let arts = parseArticles(xml);
    const recent = arts.filter(a => isRecent(a.date, 48));
    arts = (recent.length > 0 ? recent : arts.slice(0, 20)).slice(0, 25);
    console.log(`    → ${arts.length} articles`);
    return { ...src, articles: arts, error: null };
  } catch (e) {
    console.error(`    ✗ ${e.message}`);
    return { ...src, articles: [], error: e.message };
  }
}

// ===== HTML生成 =====
function buildHTML(results) {
  const now = new Date();
  const d = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,"0")}/${String(now.getDate()).padStart(2,"0")}`;
  const t = `${d} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  const total = results.reduce((n,r) => n + r.articles.length, 0);

  const nav = results.map(r => `<a href="#${r.id}" class="nl">${esc(r.name)}</a>`).join(" | ");

  const secs = results.map(r => {
    const body = r.error
      ? `<span class="dm">⚠ 取得失敗: ${esc(r.error)}</span>`
      : r.articles.length === 0
        ? `<span class="dm">記事なし</span>`
        : r.articles.map(a =>
            `<div class="rw"><span class="bl">■</span> <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a> <a href="https://www.google.co.jp/search?q=cache:${esc(a.url)}" target="_blank" rel="noopener" class="ut">[G]</a> <a href="https://web.archive.org/web/*/${esc(a.url)}" target="_blank" rel="noopener" class="ut">[WB]</a></div>`
          ).join("\n");
    return `<table class="sc" id="${r.id}"><tr><td class="sh"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a> <a href="${esc(r.rss)}" target="_blank" rel="noopener" class="xm">[XML]</a></td></tr><tr><td class="sb">${body}</td></tr></table>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bulknews - ${d}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'MS PGothic','Osaka','ヒラギノ角ゴ Pro W3','Hiragino Kaku Gothic Pro',sans-serif;font-size:12px;line-height:1.6;color:#000;background:#fff}
.w{max-width:780px;margin:0 auto;padding:8px}
table{width:100%;border-collapse:collapse}
.hd{border:1px solid #999;margin-bottom:8px}
.ht{padding:6px 8px}
.lg{font:bold 24px 'Trebuchet MS',Verdana,sans-serif;color:#003366;text-decoration:none}
.hm{background:#eee;border-top:1px solid #ccc;padding:3px 8px;font-size:11px}
.sc{border:1px solid #ccc;margin-bottom:10px}
.sh{background:#336699;color:#fff;font-weight:bold;font-size:12px;padding:3px 8px}
.sh a{color:#fff;text-decoration:none}
.xm{color:#cce;text-decoration:none;font-size:10px;font-weight:normal}
.sb{padding:6px 8px}
.nv{padding:5px 8px;background:#eef;font-size:11px;text-align:center;line-height:1.9}
.nl{color:#039;text-decoration:none}
.nl:hover{text-decoration:underline}
.ab{padding:6px 8px;background:#f5f5f5;font-size:11px}
.rw{padding:1px 0;line-height:1.7}
.bl{color:#336699;font-size:8px;vertical-align:middle}
.rw a{color:#039;font-size:12px}
.rw a:visited{color:#609}
.ut{color:#999!important;text-decoration:none!important;font-size:10px!important}
.dm{color:#999;font-size:11px;font-style:italic}
.db{text-align:center;padding:6px 0;font-size:13px;border-bottom:1px solid #ccc;margin-bottom:8px}
.ft{background:#eee;font-size:10px;color:#666;text-align:center;padding:4px}
@media(max-width:600px){.w{padding:4px}.rw a{font-size:13px;line-height:1.8}.sb{padding:8px}}
</style>
</head>
<body>
<div class="w">
<table class="hd"><tr><td class="ht"><a href="." class="lg">Bulknews</a></td></tr><tr><td class="hm"><b>Last Update:</b> ${esc(t)} &nbsp; <b># of articles:</b> ${total}</td></tr></table>
<table class="sc"><tr><td class="sh">about Bulknews</td></tr><tr><td class="ab"><b>Bulknews</b>は、ニュースジャンキーのためのサイトです。GitHub Actionsにより30分ごとにRSSフィードを取得し、静的HTMLとしてデプロイしています。</td></tr></table>
<div class="db"><b>${esc(d)}のニュース</b></div>
<table class="sc"><tr><td class="nv">${nav}</td></tr></table>
${secs}
<table class="sc"><tr><td class="ft"><b>Bulknews Clone</b> ver. 1.0 / GitHub Actions + Pages / Built at ${esc(t)}</td></tr></table>
</div>
</body>
</html>`;
}

// ===== メイン =====
async function main() {
  console.log("=== Bulknews Builder ===");
  const results = await Promise.all(SOURCES.map(fetchSource));
  const html = buildHTML(results);
  const out = path.join(__dirname, "public");
  if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "index.html"), html, "utf-8");
  const total = results.reduce((n,r) => n + r.articles.length, 0);
  const ok = results.filter(r => !r.error).length;
  console.log(`\nDone! ${total} articles from ${ok}/${SOURCES.length} sources → public/index.html`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
