"""Builds mock.html from src/: one self-contained page holding three views (mobile in Chinese,
mobile in English, desktop in either language), switched in the page so it never needs another file.
Run from this folder: python3 build.py"""

from pathlib import Path

here = Path(__file__).parent
src = here / 'src'
css = (src / 'base.css').read_text() + '\n' + (src / 'extra.css').read_text()
sprite = (src / 'sprite.html').read_text()
script = (
    'const DOTS = ' + (src / 'dots.json').read_text().strip() + ';\n'
    + 'const XLB_PTS = ' + (src / 'xlb-pts.json').read_text().strip() + ';\n'
    + (src / 'mock.js').read_text()
)
fonts = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900'
    '&family=DotGothic16&family=Fredoka:wdth,wght@75..125,300..700&family=Noto+Sans+SC:wght@400;500;700;900'
    '&family=ZCOOL+QingKe+HuangYou&display=swap" rel="stylesheet">'
)

# (view, language, body)
VIEWS = [
    ('mobile-zh', 'zh', 'mobile-zh.html'),
    ('mobile-en', 'en', 'mobile-en.html'),
    ('desktop', 'zh', 'desktop.html'),
]

switcher = (
    '<div class="mock-bar"><nav class="switcher">'
    '<span class="sw-label">MOCK v3</span>'
    '<button data-show-view="mobile-zh" class="on">手机 · 中文</button>'
    '<button data-show-view="mobile-en">Mobile · English</button>'
    '<button data-show-view="desktop">PC 桌面端</button>'
    '<span class="sep lang-only"></span>'
    '<button class="lang-only on" data-set-lang="zh">中文</button>'
    '<button class="lang-only" data-set-lang="en">English</button>'
    '</nav></div>'
)
views = '\n'.join(
    f'<section class="view" data-view="{name}" data-lang="{lang}"{" hidden" if i else ""}>\n{(src / body).read_text()}</section>'
    for i, (name, lang, body) in enumerate(VIEWS)
)
html = (
    '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    f'<title>伦敦干饭地图 · 改版 Mock v3</title>\n{fonts}\n<style>\n{css}</style>\n</head>\n<body>\n'
    f'{sprite}\n{switcher}\n{views}\n<script>\n{script}</script>\n</body>\n</html>\n'
)
(here / 'mock.html').write_text(html)
print('mock.html', len(html))
