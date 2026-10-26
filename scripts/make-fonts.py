# 앱이 쓰는 글자만 남긴 웹 글꼴을 만든다(Pretendard, Gowun Batang, 둘 다 SIL OFL 1.1).
# 원본 글꼴은 저장소에 넣지 않는다. 받아서 경로를 넘긴다:
#   pip install fonttools brotli
#   python3 scripts/make-fonts.py PretendardVariable.ttf GowunBatang-Regular.ttf GowunBatang-Bold.ttf
# 화면 글이 바뀌면 다시 돌린다. 빠진 글자(남의 한글 이름 등)는 기기 글꼴로 보인다.
import glob, os, sys
from fontTools import subset

pretendard, batang_regular, batang_bold = sys.argv[1:4]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
text = ''
for path in ['index.html', *glob.glob('src/*.js')]:
    text += open(os.path.join(root, path), encoding='utf-8').read()
chars = {c for c in text if ord(c) > 0x7e} | {chr(c) for c in range(0x20, 0x7f)} | set('·–—…→←↑↓−×✓')
# 날짜·숫자 표시에 쓰는 글자
chars |= set('0123456789년월일시분초전후오늘어제주달화수목금토요')
out = os.path.join(root, 'vendor', 'fonts')
os.makedirs(out, exist_ok=True)

def make(src, name):
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    font = subset.load_font(src, opts)
    s = subset.Subsetter(opts)
    s.populate(text=''.join(sorted(chars)))
    s.subset(font)
    dest = os.path.join(out, name)
    subset.save_font(font, dest, opts)
    print(name, os.path.getsize(dest) // 1024, 'KB')

make(pretendard, 'pretendard.woff2')
make(batang_regular, 'gowun-batang-400.woff2')
make(batang_bold, 'gowun-batang-700.woff2')
print(len(chars), '글자')
