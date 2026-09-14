import asyncio, base64, io, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright
from PIL import Image
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
ADMIN = os.path.join(HERE, 'admin')
# The fixture is generated rather than checked in: it has to match the
# owner's stated spec exactly (300 x 220, 30 frames, ~80 ms each, ~2.4 s,
# transparent) and a binary in the repo would drift from that silently.
GIF_PATH = os.path.join(OUT, 'logo.gif')
def _make_gif(path):
    frames = []
    for i in range(30):
        im = Image.new('RGBA', (300, 220), (0, 0, 0, 0))
        d = __import__('PIL.ImageDraw', fromlist=['ImageDraw']).Draw(im)
        x = 20 + i * 8
        d.ellipse([x, 70, x + 80, 150], fill=(226, 27, 42, 255))
        frames.append(im.convert('P', palette=Image.ADAPTIVE, colors=255))
    frames[0].save(path, save_all=True, append_images=frames[1:],
                   duration=80, loop=0, disposal=2, transparency=255)
if not os.path.exists(GIF_PATH):
    _make_gif(GIF_PATH)
GIF = open(GIF_PATH, 'rb').read()
GIF_DATA_URL = 'data:image/gif;base64,' + base64.b64encode(GIF).decode()

fails=[]
def ck(ok,l):
    print(("PASS  " if ok else "FAIL  ")+l)
    if not ok: fails.append(l)

# --- 1. the admin uploader must not re-encode ---
async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        pg=await b.new_page()
        await pg.goto('about:blank')
        # the real fileToRawDataUrl(), lifted out of the built admin panel's source
        src=open(os.path.join(HERE, 'admin-src/index.html')).read()
        fn=src[src.index('function fileToRawDataUrl'):src.index('let _toastT=null;')]
        await pg.add_script_tag(content=fn)
        await pg.set_content('<input type="file" id="f">')
        await pg.add_script_tag(content=fn)
        await pg.set_input_files('#f', GIF_PATH)
        out = await pg.evaluate("async()=>{const f=document.getElementById('f').files[0];"
                                "try{return {ok:true, url: await fileToRawDataUrl(f, 400*1024)};}"
                                "catch(e){return {ok:false, err:e.message};}}")
        ck(out["ok"], "uploader accepted the GIF: "+str(out.get("err","")))
        if out["ok"]:
            ck(out["url"].startswith("data:image/gif;base64,"), "stays image/gif (not re-encoded to jpeg): "+out["url"][:30])
            raw = base64.b64decode(out["url"].split(",",1)[1])
            im = Image.open(io.BytesIO(raw))
            ck(getattr(im,'n_frames',1) == 30, "all 30 frames survive the upload (got %d)" % getattr(im,'n_frames',1))
            ck(im.size == (300,220), "size preserved %s" % (im.size,))
            ck(raw == GIF, "bytes are identical to the original file")
        # what the OLD helper would have done, for contrast
        fn2=src[src.index('function fileToDataUrl'):src.index('function fileToRawDataUrl')]
        await pg.add_script_tag(content=fn2)
        old = await pg.evaluate("async()=>{const f=document.getElementById('f').files[0];"
                                "return await fileToDataUrl(f,900,0.82);}")
        oldraw = base64.b64decode(old.split(",",1)[1])
        oim = Image.open(io.BytesIO(oldraw))
        print("  (old helper would have produced: %s, %d frame(s))" % (old[:22], getattr(oim,'n_frames',1)))
        ck(getattr(oim,'n_frames',1) == 1, "confirmed the old path really does flatten it to 1 frame")

        # --- 2. oversized file is refused with a clear message ---
        big = os.path.join(OUT,'big.gif'); open(big,'wb').write(GIF * 20)
        await pg.set_input_files('#f', big)
        r = await pg.evaluate("async()=>{const f=document.getElementById('f').files[0];"
                              "try{await fileToRawDataUrl(f, 400*1024); return {ok:true};}"
                              "catch(e){return {ok:false, err:e.message};}}")
        ck(not r["ok"] and 'KB' in r["err"], "oversized file refused: "+str(r.get("err")))
        await b.close()
    print(("\n%d FAILED" % len(fails)) if fails else "\ngif upload: all cases pass")
    sys.exit(1 if fails else 0)
asyncio.run(main())
