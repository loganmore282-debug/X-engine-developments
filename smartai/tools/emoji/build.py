import numpy as np, cv2, sys, json, glob
from scipy import ndimage as ndi
from PIL import Image
from mk import fgmask
U='/root/.claude/uploads/6e968a67-1d52-514b-b29f-1e978d0788f5/'
IDS=['ad8fa5f4','9a024714','4bd7a077','643036cd','e955e5fc','74ff7d1f','65287abe']
FIN=176; FPS=20; COLS=10
import subprocess
def readall(path):
    cap=cv2.VideoCapture(path); w=int(cap.get(3)); h=int(cap.get(4)); cap.release()
    p=subprocess.Popen(['ffmpeg','-v','error','-i',path,'-vf','fps=60','-f','rawvideo','-pix_fmt','bgr24','-'],stdout=subprocess.PIPE)
    fr=[]; sz=w*h*3
    while True:
        b=p.stdout.read(sz)
        if len(b)<sz: break
        fr.append(np.frombuffer(b,np.uint8).reshape(h,w,3))
    return fr
def clean(fg):
    lbl,n=ndi.label(fg)
    if not n: return fg
    bad=set(np.unique(np.concatenate([lbl[0],lbl[-1],lbl[:,0],lbl[:,-1]])))-{0}
    sz=ndi.sum(fg,lbl,range(1,n+1))
    bad={b for b in bad if sz[b-1]<4000}
    return fg&~np.isin(lbl,list(bad))
def bg_model(fr,idx):
    h,w=fr[0].shape[:2]; yy,xx=np.mgrid[0:h:6,0:w:6]
    X=[];Y=[]
    for i in idx[::max(1,len(idx)//10)]:
        fg,_,_r=fgmask(fr[i]); near=ndi.binary_dilation(fg,iterations=6)
        sel=~near[::6,::6]
        x=xx[sel]/w; y=yy[sel]/h
        X.append(np.stack([np.ones_like(x),x,y,x*x,x*y,y*y,x**3,x*x*y,x*y*y,y**3],1)); Y.append(fr[i][::6,::6][sel].astype(np.float32))
    X=np.concatenate(X); Y=np.concatenate(Y)
    coef=np.linalg.lstsq(X,Y,rcond=None)[0]
    gy,gx=np.mgrid[0:h,0:w]; gx=gx/w; gy=gy/h
    F=np.stack([np.ones_like(gx),gx,gy,gx*gx,gx*gy,gy*gy,gx**3,gx*gx*gy,gx*gy*gy,gy**3],-1).astype(np.float32)
    model=F@coef
    res=np.abs(X@coef-Y).mean()
    return model,res
def mask_of(f,model):
    fg,_,raw=fgmask(f); fg=clean(fg)
    lbl,n=ndi.label(raw)
    for k in range(1,n+1):
        r=lbl==k
        if r.sum()<150: continue
        d=np.abs(f[r].astype(np.float32)-model[r]).mean()
        if d<14: fg=fg&~ndi.binary_dilation(r,iterations=2)
    return ndi.binary_erosion(fg,iterations=1)
def refine_lag(fr,guess):
    g=[cv2.cvtColor(cv2.resize(f,(0,0),fx=.2,fy=.2),cv2.COLOR_BGR2GRAY).astype(np.float32) for f in fr]
    n=len(g); best=None
    for L in range(guess-6,guess+7):
        d=np.mean([np.abs(g[i]-g[i+L]).mean() for i in range(20,n-L,3)])
        if best is None or d<best[0]: best=(d,L)
    return best[1]
def build(v):
    path=glob.glob(U+IDS[v-1]+'-*.mp4')[0]
    fr=readall(path); n=len(fr)
    guess=180 if v!=7 else 129
    L=refine_lag(fr,guess)
    i0=12
    while i0+L>=n: i0-=1
    N=int(round(L/60*FPS))
    idx=[i0+int(round(k*L/N)) for k in range(N)]
    model,res=bg_model(fr,idx)
    masks=[mask_of(fr[i],model) for i in idx]
    ys=np.concatenate([np.where(m.any(1))[0][[0,-1]] for m in masks]); xs=np.concatenate([np.where(m.any(0))[0][[0,-1]] for m in masks])
    y0,y1,x0,x1=ys.min(),ys.max(),xs.min(),xs.max()
    cy,cx=(y0+y1)/2,(x0+x1)/2; side=max(y1-y0,x1-x0)*1.06+8
    out=[]
    for i,m in zip(idx,masks):
        f=fr[i]
        # square crop at 2x final, padded with edge replicate
        S=FIN*2; sc=S/side
        M=np.array([[sc,0,S/2-cx*sc],[0,sc,S/2-cy*sc]],np.float32)
        col=cv2.warpAffine(f,M,(S,S),flags=cv2.INTER_AREA if sc<1 else cv2.INTER_CUBIC,borderMode=cv2.BORDER_REPLICATE)
        a=cv2.warpAffine(m.astype(np.float32),M,(S,S),flags=cv2.INTER_AREA if sc<1 else cv2.INTER_LINEAR,borderValue=0)
        core=a>0.97
        dist,(iy,ix)=ndi.distance_transform_edt(~core,return_indices=True)
        prop=col[iy,ix]
        use=(dist>0)&(dist<=3.5)
        col2=np.where(use[...,None],prop,col)
        rgba=np.dstack([cv2.cvtColor(col2,cv2.COLOR_BGR2RGB),(np.clip(a,0,1)*255).astype(np.uint8)])
        im=Image.fromarray(rgba).resize((FIN,FIN),Image.LANCZOS)
        out.append(im)
    rows=(N+COLS-1)//COLS
    sheet=Image.new('RGBA',(COLS*FIN,rows*FIN),(0,0,0,0))
    for k,im in enumerate(out): sheet.paste(im,((k%COLS)*FIN,(k//COLS)*FIN))
    sheet.save(f'emo{v}.webp',quality=82,method=6,exact=True)
    import os
    return dict(bgres=round(float(res),2),v=v,frames=N,ms=round(L/60*1000/N,2),loopms=round(L/60*1000),size=os.path.getsize(f'emo{v}.webp'),lag=L,i0=i0)
if __name__=='__main__':
    print(json.dumps(build(int(sys.argv[1]))))
