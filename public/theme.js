// The reader's theme pick, applied before the first paint (src/app/theme.ts keeps it).
try {
  var theme = localStorage.getItem('lcf.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
} catch (e) {}
