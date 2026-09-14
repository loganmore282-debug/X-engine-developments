const fs=require('fs');
const src=fs.readFileSync(__dirname + '/server.js','utf8');
// isYouTubeLink/YOUTUBE_VIDEO_ERROR sit just above sanitizeBannerVideoUrl and
// it calls them, so the slice has to start at them, not at the validator.
eval(src.slice(src.indexOf('function isYouTubeLink'), src.indexOf('// Two Chipz-only image slots')));
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

// Owner: "if url l am using YouTube url". A YouTube link in a <video> tag
// loads an HTML page, not a video, so the banner sits blank with no error
// anywhere -- it must be refused with an explanation, not stored.
console.log('\n— YouTube links are refused, with a reason —');
for(const url of [
 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
 'https://youtu.be/dQw4w9WgXcQ',
 'https://m.youtube.com/watch?v=abc',
 'https://music.youtube.com/watch?v=abc',
 'https://www.youtube-nocookie.com/embed/abc',
 'https://youtube.com/shorts/abc',
 'HTTPS://WWW.YOUTUBE.COM/WATCH?V=ABC',
]) {
  const r = sanitizeBannerVideoUrl(url);
  ck(!!r.error && /YouTube/.test(r.error), url+' -> '+(r.error?'rejected with a reason':'ACCEPTED '+JSON.stringify(r)));
}
// ...and the check must not swallow innocent links that merely contain the
// word, or a lookalike host registered by someone else.
console.log('\n— but lookalike hosts are not mistaken for YouTube —');
for(const url of [
 'https://cdn.example.com/youtube-promo.mp4',
 'https://myyoutube.com/a.mp4',
 'https://cdn.example.com/videos/youtu.be.mp4',
 'youtube.mp4',
]) {
  const r = sanitizeBannerVideoUrl(url);
  ck(!r.error, url+' -> '+(r.error?'WRONGLY REJECTED: '+r.error:'accepted'));
}
console.log(bad?`\n${bad} FAILED`:'\nvideo URL validation: all cases pass');
process.exit(bad?1:0);
