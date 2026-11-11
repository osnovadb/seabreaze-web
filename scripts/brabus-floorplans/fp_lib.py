import numpy as np, cv2
from PIL import Image
def load(f): return np.asarray(Image.open('sheets/'+f).convert('L'))
def panel(g):
    # панели листа — светло-серые прямоугольники (~244); берём самый нижний правый крупный
    m=((g>=238)&(g<=249)).astype(np.uint8)
    m=cv2.morphologyEx(m,cv2.MORPH_OPEN,np.ones((15,15),np.uint8))
    n,lab,st,_=cv2.connectedComponentsWithStats(m)
    H,W=g.shape; best=None
    for i in range(1,n):
        x,y,w,h,a=st[i]
        if w*h<0.04*W*H: continue
        sc=(x+w)/W+(y+h)/H+x/W*0.5+y/H*0.5
        if best is None or sc>best[0]: best=(sc,(x,y,w,h))
    return best[1]
def highlight(c):
    # выделенная квартира — заливка средне-серым (≈150–215), тёмные линии и светлый фон отбрасываем
    m=((c>=140)&(c<=222)).astype(np.uint8)
    m=cv2.morphologyEx(m,cv2.MORPH_OPEN,np.ones((5,5),np.uint8))
    m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,np.ones((9,9),np.uint8))
    n,lab,st,_=cv2.connectedComponentsWithStats(m)
    if n<2: return None
    i=1+int(np.argmax(st[1:,4]))
    return (lab==i).astype(np.uint8), st[i]
