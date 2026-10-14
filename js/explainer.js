/*
 * Explainer shell (see ARCHITECTURE.md, "Explainers"). A classic script (no
 * modules, so pages work opened straight from disk) that defines a global
 * Explainer = { init, cssVar, onThemeChange, isDark }. No dependencies.
 *
 * The page writes its prose by hand as <section class="xp-topic"> blocks inside
 * #xp-library. This module turns that article into an app: it stamps
 * html.xp-ready (which switches css/explainer.css from article layout to app
 * layout), builds the Explore menu from the sections, shows one section at a
 * time in the drawer, and keeps the URL hash in step so every topic has a link
 * that can be shared and that the back button understands.
 *
 * Section attributes:
 *   id           the topic's anchor (#id opens it)
 *   data-title   menu and breadcrumb title (defaults to the first heading)
 *   data-group   menu group; groups appear in order of first use
 *   data-next    id of the topic to suggest next, rendered as a link at the end;
 *                the topic that names a section this way is that section's
 *                "Previous" link
 *
 * Any <a href="#id"> or [data-open="id"] anywhere on the page opens a topic.
 */
(function (global) {
'use strict';

function initExplainer({ onOpen, onClose } = {}) {
  const root = document.documentElement;
  const library = document.getElementById('xp-library');
  const drawer = document.getElementById('xp-drawer');
  const body = drawer.querySelector('.xp-drawer-body');
  const crumb = drawer.querySelector('.xp-crumb');
  const closeBtn = drawer.querySelector('.xp-close');
  const menu = document.getElementById('xp-menu');
  const menuBtn = document.getElementById('xp-menu-btn');

  const sections = Array.prototype.slice.call(library.querySelectorAll('section.xp-topic'));
  const byId = new Map(sections.map((s) => [s.id, s]));
  const titleOf = (s) => s.dataset.title || (s.querySelector('h2, h3') || {}).textContent || s.id;
  let current = null;

  root.classList.add('xp-ready');
  sections.forEach((s) => { s.hidden = true; });

  // "Previous" and "Next" links at the foot of each topic. Next is the topic
  // it names; previous is the first topic that names it, so both follow the
  // same guided tour. A topic that starts a tour falls back to the topic just
  // before it on the page, so only the first topic has no Previous.
  const prevOf = new Map();
  sections.forEach((s) => {
    const n = s.dataset.next;
    if (n && byId.has(n) && !prevOf.has(n)) prevOf.set(n, s);
  });
  sections.forEach((s, i) => { if (i > 0 && !prevOf.has(s.id)) prevOf.set(s.id, sections[i - 1]); });
  sections.forEach((s) => {
    const next = s.dataset.next && byId.get(s.dataset.next);
    const prev = prevOf.get(s.id);
    if (!next && !prev) return;
    const nav = document.createElement('p');
    nav.className = 'xp-next';
    const left = document.createElement(prev ? 'a' : 'span');
    if (prev) {
      left.href = '#' + prev.id;
      left.className = 'xp-prev-link';
      left.textContent = '← Previous: ' + titleOf(prev);
    }
    nav.appendChild(left);
    if (next) {
      const link = document.createElement('a');
      link.href = '#' + next.id;
      link.className = 'xp-next-link';
      link.textContent = 'Next: ' + titleOf(next) + ' →';
      nav.appendChild(link);
    }
    s.appendChild(nav);
  });

  // ----- Explore menu, grouped, with a filter box -----
  const links = new Map();
  if (menu) {
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Filter topics';
    search.setAttribute('aria-label', 'Filter topics');
    menu.appendChild(search);

    const groups = new Map();
    sections.forEach((s) => {
      const g = s.dataset.group || 'Topics';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(s);
    });
    groups.forEach((list, name) => {
      const h = document.createElement('h3');
      h.textContent = name;
      const ul = document.createElement('ul');
      list.forEach((s) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#' + s.id;
        a.textContent = titleOf(s);
        li.appendChild(a);
        ul.appendChild(li);
        links.set(s.id, a);
      });
      menu.appendChild(h);
      menu.appendChild(ul);
    });

    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      menu.querySelectorAll('ul').forEach((ul) => {
        let shown = 0;
        ul.querySelectorAll('li').forEach((li) => {
          const s = byId.get(li.firstChild.hash.slice(1));
          const hit = !q || li.textContent.toLowerCase().includes(q) || s.textContent.toLowerCase().includes(q);
          li.hidden = !hit;
          if (hit) shown++;
        });
        ul.hidden = shown === 0;
        ul.previousElementSibling.hidden = shown === 0;
      });
    });
  }

  // "Contents" in the drawer header reopens the Explore menu without leaving
  // the topic (on wide screens the menu sits beside the drawer).
  let contentsBtn = null;
  const head = drawer.querySelector('.xp-drawer-head');
  if (menu && head) {
    contentsBtn = document.createElement('button');
    contentsBtn.type = 'button';
    contentsBtn.className = 'xp-chip xp-contents';
    contentsBtn.textContent = '← Contents';
    contentsBtn.setAttribute('aria-controls', menu.id);
    contentsBtn.setAttribute('aria-expanded', 'false');
    head.insertBefore(contentsBtn, head.firstChild);
    contentsBtn.addEventListener('click', () => setMenu(menu.hidden));
  }

  function setMenu(openState) {
    if (!menu) return;
    menu.hidden = !openState;
    if (menuBtn) menuBtn.setAttribute('aria-expanded', String(openState));
    if (contentsBtn) contentsBtn.setAttribute('aria-expanded', String(openState));
    if (openState) {
      const s = menu.querySelector('input');
      if (s && window.matchMedia('(pointer: fine)').matches) s.focus();
    }
  }

  if (menuBtn) menuBtn.addEventListener('click', () => setMenu(menu.hidden));

  // ----- Drawer -----
  function open(id, { push = true } = {}) {
    const s = byId.get(id);
    if (!s) return;
    if (current && current !== s) current.hidden = true;
    s.hidden = false;
    const prev = current;
    current = s;
    crumb.textContent = (s.dataset.group ? s.dataset.group + ' › ' : '') + titleOf(s);
    body.scrollTop = 0;
    root.classList.add('xp-drawer-open');
    drawer.setAttribute('aria-hidden', 'false');
    links.forEach((a, key) => a.setAttribute('aria-current', String(key === id)));
    setMenu(false);
    if (push && location.hash !== '#' + id) setURL('#' + id);
    const h = s.querySelector('h2');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    if (onOpen) onOpen(id, s, prev ? prev.id : null);
  }

  function close({ push = true } = {}) {
    if (!current) return;
    const id = current.id;
    current.hidden = true;
    current = null;
    root.classList.remove('xp-drawer-open');
    drawer.setAttribute('aria-hidden', 'true');
    links.forEach((a) => a.setAttribute('aria-current', 'false'));
    if (push && location.hash) setURL(location.pathname + location.search);
    if (onClose) onClose(id);
  }

  if (closeBtn) closeBtn.addEventListener('click', () => close());

  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-open]');
    if (opener && byId.has(opener.dataset.open)) {
      e.preventDefault();
      open(opener.dataset.open);
      return;
    }
    const a = e.target.closest('a[href^="#"]');
    if (a) {
      const id = decodeURIComponent(a.hash.slice(1));
      if (byId.has(id)) { e.preventDefault(); open(id); }
      return;
    }
    if (menu && !menu.hidden && !e.target.closest('#xp-menu, #xp-menu-btn, .xp-contents')) setMenu(false);
  });

  // Some browsers refuse pushState on file:// pages; a plain hash change
  // still gives a history entry.
  function setURL(url) {
    try { history.pushState(null, '', url); } catch (e) { location.hash = url.charAt(0) === '#' ? url : ''; }
  }

  function onNavigate() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (current && current.id === id) return;
    if (byId.has(id)) open(id, { push: false });
    else close({ push: false });
  }
  window.addEventListener('popstate', onNavigate);
  window.addEventListener('hashchange', onNavigate);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (menu && !menu.hidden) setMenu(false);
    else if (current) close();
  });

  const start = decodeURIComponent(location.hash.slice(1));
  if (byId.has(start)) requestAnimationFrame(() => open(start, { push: false }));

  return {
    open,
    close,
    sections,
    byId,
    get current() { return current ? current.id : null; },
  };
}

// Read a CSS custom property off <html> (theme tokens change with the theme).
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Run `cb` whenever the effective theme may have changed: the toggle stamps
// data-theme on <html>, and the OS preference can flip underneath.
function onThemeChange(cb) {
  new MutationObserver(cb).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', cb);
}

function isDark() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

global.Explainer = { init: initExplainer, cssVar, onThemeChange, isDark };
})(window);
