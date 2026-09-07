const fs=require('fs');
const src=fs.readFileSync(__dirname + '/server.js','utf8');
eval(src.slice(src.indexOf('function sanitizeBannerVideoUrl'), src.indexOf('// Two Chipz-only image slots')));
let bad=0;
const ck=(o,l)=>{if(!o)bad++;console.log((o?'PASS  ':'FAIL  ')+l);};
for(const [input,expect,label] of [
 ['banner.mp4','banner.mp4','a file uploaded beside the app'],
 ['media/clip.webm','media/clip.webm','a subfolder path'],
 ['https://cdn.example.com/a.mp4','https://cdn.example.com/a.mp4','an https link'],
 ['','' ,'blank clears the video'],
 ['  banner.mp4  ','banner.mp4','whitespace trimmed'],
]) {
  const r=sanitizeBannerVideoUrl(input);
  ck(r.error?false:(r.video===(expect||null)||(expect===''&&r.video===null)), label+' -> '+JSON.stringify(r));
}
console.log('\n— rejected —');
for(const [input,label] of [
 ['javascript:alert(1)','javascript: URL'],
 ['JaVaScRiPt:alert(1)','case-shifted javascript:'],
 ['data:text/html,<script>x</script>','data: html'],
 ['http://cdn.example.com/a.mp4','plain http (mixed content)'],
 ['../../etc/passwd','path traversal'],
 ['//evil.com/a.mp4','protocol-relative to another host'],
 ['x'.repeat(2500),'absurdly long'],
 ['a.mp4" onerror="alert(1)','quote-breaking attribute injection'],
 ['a.mp4><script>alert(1)</script>','tag-breaking injection'],
]) { const r=sanitizeBannerVideoUrl(input); ck(!!r.error, label+' -> '+(r.error?'rejected':'ACCEPTED '+JSON.stringify(r))); }
console.log(bad?`\n${bad} FAILED`:'\nvideo URL validation: all cases pass');
process.exit(bad?1:0);
