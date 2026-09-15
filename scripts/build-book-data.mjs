#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';
const root=process.cwd();const bookId=process.argv[2]||'shanghai-g5a-2026';
const dir=path.join(root,'books',bookId);const book=JSON.parse(fs.readFileSync(path.join(dir,'book.json'),'utf8'));const lessons=JSON.parse(fs.readFileSync(path.resolve(root,book.lessons),'utf8'));
const stamp=(s)=>{const m=Math.floor(s/60),sec=s-m*60;return `[${String(m).padStart(2,'0')}:${sec.toFixed(3).padStart(6,'0')}]`;};
let built=0;
for(const lesson of lessons){if(!lesson.timing||!lesson.transcript)continue;const timing=JSON.parse(fs.readFileSync(path.resolve(root,lesson.timing),'utf8'));const lines=[`[al:${book.title}]`,`[ar:Original Publisher Audio]`,`[ti:${lesson.title}]`,`[by:alignment=${timing.alignmentSource||lesson.alignmentSource||'unknown'}]`,''];for(const s of timing.segments||[])lines.push(`${stamp(Number(s.start))}${s.en}${s.cn?'|'+s.cn:''}`);const out=path.resolve(root,lesson.transcript);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,lines.join('\n')+'\n');console.log('BUILD',lesson.id,'->',path.relative(root,out));built++;}
console.log(`Built ${built} transcript(s).`);
