'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const html = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
const start = html.indexOf('/* Contain document edge drags');
const script = html.slice(start, html.indexOf('</script>', start));
const dom = new JSDOM('<body><div id="target"></div><div id="nested"></div></body>', {runScripts:'outside-only'});
const w = dom.window, root = w.document.documentElement;
Object.defineProperties(root, {clientHeight:{value:600}, scrollHeight:{value:1200}});
w.eval(script);
const target = w.document.getElementById('target');
function touch(type, x, y, element=target, count=1){
  const e = new w.Event(type, {bubbles:true, cancelable:true});
  Object.defineProperty(e, 'touches', {value:Array.from({length:count},()=>({clientX:x,clientY:y}))});
  element.dispatchEvent(e); return e.defaultPrevented;
}
function begin(x=100,y=100,el=target){touch('touchend',0,0,el,0);touch('touchstart',x,y,el);}
root.scrollTop=0; begin();
assert.equal(touch('touchmove',140,102),false,'horizontal swipe must remain available at top');
root.scrollTop=600; begin();
assert.equal(touch('touchmove',60,98),false,'horizontal swipe must remain available at bottom');
root.scrollTop=0; begin();
assert.equal(touch('touchmove',101,101),false,'small touch jitter must not cancel a gesture');
assert.equal(touch('touchmove',101,130),true,'outward vertical drag must be contained');
assert.equal(touch('touchmove',101,110),false,'reversing inward must scroll immediately');
root.scrollTop=600; begin();
assert.equal(touch('touchmove',100,70),true,'bottom outward drag must be contained');
assert.equal(touch('touchmove',100,90),false,'bottom inward reversal must scroll');
root.scrollTop=200; begin();
assert.equal(touch('touchmove',100,130),false,'normal page scrolling must remain available');
root.scrollTop=0; begin();
assert.equal(touch('touchmove',100,130,target,2),false,'pinch gestures must remain available');
const nested=w.document.getElementById('nested');nested.style.overflowY='auto';
Object.defineProperties(nested,{clientHeight:{value:100},scrollHeight:{value:300}});
begin(100,100,nested);assert.equal(touch('touchmove',100,130,nested),false,'nested scrollers own their gestures');
dom.window.close();
console.log('PASS: horizontal swipes, touch jitter, edge containment, reversal, normal scroll, pinch, nested scrollers');
