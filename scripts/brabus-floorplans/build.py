# Поэтажные планы BRABUS из поквартирных листов застройщика: панель FLOOR PLAN, чистый план = попиксельный максимум по листам этажа,
# контур квартиры = серая заливка на её листе. Выход: out/*.jpg и out/plans.json
import csv, json, re, uuid, collections, numpy as np, cv2
from PIL import Image
from fp_lib import load, panel, highlight
rows=[r for r in csv.DictReader(open('map.csv')) if r['floor'] and r['name'] in ('Block A','Block B','Block C')]  # D — 14 разных крыльев на 1-м этаже, одним планом не ложится
by=collections.defaultdict(list)
for r in rows: by[(r['name'],int(r['floor']))].append(r)
def riser(n):
    n=re.sub(r'^[A-Z]-','',n); m=re.match(r'^(\d+)(.*)$',n)
    return m.group(1)[-2:]+m.group(2) if m and len(m.group(1))>=3 else n
out=[]; bad=[]
for (blk,fl),us in sorted(by.items()):
    crops=[]
    for u in us:
        g=load(u['filename_disk']); X,Y,W,H=panel(g); crops.append((u,g[Y:Y+H,X:X+W]))
    h0,w0=min(c.shape[0] for _,c in crops),min(c.shape[1] for _,c in crops)
    stack=np.stack([c[:h0,:w0] for _,c in crops])
    ref=np.median(stack,axis=0).astype(np.uint8)
    # листы этажа бывают сдвинуты на несколько пикселей: подгоняем каждый к медиане, сдвиг потом применяем и к контуру
    sh=[]
    for i in range(len(stack)):
        (dx,dy),_=cv2.phaseCorrelate(np.float32(ref),np.float32(stack[i])); dx,dy=int(round(dx)),int(round(dy))
        if abs(dx)>40 or abs(dy)>40: dx=dy=0
        stack[i]=np.roll(stack[i],(-dy,-dx),axis=(0,1)); sh.append((dx,dy))
    base=np.median(stack,axis=0).astype(np.uint8)
    # поля: обрезаем по чертежу (тёмные пиксели), подпись FLOOR PLAN внизу и стрелку севера оставляем вне кадра
    ink=(base<200).astype(np.uint8); ink[int(h0*0.9):,:]=0
    ys,xs=np.where(ink>0); x0,x1,y0,y1=max(0,xs.min()-15),min(w0,xs.max()+15),max(0,ys.min()-15),min(h0,ys.max()+15)
    # стрелку севера (правый верхний угол) не считаем чертежом, если она отдельно
    img=base[y0:y1,x0:x1]; k=2.0
    img=cv2.resize(img,None,fx=k,fy=k,interpolation=cv2.INTER_CUBIC)
    cells=[]; dbg=cv2.cvtColor(img,cv2.COLOR_GRAY2BGR)
    for (u,c),(dx,dy) in zip(crops,sh):
        h=highlight(c[:h0,:w0])
        if not h or h[1][4]<800: bad.append(u['number']); continue
        cs,_=cv2.findContours(h[0],cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE); cnt=max(cs,key=cv2.contourArea)
        ap=cv2.approxPolyDP(cnt,2.5,True).reshape(-1,2)-[dx,dy]
        pts=[[round((px-x0)/(x1-x0),4),round((py-y0)/(y1-y0),4)] for px,py in ap]
        cells.append({'riser':riser(u['number']),'points':pts,'unit':u['number']})
        cv2.polylines(dbg,[((ap-[x0,y0])*k).astype(np.int32)],True,(0,0,255),2)
        cx,cy=((ap-[x0,y0])*k).mean(axis=0).astype(int); cv2.putText(dbg,riser(u['number']),(cx-12,cy+6),cv2.FONT_HERSHEY_SIMPLEX,0.6,(200,0,0),2)
    dup=[r for r,n in collections.Counter(c['riser'] for c in cells).items() if n>1]
    if dup: print('dup riser',blk,fl,dup)
    name=f"{blk[-1]}-{fl:02d}"
    cv2.imwrite(f'out/{name}.jpg',img,[cv2.IMWRITE_JPEG_QUALITY,88]); cv2.imwrite(f'dbg/{name}.jpg',dbg,[cv2.IMWRITE_JPEG_QUALITY,75])
    out.append({'block':blk,'floor':fl,'file':f'{name}.jpg','cells':[{k2:v for k2,v in c.items() if k2!='unit'} for c in cells],'units':len(us)})
    print(blk,fl,'units',len(us),'cells',len(cells),'img',img.shape[::-1],'shift',max(max(abs(a),abs(b)) for a,b in sh))
json.dump(out,open('out/plans.json','w'))
print('plans',len(out),'no highlight',bad)
