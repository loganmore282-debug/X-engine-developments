import numpy as np, cv2
from scipy import ndimage as ndi
def fgmask(bgr, T=1.2, minarea=12):
    lab=cv2.cvtColor(bgr.astype(np.float32)/255,cv2.COLOR_BGR2Lab)
    g=cv2.GaussianBlur(lab,(0,0),1.0)
    gx=cv2.Sobel(g,cv2.CV_32F,1,0,ksize=3)/8; gy=cv2.Sobel(g,cv2.CV_32F,0,1,ksize=3)/8
    e=np.sqrt((gx**2+gy**2).sum(2))
    free=e<T
    lbl,n=ndi.label(free)
    border=np.unique(np.concatenate([lbl[0],lbl[-1],lbl[:,0],lbl[:,-1]]))
    bg=np.isin(lbl,[b for b in border if b>0])
    fg=~bg
    l2,n2=ndi.label(fg)
    if n2:
        sz=ndi.sum(fg,l2,range(1,n2+1)); keep=[i+1 for i,s in enumerate(sz) if s>=minarea]
        fg=np.isin(l2,keep)
    raw=free&~bg
    fg=ndi.binary_fill_holes(fg)
    return fg,e,raw
if __name__=='__main__':
    import glob,sys
    rows=[]
    for v in range(1,8):
        fs=sorted(glob.glob(f'v{v}/f*.png'))
        im=cv2.imread(fs[len(fs)//3])
        fg,e,_=fgmask(im)
        prev=np.where(fg[...,None],im,(255,255,255)).astype(np.uint8)
        rows.append(cv2.resize(prev,(380,280)))
        print(v,im.shape,round(float(np.percentile(e,50)),2),round(float(np.percentile(e,90)),2))
    cv2.imwrite('masks.png',np.vstack([np.hstack(rows[:4]),np.hstack(rows[4:]+[np.full((280,380,3),255,np.uint8)])]))
