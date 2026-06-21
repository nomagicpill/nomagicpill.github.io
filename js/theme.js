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

  btn.addEventListener('click', function () {
    var next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    render();
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
