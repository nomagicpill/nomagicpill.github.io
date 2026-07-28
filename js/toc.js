/*
 * Lightweight reading enhancements, no dependencies:
 *   1. A scroll progress bar across the top of the page (left to right).
 *   2. An auto-generated table of contents built from the page's
 *      <h2> (main bullets) and <h3> (sub-bullets) headings.
 *
 * The TOC replaces the manual list that follows a `<h2 id="contents">`
 * heading. If there's no Contents heading, only the progress bar runs.
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

    if (!h.id) h.id = slugify(h.textContent);

    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#' + h.id;
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
