// Dark-mode toggle. The flash-free inline <head> script already set
// document.documentElement[data-theme] from localStorage before paint;
// this only builds the button and handles clicks.
(function () {
  var root = document.documentElement;

  function systemPrefersDark() {
    return window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // Effective theme = explicit override if set, else the OS preference.
  function isDark() {
    var t = root.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return systemPrefersDark();
  }

  var btn = document.createElement('button');
  btn.id = 'theme-toggle';
  btn.type = 'button';

  function render() {
    var dark = isDark();
    btn.textContent = dark ? 'D' : 'L'; // current mode: D = dark, L = light
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.setAttribute('title', dark ? 'Switch to light mode' : 'Switch to dark mode');
  }

  // PowerPoint-style transition effects, picked at random on each toggle.
  // Each value maps to a keyframe block in main.css via [data-transition].
  var EFFECTS = ['wipe', 'circle', 'split', 'cover', 'dissolve', 'corners'];
  var lastEffect = null;

  // Pick a random effect, never the same one twice in a row.
  function pickEffect() {
    var choice;
    do {
      choice = EFFECTS[Math.floor(Math.random() * EFFECTS.length)];
    } while (choice === lastEffect);
    lastEffect = choice;
    return choice;
  }

  btn.addEventListener('click', function (e) {
    var next = isDark() ? 'light' : 'dark';
    function apply() {
      root.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      render();
    }
    // Animate the swap with a randomly chosen effect where supported;
    // browsers without the View Transitions API switch instantly.
    if (document.startViewTransition) {
      var effect = pickEffect();
      root.setAttribute('data-transition', effect);
      // Origin for the circle/iris reveal: a randomly chosen corner, so the
      // semi-circle sweeps out from a different corner each time.
      if (effect === 'circle') {
        var corners = ['0% 0%', '100% 0%', '0% 100%', '100% 100%'];
        var corner = corners[Math.floor(Math.random() * corners.length)].split(' ');
        root.style.setProperty('--vt-x', corner[0]);
        root.style.setProperty('--vt-y', corner[1]);
      }
      var vt = document.startViewTransition(apply);
      vt.finished.finally(function () {
        root.removeAttribute('data-transition');
      });
    } else {
      apply();
    }
  });

  // If the user has no explicit choice, follow live OS changes.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (!localStorage.getItem('theme')) render();
    });
  }

  render();
  document.body.appendChild(btn);
})();
