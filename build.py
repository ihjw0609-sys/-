#!/usr/bin/env python3
"""src/game.html(원본 게임) + client/online.{css,js} → docs/index.html 생성.
원본은 수정하지 않고, 온라인 레이어만 주입합니다."""
import os, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from patches import PATCHES
root = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(root, 'src', 'game.html'), encoding='utf8').read()

# 방향키/타이핑이 게임 단축키(Tab=인벤토리 등)로 새지 않도록, 온라인 UI 안의 입력은 게임 핸들러보다 먼저 가로챔
GUARD = ("<script>for(const t of['keydown','keyup','keypress'])addEventListener(t,e=>{"
         "const n=e.target;if(n&&n.closest&&n.closest('.ol'))e.stopImmediatePropagation()},true)</script>")

# 원본 게임에 작은 수정 적용 (정확히 1곳에서 일치할 때만; 아니면 경고 후 건너뜀)
applied = skipped = 0
for name, old, new in PATCHES:
    n = src.count(old)
    if n != 1:
        print(f'::warning::패치 건너뜀 [{name}] — 일치 {n}곳 (게임이 업데이트되어 해당 부분이 바뀐 듯합니다)')
        skipped += 1
        continue
    src = src.replace(old, new, 1)
    applied += 1
print(f'patches: {applied} applied, {skipped} skipped')

assert src.count('</head><body>') == 1, '</head><body> 위치를 찾지 못했습니다'
assert src.rstrip().endswith('</body></html>') or src.rstrip().endswith('</html>'), '끝 태그 확인 필요'
out = src.replace('</head><body>', '<link rel="stylesheet" href="online.css"></head><body>' + GUARD, 1)
idx = out.rfind('</body>')
assert idx > 0
out = out[:idx] + '<script src="soldier_data.js"></script><script src="soldier.js"></script><script src="gameplay.js"></script><script src="config.js"></script><script src="online.js"></script>\n' + out[idx:]

os.makedirs(os.path.join(root, 'docs'), exist_ok=True)
open(os.path.join(root, 'docs', 'index.html'), 'w', encoding='utf8').write(out)
cfg = os.path.join(root, 'docs', 'config.js')
if not os.path.exists(cfg):
    open(cfg, 'w', encoding='utf8').write("// 서버 주소를 여기에 적으세요 (예: 'https://shadow-ext.onrender.com'). 비우면 이 페이지와 같은 주소를 사용합니다.\nwindow.SE_SERVER = '';\n")
for f in ('online.css', 'online.js', 'gameplay.js', 'soldier.js', 'soldier_data.js'):
    shutil.copy(os.path.join(root, 'client', f), os.path.join(root, 'docs', f))
print('built docs/index.html', len(out), 'bytes')
