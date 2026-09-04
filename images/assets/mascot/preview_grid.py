from PIL import Image
import os
d = r'E:\Projects\website-group\nathanpenny.fun\images\assets\mascot\transparent'
files = ['expr-happy.png','expr-surprised.png','expr-sleepy.png','expr-excited.png',
         'act-waving.png','act-coding.png','act-jumping.png','act-reading.png','act-hugging.png','act-sleepy.png']
cell_w, cell_h = 320, 320
cols, rows = 5, 2
bg = Image.new('RGB', (cols*cell_w, rows*cell_h), (23,29,36))
for i, f in enumerate(files):
    im = Image.open(os.path.join(d, f)).convert('RGBA')
    im.thumbnail((cell_w-16, cell_h-16))
    x = (i % cols)*cell_w + (cell_w-im.width)//2
    y = (i // cols)*cell_h + (cell_h-im.height)//2
    bg.paste(im, (x, y), im)
bg.save(r'E:\Projects\website-group\nathanpenny.fun\images\assets\mascot\preview-grid.jpg', quality=90)
print('grid saved', bg.size)
