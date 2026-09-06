/* The film bookmarklet's actual logic.
 *
 * The installed bookmark is only a loader stub that fetches this file from
 * nomagicpill.site with a cache-busting query string, so editing and pushing
 * this file updates the bookmarklet everywhere — no re-dragging. See
 * knowledge/film-bookmarklet.html.
 *
 * It reads a Letterboxd film page and copies a knowledge/add_film.py command
 * that fetches the poster and inserts the entry into knowledge/film.html.
 */
(function () {
  var REPO = "~/Documents/nomagicpill.github.io";

  if (!/(^|\.)letterboxd\.com$/.test(location.hostname)) {
    alert("Add film: open a Letterboxd film page first.");
    return;
  }

  // Letterboxd ships a JSON-LD Movie block on film pages, and a Review block
  // wrapping one on member review pages. Both carry the clean title and the
  // 600x900 poster, which is what film.html wants.
  function movieLD() {
    var fallback = null;
    var nodes = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < nodes.length; i++) {
      var t = nodes[i].textContent || "";
      var a = t.indexOf("{"), b = t.lastIndexOf("}");
      if (a < 0 || b <= a) continue;
      var d;
      try { d = JSON.parse(t.slice(a, b + 1)); } catch (e) { continue; }
      if (!d) continue;
      if (d["@type"] === "Movie") return d;
      if (d.itemReviewed && d.itemReviewed["@type"] === "Movie") fallback = d.itemReviewed;
    }
    return fallback;
  }

  function meta(p) {
    var el = document.querySelector('meta[property="' + p + '"]');
    return el ? (el.getAttribute("content") || "") : "";
  }

  var ld = movieLD() || {};
  var ogTitle = meta("og:title");

  var title = (ld.name || ogTitle.replace(/\s*\(\d{4}\)\s*$/, "")).trim();

  var year = "";
  var m = /\((\d{4})\)\s*$/.exec(ogTitle);
  if (m) year = m[1];
  if (!year) {
    var ye = document.querySelector(".releaseyear a, a[href*='/films/year/']");
    if (ye) { var ym = /(\d{4})/.exec(ye.textContent || ""); if (ym) year = ym[1]; }
  }
  if (!year) {
    var um = /-(\d{4})\/?$/.exec(ld.url || location.pathname);
    if (um) year = um[1];
  }

  var poster = ld.image || "";
  if (!poster) {
    var img = document.querySelector(".film-poster img, #poster-large img, .poster img");
    if (img) poster = img.getAttribute("src") || "";
  }
  // force the 2:3 crop the rest of the covers use
  poster = poster.replace(/-\d+-\d+-\d+-\d+-crop\.jpg/, "-0-600-0-900-crop.jpg");

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  var now = new Date();
  var date = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());

  // mirrors slugify() in knowledge/add_film.py
  function slug(s) {
    var t = s.normalize ? s.normalize("NFKD") : s;
    t = t.replace(/[\u0300-\u036f]/g, "");
    return t.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  }

  function sh(s) { return '"' + String(s).replace(/(["\\$`])/g, "\\$1") + '"'; }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var problems = [];
  if (!title) problems.push("title");
  if (!year) problems.push("year");
  if (!poster) problems.push("poster");

  var cmd = "python3 " + REPO + "/knowledge/add_film.py --title " + sh(title) +
            " --year " + year + " --poster " + sh(poster);

  var entry =
    '  <article class="film"\n' +
    '           data-title="' + esc(title) + ' (' + year + ')"\n' +
    '           data-rating=""\n' +
    '           data-date="' + date + '"\n' +
    '           data-cover="media/film/' + slug(title) + "-" + year + '.jpg">\n' +
    '           <p>\n' +
    '             \n' +
    '           </p>\n' +
    ' </article>';

  var old = document.getElementById("nmp-film-panel");
  if (old) old.parentNode.removeChild(old);

  var box = document.createElement("div");
  box.id = "nmp-film-panel";
  box.setAttribute("style", [
    "position:fixed", "z-index:2147483647", "top:20px", "right:20px", "width:520px",
    "max-width:92vw", "max-height:88vh", "overflow:auto", "background:#14161a",
    "color:#e9e9e9", "border:1px solid #3a3f46", "border-radius:10px", "padding:16px",
    "box-shadow:0 8px 30px rgba(0,0,0,.45)",
    "font:13px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif"
  ].join(";"));

  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) e.setAttribute("style", style);
    if (text != null) e.textContent = text;
    return e;
  }

  var head = el("div", "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px");
  head.appendChild(el("b", "font-size:14px", title ? title + " (" + year + ")" : "Could not read this page"));
  var x = el("button", "background:none;border:0;color:#9aa0a6;font-size:20px;line-height:1;cursor:pointer;padding:0 4px", "\u00d7");
  x.onclick = function () { box.parentNode.removeChild(box); };
  head.appendChild(x);
  box.appendChild(head);

  if (problems.length) {
    box.appendChild(el("div", "color:#ffb4a2;margin-bottom:10px",
      "Missing: " + problems.join(", ") + ". Fix by hand below."));
  }

  var status = el("div", "color:#9aa0a6;margin-bottom:6px", "Copying\u2026");
  box.appendChild(status);

  var mono = "width:100%;box-sizing:border-box;background:#0d0f12;color:#dfe3e6;" +
             "border:1px solid #3a3f46;border-radius:6px;padding:8px;" +
             "font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical";

  var ta = el("textarea", mono + ";height:82px");
  ta.value = cmd;
  ta.onclick = function () { ta.select(); };
  box.appendChild(ta);

  box.appendChild(el("div", "color:#9aa0a6;margin:10px 0 4px", "Paste that in a terminal. Or, to do it by hand:"));

  var ta2 = el("textarea", mono + ";height:150px");
  ta2.value = entry + "\n\nposter: " + poster;
  ta2.onclick = function () { ta2.select(); };
  box.appendChild(ta2);

  document.body.appendChild(box);

  function fallbackCopy() {
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    status.textContent = ok ? "Command copied to clipboard \u2713"
                            : "Copy failed \u2014 select the box below and copy it yourself.";
    status.style.color = ok ? "#9ae6b4" : "#ffb4a2";
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(cmd).then(function () {
      status.textContent = "Command copied to clipboard \u2713";
      status.style.color = "#9ae6b4";
    }, fallbackCopy);
  } else {
    fallbackCopy();
  }
})();
