/*
 * Household quantities for checklist pages, no dependencies.
 *
 * A list item's amount lives in a tag after its name:
 *
 *   <b>Headlamps</b> <span class="qty" data-qty="1" data-per="person"
 *     data-price="35">1 per person</span>: ...
 *
 *   data-qty     amount for one unit of data-per over data-base days
 *   data-per     household (default), person (adults + kids), everyone
 *                (adds babies), adult, kid, baby, dog, cat, or pet
 *   data-scale   fixed (default), linear, or sqrt: how the amount grows
 *                with the number of days
 *   data-base    days data-qty covers (default 14)
 *   data-window  first: only the first 14 days count (Tier 1 food, stored
 *                water); rest: only the days after those 14 (Tier 2 food)
 *   data-min     smallest amount once there's any need at all
 *   data-unit    "gal", or "jar|jars"; none shows a count like "x3"
 *   data-price   rough US dollars per unit, for cost totals
 *
 * The tag's own text is the static amount (one person, a 30-day plan) that
 * shows without JavaScript and in the shared PDF. This script replaces it
 * with the total for the household the reader enters, hides items that come
 * to zero (no babies, no pets, a plan too short for Tier 2 food), and hides
 * any group left empty.
 *
 * On the post itself (when #household-panel exists) it also:
 *   - reads the household from the URL (?adults=2&kids=1&days=30), else
 *     from this browser, else the defaults, and keeps both up to date;
 *   - fills <span data-cost-for="h3-id"> with that section's total cost;
 *   - adds a check-off box to items under <h3 data-have>, remembered in
 *     this browser, and counts progress;
 *   - copies a shopping list of unchecked items under <h3 data-shop>;
 *   - shares a link with the household filled in;
 *   - points "Print my list" at the checklist page with the same numbers.
 *
 * On the generated checklist page (when #hh-toolbar exists) it shows who
 * the list is for and a print button.
 */
(function () {
  var DEFAULTS = { adults: 1, kids: 0, babies: 0, dogs: 0, cats: 0, days: 30 };
  var FIELDS = ['adults', 'kids', 'babies', 'dogs', 'cats', 'days'];
  var NAMES = {
    adults: ['adult', 'adults'], kids: ['kid', 'kids'], babies: ['baby', 'babies'],
    dogs: ['dog', 'dogs'], cats: ['cat', 'cats']
  };
  var STATE_KEY = 'household';
  var HAVE_KEY = 'household-have:' + location.pathname;

  var qtys = Array.prototype.slice.call(document.querySelectorAll('.qty[data-qty]'));
  var panel = document.getElementById('household-panel');
  var toolbar = document.getElementById('hh-toolbar');
  if (!qtys.length) return;

  // ----- Storage (private windows and blocked storage just forget) -----
  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  // ----- Household state -----
  function clean(field, value) {
    if (value === null || value === undefined || value === '') return DEFAULTS[field];
    var n = Math.floor(Number(value));
    if (isNaN(n)) return DEFAULTS[field];
    return field === 'days' ? Math.min(365, Math.max(1, n)) : Math.min(99, Math.max(0, n));
  }

  function readState() {
    var params = new URLSearchParams(location.search);
    var stored = load(STATE_KEY) || {};
    var state = {};
    FIELDS.forEach(function (f) {
      state[f] = clean(f, params.has(f) ? params.get(f) : stored[f]);
    });
    return state;
  }

  function counts(s) {
    var people = s.adults + s.kids;
    if (people + s.babies === 0) people = 1;  // an empty household still gets one person's list
    return {
      household: 1, person: people, everyone: people + s.babies,
      adult: s.adults, kid: s.kids, baby: s.babies,
      dog: s.dogs, cat: s.cats, pet: s.dogs + s.cats
    };
  }

  function query(s) {
    return FIELDS.map(function (f) { return f + '=' + s[f]; }).join('&');
  }

  function describe(s) {
    var parts = [];
    ['adults', 'kids', 'babies', 'dogs', 'cats'].forEach(function (f) {
      if (s[f]) parts.push(s[f] + ' ' + NAMES[f][s[f] === 1 ? 0 : 1]);
    });
    if (!parts.length) parts.push('1 adult');
    return parts.join(', ') + ', ' + s.days + (s.days === 1 ? ' day' : ' days');
  }

  // ----- Amounts -----
  function amount(el, s, c) {
    var d = el.dataset;
    var per = c[d.per || 'household'] || 0;
    if (!per) return 0;
    var days = s.days;
    if (d.window === 'first') days = Math.min(days, 14);
    if (d.window === 'rest') days = Math.max(days - 14, 0);
    if (d.window && !days) return 0;
    var ratio = days / Number(d.base || 14);
    var factor = d.scale === 'linear' ? ratio : d.scale === 'sqrt' ? Math.sqrt(ratio) : 1;
    var n = Math.ceil(Number(d.qty) * per * factor - 1e-9);
    if (n > 0 && d.min) n = Math.max(n, Number(d.min));
    return n;
  }

  function label(n, unit) {
    if (!unit) return '×' + n.toLocaleString('en-US');
    var forms = unit.split('|');
    return n.toLocaleString('en-US') + ' ' + (n === 1 ? forms[0] : (forms[1] || forms[0]));
  }

  function money(n) {
    return '$' + (Math.round(n / 10) * 10).toLocaleString('en-US');
  }

  function hide(el) {
    if (!el.hidden) {
      el.hidden = true;
      el.classList.add('hh-empty');
    }
  }

  // A list hides when all its items are hidden, or when every item with an
  // amount is (taking the advice beside them along). So does the group item
  // that holds it or, on the checklist page, the group heading above it.
  function hideEmptyLists() {
    Array.prototype.forEach.call(document.querySelectorAll('.hh-empty'), function (el) {
      el.hidden = false;
      el.classList.remove('hh-empty');
    });
    var lists = document.querySelectorAll('ul, ol');
    for (var i = lists.length - 1; i >= 0; i--) {  // deepest first
      var list = lists[i];
      var items = Array.prototype.filter.call(list.children, function (el) {
        return el.tagName === 'LI';
      });
      var tagged = items.filter(function (li) { return li.querySelector(':scope > .qty'); });
      var allHidden = items.length && items.every(function (li) { return li.hidden; });
      var amountsHidden = tagged.length && tagged.every(function (li) { return li.hidden; });
      if (!allHidden && !amountsHidden) continue;
      items.forEach(hide);
      hide(list);
      if (list.parentElement.tagName === 'LI') hide(list.parentElement);
      var heading = list.previousElementSibling;
      if (heading && heading.tagName === 'H3' && list.parentElement.tagName === 'SECTION') hide(heading);
    }
  }

  // ----- Sections, for costs and check-offs -----
  var headings = Array.prototype.slice.call(document.querySelectorAll('h3[id]'));

  function sectionOf(el) {
    var found = null;
    headings.forEach(function (h) {
      if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) found = h;
    });
    return found;
  }

  var sectionIds = qtys.map(function (el) {
    var h = sectionOf(el);
    return h ? h.id : '';
  });

  // ----- Check-offs -----
  var have = load(HAVE_KEY) || [];
  var items = [];

  function isVisible(el) {
    return !el.closest('[hidden]');
  }

  function firstBold(li) {
    var first = li.firstElementChild;
    if (first && first.tagName === 'INPUT') first = first.nextElementSibling;
    return first && first.tagName === 'B' ? first : null;
  }

  function groupName(li) {
    var group = li.parentElement.closest('li');
    var b = group ? firstBold(group) : null;
    return b ? b.textContent.trim().replace(/\.$/, '') : '';
  }

  // The <li>s from a heading to the next <h2>/<h3>/<hr> that are things to
  // get or do: not advice (data-no-checklist), not notes, not groups.
  function itemsUnder(heading) {
    var found = [];
    for (var el = heading.nextElementSibling; el && !/^(H2|H3|HR)$/.test(el.tagName); el = el.nextElementSibling) {
      Array.prototype.forEach.call(el.querySelectorAll('li'), function (li) {
        if (li.hasAttribute('data-no-checklist')) return;
        if (li.querySelector(':scope > ul, :scope > ol')) return;
        if (!firstBold(li)) return;
        found.push(li);
      });
    }
    return found;
  }

  function setupChecks() {
    document.querySelectorAll('h3[data-have]').forEach(function (heading) {
      itemsUnder(heading).forEach(function (li) {
        var name = firstBold(li).textContent.trim();
        var group = groupName(li);
        var key = heading.id + '/' + (group ? group + '/' : '') + name;
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'have';
        box.checked = have.indexOf(key) !== -1;
        box.setAttribute('aria-label', 'I have: ' + name);
        li.insertBefore(box, li.firstChild);
        li.classList.add('checkable');
        li.classList.toggle('done', box.checked);
        box.addEventListener('change', function () {
          var at = have.indexOf(key);
          if (box.checked && at === -1) have.push(key);
          if (!box.checked && at !== -1) have.splice(at, 1);
          save(HAVE_KEY, have);
          li.classList.toggle('done', box.checked);
          summarize();
        });
        items.push({
          li: li, box: box, name: name, group: group,
          section: heading.textContent.trim(), shop: heading.hasAttribute('data-shop')
        });
      });
    });
  }

  // An item without an amount: the first sentence after its name.
  function gist(li) {
    var b = firstBold(li);
    var text = '';
    for (var node = b.nextSibling; node; node = node.nextSibling) text += node.textContent;
    text = text.replace(/\s+/g, ' ').replace(/^[\s,:]+/, '').trim();
    var end = text.search(/\.(?=\s+["“]?[A-Z0-9])/);
    return end === -1 ? text : text.slice(0, end + 1);
  }

  function shoppingList() {
    var lines = ['Shopping list for ' + describe(state), location.origin + location.pathname, ''];
    var section = null, group = null;
    items.forEach(function (item) {
      if (!item.shop || item.box.checked || !isVisible(item.li)) return;
      if (item.section !== section) {
        lines.push('', item.section.toUpperCase());
        section = item.section;
        group = null;
      }
      if (item.group && item.group !== group) {
        lines.push(item.group);
        group = item.group;
      }
      var qty = item.li.querySelector('.qty');
      lines.push('- ' + item.name + ': ' + (qty ? qty.textContent : gist(item.li)));
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
  }

  // ----- Copying and sharing -----
  function flash(button, text) {
    var old = button.textContent;
    button.textContent = text;
    setTimeout(function () { button.textContent = old; }, 2000);
  }

  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(area);
  }

  function copy(text, button, done) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { flash(button, done); }, function () {
        fallbackCopy(text);
        flash(button, done);
      });
    } else {
      fallbackCopy(text);
      flash(button, done);
    }
  }

  // ----- Updating everything -----
  var state = readState();

  function summarize() {
    var summary = document.getElementById('hh-summary');
    if (!summary) return;
    var total = 0, extras = 0;
    qtys.forEach(function (el, i) {
      var cost = Number(el.dataset.price || 0) * Number(el.dataset.total || 0);
      total += cost;
      if (sectionIds[i] === 'tier_3') extras += cost;
    });
    var shown = items.filter(function (item) { return isVisible(item.li); });
    var got = shown.filter(function (item) { return item.box.checked; });
    summary.textContent = 'For ' + describe(state) + ': about ' + money(total - extras) +
      (extras ? ', or ' + money(total) + ' with Tier 3' : '') +
      '. You have ' + got.length + ' of ' + shown.length + ' items.';
  }

  function update() {
    var c = counts(state);
    var costs = {};
    qtys.forEach(function (el, i) {
      var n = amount(el, state, c);
      el.textContent = label(n, el.dataset.unit);
      el.dataset.total = n;
      var li = el.closest('li');
      if (li) li.hidden = n === 0;
      costs[sectionIds[i]] = (costs[sectionIds[i]] || 0) + Number(el.dataset.price || 0) * n;
    });
    hideEmptyLists();
    Array.prototype.forEach.call(document.querySelectorAll('[data-cost-for]'), function (el) {
      el.textContent = money(costs[el.getAttribute('data-cost-for')] || 0);
    });
    var print = document.getElementById('hh-print');
    if (print) print.href = print.getAttribute('data-href') + '?' + query(state);
    Array.prototype.forEach.call(document.querySelectorAll('[data-days-preset]'), function (b) {
      b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-days-preset')) === state.days));
    });
    summarize();
  }

  // ----- The post: inputs, presets and buttons -----
  if (panel) {
    panel.hidden = false;
    setupChecks();

    var remember = function () {
      save(STATE_KEY, state);
      try {
        history.replaceState(null, '', location.pathname + '?' + query(state) + location.hash);
      } catch (e) {}
    };

    FIELDS.forEach(function (f) {
      var input = document.getElementById('hh-' + f);
      if (!input) return;
      input.value = state[f];
      input.addEventListener('input', function () {
        state[f] = clean(f, input.value);
        update();
        remember();
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-days-preset]'), function (b) {
      b.addEventListener('click', function () {
        state.days = clean('days', b.getAttribute('data-days-preset'));
        document.getElementById('hh-days').value = state.days;
        update();
        remember();
      });
    });

    var shop = document.getElementById('hh-shop');
    if (shop) shop.addEventListener('click', function () {
      copy(shoppingList(), shop, 'Copied!');
    });

    var share = document.getElementById('hh-share');
    if (share) share.addEventListener('click', function () {
      var url = location.origin + location.pathname + '?' + query(state) + '#household';
      if (navigator.share) {
        navigator.share({ title: document.title, url: url }).catch(function () {});
      } else {
        copy(url, share, 'Link copied!');
      }
    });
  }

  // ----- The checklist page: who it's for, and printing -----
  if (toolbar) {
    toolbar.hidden = false;
    var note = document.getElementById('hh-note');
    if (note) note.textContent = 'Amounts for ' + describe(state) + '.';
    var printNow = document.getElementById('hh-print-now');
    if (printNow) printNow.addEventListener('click', function () { window.print(); });
  }

  update();
})();
