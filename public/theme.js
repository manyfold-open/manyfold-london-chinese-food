// The reader's theme pick, applied before the first paint (src/app/theme.ts keeps it), and the
// browser's bars painted to match.
try {
  var theme = localStorage.getItem('lcf.theme');
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
    var bars = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < bars.length; i++) bars[i].setAttribute('content', theme === 'dark' ? '#11141c' : '#faf7f0');
  }
} catch (e) {}
