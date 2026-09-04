from PIL import Image
import os
d = r'E:\Projects\website-group\nathanpenny.fun\images\assets\mascot'
out = os.path.join(d, 'singles')
os.makedirs(out, exist_ok=True)

im = Image.open(os.path.join(d, 'expressions.png'))
expr = {
  'expr-happy.png': (115, 265, 985, 1070),
  'expr-surprised.png': (1070, 265, 1945, 1070),
  'expr-sleepy.png': (115, 1135, 985, 1945),
  'expr-excited.png': (1070, 1135, 1945, 1945),
}
for name, box in expr.items():
    im.crop(box).save(os.path.join(out, name))

im2 = Image.open(os.path.join(d, 'actions.png'))
act = {
  'act-waving.png': (90, 175, 670, 618),
  'act-coding.png': (715, 175, 1305, 618),
  'act-jumping.png': (1350, 175, 1945, 618),
  'act-reading.png': (90, 655, 670, 1100),
  'act-hugging.png': (715, 655, 1305, 1100),
  'act-sleepy.png': (1350, 655, 1945, 1100),
}
for name, box in act.items():
    im2.crop(box).save(os.path.join(out, name))

for f in sorted(os.listdir(out)):
    p = os.path.join(out, f)
    print(f, Image.open(p).size)
