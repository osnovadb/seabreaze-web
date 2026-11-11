# Поэтажные планы BRABUS v2: план повёрнут горизонтально (коридор по горизонтали), плотная обрезка по зданию,
# контуры квартир прямыми линиями (прямоугольник, если квартира прямоугольная; иначе многоугольник из немногих сторон).
import csv, json, re, math, collections, numpy as np, cv2
from fp_lib import load, panel, highlight
rows=[r for r in csv.DictReader(open('map.csv')) if r['floor'] and r['name'] in ('Block A','Block B','Block C')]
by=collections.defaultdict(list)
for r in rows: by[(r['name'],int(r['floor']))].append(r)
def riser(n):
    n=re.sub(r'^[A-Z]-','',n); m=re.match(r'^(\d+)(.*)$',n)
    return m.group(1)[-2:]+m.group(2) if m and len(m.group(1))>=3 else n
UP=2.0  # увеличение исходной панели
FILLS=[]; FILL_RECT=0.8; NPOLY=[]
G=10  # шаг сетки прямолинейного контура, px картинки
def ortho(m):
    # контур квартиры только из отрезков вдоль её осей: маску поворачиваем по минимальному прямоугольнику, огрубляем до сетки G,
    # снимаем ступеньки в одну клетку, контур сетки — сплошь горизонтали и вертикали; почти прямоугольная квартира — просто прямоугольник
    cs,_=cv2.findContours(m,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE); cnt=max(cs,key=cv2.contourArea)
    rect=cv2.minAreaRect(cnt); (rcx,rcy),(rw,rh),ra_=rect
    FILLS.append(round(cv2.contourArea(cnt)/max(1,rw*rh),2))
    if cv2.contourArea(cnt)/max(1,rw*rh)>=FILL_RECT: return cv2.boxPoints(rect)
    R=cv2.getRotationMatrix2D((rcx,rcy),ra_,1.0); Ri=cv2.invertAffineTransform(R)
    a=cv2.warpAffine(m,R,(m.shape[1],m.shape[0]),flags=cv2.INTER_NEAREST)
    ys,xs=np.where(a>0); x0_,y0_=xs.min(),ys.min(); sub=a[y0_:ys.max()+1,x0_:xs.max()+1].astype(np.float32)
    gh,gw=max(1,round(sub.shape[0]/G)),max(1,round(sub.shape[1]/G))
    g=(cv2.resize(sub,(gw,gh),interpolation=cv2.INTER_AREA)>0.5).astype(np.uint8)
    g=cv2.morphologyEx(cv2.morphologyEx(g,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8)),cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
    g=np.pad(g,1)
    cs2,_=cv2.findContours(g,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    if not cs2: return cv2.boxPoints(rect)
    c2=max(cs2,key=cv2.contourArea).reshape(-1,2).astype(np.float32)
    if len(c2)<=4 or cv2.contourArea(c2)/max(1,g.sum())<0.5: return cv2.boxPoints(rect)
    # из координат клеток обратно в пиксели (контур клеток идёт по их центрам — расширяем на полклетки наружу)
    cx_,cy_=c2[:,0].mean(),c2[:,1].mean()
    c2=c2+np.where(c2>[cx_,cy_],0.5,-0.5)
    sx,sy=sub.shape[1]/gw,sub.shape[0]/gh
    pts=np.stack([(c2[:,0]-1)*sx+x0_+sx/2,(c2[:,1]-1)*sy+y0_+sy/2],axis=1)
    pts=cv2.transform(pts.reshape(-1,1,2),Ri).reshape(-1,2)
    return pts.astype(np.float32)
out=[]
for (blk,fl),us in sorted(by.items()):
    crops=[]
    for u in us:
        g=load(u['filename_disk']); X,Y,W,H=panel(g); crops.append((u,g[Y:Y+H,X:X+W]))
    h0,w0=min(c.shape[0] for _,c in crops),min(c.shape[1] for _,c in crops)
    stack=np.stack([c[:h0,:w0] for _,c in crops]); ref=np.median(stack,axis=0).astype(np.uint8)
    masks=[]
    for i,(u,c) in enumerate(crops):
        (dx,dy),_=cv2.phaseCorrelate(np.float32(ref),np.float32(stack[i])); dx,dy=int(round(dx)),int(round(dy))
        if abs(dx)>40 or abs(dy)>40: dx=dy=0
        stack[i]=np.roll(stack[i],(-dy,-dx),axis=(0,1))
    base=np.median(stack,axis=0).astype(np.uint8)
    for i,(u,c) in enumerate(crops):
        # выделенная квартира — единственное, чем лист темнее чистого плана этажа (сады и штриховка есть на всех листах)
        d=((base.astype(int)-stack[i].astype(int))>28).astype(np.uint8)
        d=cv2.morphologyEx(d,cv2.MORPH_OPEN,np.ones((3,3),np.uint8)); d=cv2.morphologyEx(d,cv2.MORPH_CLOSE,np.ones((11,11),np.uint8))
        n_,lab,st_,_=cv2.connectedComponentsWithStats(d)
        if n_<2 or st_[1:,4].max()<600: masks.append((u,None)); continue
        masks.append((u,(lab==1+int(np.argmax(st_[1:,4]))).astype(np.uint8)))
    base=cv2.resize(base,None,fx=UP,fy=UP,interpolation=cv2.INTER_LANCZOS4)
    masks=[(u,None if m is None else cv2.resize(m,(base.shape[1],base.shape[0]),interpolation=cv2.INTER_NEAREST)) for u,m in masks]
    # ось здания — по объединению квартир: длинная сторона минимального прямоугольника
    allm=np.zeros(base.shape,np.uint8)
    for _,m in masks:
        if m is not None: allm|=m
    pts=cv2.findNonZero(allm); box=cv2.boxPoints(cv2.minAreaRect(pts))
    e=[box[1]-box[0],box[2]-box[1]]; v=max(e,key=lambda a:np.hypot(*a))
    ang=math.degrees(math.atan2(v[1],v[0]))  # угол длинной оси в координатах картинки (y вниз)
    if ang>90: ang-=180
    if ang<-90: ang+=180
    Hh,Ww=base.shape; cx,cy=Ww/2,Hh/2
    M=cv2.getRotationMatrix2D((cx,cy),ang,1.0)  # поворот на ang против часовой → ось горизонтальна
    cos,sin=abs(M[0,0]),abs(M[0,1]); nW,nH=int(Hh*sin+Ww*cos),int(Hh*cos+Ww*sin)
    M[0,2]+=nW/2-cx; M[1,2]+=nH/2-cy
    rb=cv2.warpAffine(base,M,(nW,nH),flags=cv2.INTER_LINEAR,borderValue=245)
    rm=[(u,None if m is None else cv2.warpAffine(m,M,(nW,nH),flags=cv2.INTER_NEAREST)) for u,m in masks]
    # обрезка по зданию: чертёж (тёмное) в пределах квартир с запасом — стрелка севера и подпись остаются за кадром
    ra=cv2.warpAffine(allm,M,(nW,nH),flags=cv2.INTER_NEAREST); ys,xs=np.where(ra>0)
    pad=int(0.05*(ys.max()-ys.min()))
    win=np.zeros_like(ra); win[max(0,ys.min()-pad):ys.max()+pad, max(0,xs.min()-pad):xs.max()+pad]=1
    ink=((rb<170)&(win>0)).astype(np.uint8); ink=cv2.morphologyEx(ink,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
    # только линии, связанные со зданием: подписи и стрелка — отдельные мелкие компоненты в стороне
    near=cv2.dilate(ra,np.ones((41,41),np.uint8)); n_,lab,st_,_=cv2.connectedComponentsWithStats(ink)
    keep=np.zeros(n_,bool); keep[np.unique(lab[(near>0)&(ink>0)])]=True; keep[0]=False
    ink=keep[lab].astype(np.uint8)
    dark=(rb<215).astype(np.uint8); n2,lab2,_,_=cv2.connectedComponentsWithStats(dark)
    k2=np.zeros(n2,bool); k2[np.unique(lab2[(near>0)&(dark>0)])]=True; k2[0]=True
    rb[~k2[lab2]]=255  # подпись FLOOR PLAN, стрелка севера и прочее в стороне от здания
    # кадр = чертёж здания ∪ все квартиры (сады 3-го этажа выходят за стены)
    ys,xs=np.where((ink>0)|(ra>0)); m_=20
    x0,x1,y0,y1=max(0,xs.min()-m_),min(nW,xs.max()+m_),max(0,ys.min()-m_),min(nH,ys.max()+m_)
    img=rb[y0:y1,x0:x1].copy(); img[img>232]=255  # светло-серый фон панели → белый
    cw,ch=x1-x0,y1-y0
    cells=[]; dbg=cv2.cvtColor(img,cv2.COLOR_GRAY2BGR); ov=dbg.copy()
    allr=np.zeros((nH,nW),np.uint16)
    for k,(u,m) in enumerate(rm):
        if m is not None: allr[m>0]=k+1
    for k,(u,m) in enumerate(rm):
        if m is None: print('  без контура',u['number']); continue
        poly=ortho(m)
        if len(poly)==4:
            # прямоугольник не должен заходить на соседние квартиры (угловые со скруглённым фасадом)
            t=np.zeros((nH,nW),np.uint8); cv2.fillPoly(t,[poly.astype(np.int32)],1)
            if ((allr>0)&(allr!=k+1)&(t>0)).sum()>0.03*t.sum() or m.sum()<0.85*t.sum():
                cs,_=cv2.findContours(m,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE); cnt=max(cs,key=cv2.contourArea)
                poly=cv2.approxPolyDP(cnt,0.006*cv2.arcLength(cnt,True),True).reshape(-1,2).astype(np.float32); NPOLY.append(u['number'])
        poly=poly-[x0,y0]
        cells.append({'riser':riser(u['number']),'points':[[round(float(px)/cw,4),round(float(py)/ch,4)] for px,py in poly]})
        cv2.fillPoly(ov,[poly.astype(np.int32)],(170,205,180)); cv2.polylines(dbg,[poly.astype(np.int32)],True,(40,90,50),3)
        c0=poly.mean(axis=0).astype(int); cv2.putText(dbg,riser(u['number']),(c0[0]-14,c0[1]+7),cv2.FONT_HERSHEY_SIMPLEX,0.7,(30,60,40),2)
    dbg=cv2.addWeighted(ov,0.55,dbg,0.45,0); dbg=np.minimum(dbg,cv2.cvtColor(img,cv2.COLOR_GRAY2BGR))
    north=round((-ang)%360)  # север был вверх; картинка повёрнута на ang против часовой
    name=f"{blk[-1]}-{fl:02d}"
    cv2.imwrite(f'out/{name}.jpg',img,[cv2.IMWRITE_JPEG_QUALITY,90]); cv2.imwrite(f'dbg/{name}.jpg',dbg,[cv2.IMWRITE_JPEG_QUALITY,80])
    out.append({'block':blk,'floor':fl,'file':f'{name}.jpg','cells':cells,'north':north or 360})
    print(blk,fl,'cells',len(cells),'/',len(us),'img',(cw,ch),'angle',round(ang,1),'north',north)
print('многоугольник вместо прямоугольника:',len(NPOLY),NPOLY[:12]); import collections as _c; print(sorted(_c.Counter(round(f,1) for f in FILLS).items()))
json.dump(out,open('out/plans.json','w')); print('plans',len(out))
