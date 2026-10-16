/*
 * Lightweight reading enhancements, no dependencies:
 *   1. A scroll progress bar across the top of the page (left to right).
 *   2. Collapsible sections that open themselves when linked to.
 *   3. A previous/next bar at the end of series posts.
 *   4. An auto-generated table of contents built from the page's
 *      <h2> (main bullets) and <h3> (sub-bullets) headings.
 *
 * The TOC replaces the manual list that follows a `<h2 id="contents">`
 * heading. If there's no Contents heading, everything but the TOC runs.
 */
(function () {
  // ----- Scroll progress bar (top, left to right) -----
  var bar = document.createElement('div');
  bar.id = 'scroll-progress';
  document.body.appendChild(bar);

  function updateProgress() {
    var doc = document.documentElement;
    var scrolled = doc.scrollTop || document.body.scrollTop;
    var max = doc.scrollHeight - doc.clientHeight;
    bar.style.width = (max > 0 ? (scrolled / max) * 100 : 0) + '%';
  }

  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', updateProgress);
  updateProgress();

  // ----- Collapsible sections open when linked to -----
  // Sections are written as <button class="collapsible"> followed by a
  // <div class="content"> that starts hidden, so a link into one -- a TOC
  // entry, a shared #anchor -- used to land on a section the reader still
  // had to click open. Expand it first and let the normal anchor scroll
  // follow. The inline per-page toggle scripts are left alone: we set the
  // same inline display and .active class they do, so the next click on the
  // button still closes the section.

  function contentOf(button) {
    var content = button.nextElementSibling;
    return (content && content.classList.contains('content')) ? content : null;
  }

  // The toggle button of the nearest collapsible section containing `el`,
  // or null if `el` isn't inside one.
  function sectionButtonFor(el) {
    for (var node = el; node && node !== document.body; node = node.parentNode) {
      if (node.nodeType !== 1 || !node.classList.contains('content')) continue;
      var button = node.previousElementSibling;
      if (button && button.classList.contains('collapsible')) return button;
    }
    return null;
  }

  function openSection(button) {
    var content = contentOf(button);
    if (!content || content.style.display === 'block') return false;
    content.style.display = 'block';
    button.classList.add('active');
    return true;
  }

  // Open every collapsible wrapping `el` (and `el` itself when it is a
  // toggle button), outward through any nesting. True if anything opened.
  function reveal(el) {
    var opened = false;
    if (el.classList && el.classList.contains('collapsible')) {
      opened = openSection(el) || opened;
    }
    for (var b = sectionButtonFor(el); b; b = sectionButtonFor(b)) {
      opened = openSection(b) || opened;
    }
    return opened;
  }

  function targetOf(hash) {
    if (!hash || hash.length < 2) return null;
    var id = hash.slice(1);
    try { id = decodeURIComponent(id); } catch (e) {}
    return document.getElementById(id);
  }

  // Same-page link clicks: expand before the browser's own scroll runs, so
  // it measures a page where the target is visible.
  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a[href]');
    if (!link || !link.hash) return;
    if (link.host !== location.host || link.pathname !== location.pathname) return;
    var target = targetOf(link.hash);
    if (target) reveal(target);
  });

  // Back/forward and any other hash change the click handler didn't cover.
  window.addEventListener('hashchange', function () {
    var target = targetOf(location.hash);
    if (target && reveal(target)) target.scrollIntoView();
  });

  // A hash the page loaded with: the browser already tried and failed to
  // scroll to a hidden target, so scroll again once the section is open.
  // Deferred a frame so the generated TOC below is in place first.
  if (location.hash) {
    var landing = targetOf(location.hash);
    if (landing) {
      requestAnimationFrame(function () {
        if (reveal(landing)) landing.scrollIntoView({ behavior: 'instant' });
      });
    }
  }

  // ----- Series previous/next -----
  // A series post lists every part in <ol class="series"> near the top,
  // with the part being read marked aria-current="page". A reader who
  // finishes it would have to scroll back up to find the next one, so the
  // current part's neighbors are repeated as a bar at the end of the post,
  // just above See Also. It is built from that list, so there is nothing
  // else to keep in sync when a new part is published.
  var currentPart = document.querySelector('ol.series > li[aria-current]');
  if (currentPart) {
    var seriesNav = document.createElement('nav');
    seriesNav.className = 'series-nav';
    seriesNav.setAttribute('aria-label', 'Series');
    seriesNav.appendChild(seriesSide(currentPart.previousElementSibling, 'prev'));
    seriesNav.appendChild(seriesSide(currentPart.nextElementSibling, 'next'));

    // The bar goes after the post's last section: just above See Also, or,
    // without one, after the last element before the scripts at the bottom
    // of the body and what they append (the theme toggle, the progress
    // bar). This runs before the TOC below mints ids for unnamed headings,
    // so a note's own nested <h3>See Also</h3> (notes.html) isn't mistaken
    // for the page's.
    var seeAlso = document.getElementById('see_also');
    var last = seeAlso ? seeAlso.previousElementSibling
                       : document.body.lastElementChild;
    while (!seeAlso && last && (last.tagName === 'SCRIPT' || last === bar ||
                                last.id === 'theme-toggle')) {
      last = last.previousElementSibling;
    }
    if (last) {
      last.parentNode.insertBefore(seriesNav, last.nextSibling);
      // Sections end on an <hr>, but not every post closes its last one.
      if (last.tagName !== 'HR') {
        last.parentNode.insertBefore(document.createElement('hr'), seriesNav);
      }
      if (seeAlso) {
        seeAlso.parentNode.insertBefore(document.createElement('hr'), seeAlso);
      }
    }
  }

  // One half of the bar: a small label over a link to the neighboring part.
  // Part I gets an empty left half; the newest part says so on the right.
  function seriesSide(li, rel) {
    var side = document.createElement('div');
    side.className = rel;
    var link = li && li.querySelector('a[href]');
    var label = document.createElement('span');
    if (link) {
      label.textContent = rel === 'prev' ? '← Previous' : 'Next →';
      var a = document.createElement('a');
      a.href = link.getAttribute('href');
      a.rel = rel;
      a.textContent = link.textContent;
      side.appendChild(label);
      side.appendChild(a);
    } else if (rel === 'next') {
      label.textContent = 'Latest in the series';
      side.appendChild(label);
    }
    return side;
  }

  // ----- Auto table of contents -----
  var contentsHeading = document.getElementById('contents');
  if (!contentsHeading) return;

  function slugify(text) {
    return text.toLowerCase().trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '_');
  }

  var headings = document.querySelectorAll('h2, h3');
  var list = document.createElement('ul');
  var subList = null; // current <ul> nested under the latest <h2>

  Array.prototype.forEach.call(headings, function (h) {
    // Skip the top "Home" nav, the Contents heading itself, and any
    // heading explicitly opted out via data-no-toc.
    if (h.id === 'home' || h.id === 'contents') return;
    if (h.hasAttribute('data-no-toc')) return;

    // Only include headings that appear after the Contents heading, so
    // series links or other headings above it are left out of the TOC.
    if (!(contentsHeading.compareDocumentPosition(h) &
          Node.DOCUMENT_POSITION_FOLLOWING)) return;

    // Where the TOC entry points. A heading with its own id keeps it. An
    // unnamed heading that titles a collapsible section borrows the toggle
    // button's id instead of minting a matching one of its own -- the
    // button is the section's hand-written anchor, and it sits above the
    // hidden content rather than inside it.
    var anchorId = h.id;
    if (!anchorId) {
      var button = sectionButtonFor(h);
      if (button && button.id) anchorId = button.id;
    }
    if (!anchorId) anchorId = h.id = slugify(h.textContent);

    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#' + anchorId;
    a.textContent = h.textContent;
    li.appendChild(a);

    if (h.tagName === 'H2') {
      list.appendChild(li);
      subList = null;
    } else { // H3 -> nest under the most recent H2
      var parentLi = list.lastElementChild;
      if (parentLi) {
        if (!subList) {
          subList = document.createElement('ul');
          parentLi.appendChild(subList);
        }
        subList.appendChild(li);
      } else {
        list.appendChild(li); // orphan H3 with no preceding H2
      }
    }
  });

  // If a manual list sits immediately after the Contents heading, replace
  // it; otherwise insert the generated list right after the heading. We only
  // look at the immediate sibling so we never grab a content list deeper down.
  var next = contentsHeading.nextElementSibling;
  if (next && next.tagName === 'UL') {
    next.parentNode.replaceChild(list, next);
  } else {
    contentsHeading.parentNode.insertBefore(list, contentsHeading.nextSibling);
  }
})();
