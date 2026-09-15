#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';
const root=process.cwd(),lessons=JSON.parse(fs.readFileSync('data/lessons.json','utf8')),words=JSON.parse(fs.readFileSync('data/words.json','utf8'));let errors=0,warnings=0;
const pass=m=>console.log('PASS',m),warn=m=>{warnings++;console.log('WARNING',m)},err=m=>{errors++;console.log('ERROR',m)};
const seenId=new Set(),seenName=new Set();
if(lessons.length!==96)err(`expected 96 lessons, got ${lessons.length}`);else pass('NCE2 lesson count = 96');
for(const l of lessons){
  if(seenId.has(l.id))err(`duplicate lesson id ${l.id}`);seenId.add(l.id);if(seenName.has(l.filename))err(`duplicate filename ${l.filename}`);seenName.add(l.filename);
  const mp3=path.join(root,'NCE2',`${l.filename}.mp3`),lrc=path.join(root,'NCE2',`${l.filename}.lrc`),note=path.join(root,'notes',`lesson-${String(l.id).padStart(2,'0')}.html`);
  if(!fs.existsSync(mp3))err(`Lesson ${l.id} MP3 missing: ${path.relative(root,mp3)}`);
  if(!fs.existsSync(lrc))err(`Lesson ${l.id} LRC missing: ${path.relative(root,lrc)}`);else{let prev=-1,count=0;for(const line of fs.readFileSync(lrc,'utf8').replace(/\r/g,'').split('\n')){const m=line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);if(!m)continue;const t=Number(m[1])*60+Number(m[2]);if(t<prev)err(`Lesson ${l.id} LRC timestamp decreases`);prev=t;if(!m[3].trim())err(`Lesson ${l.id} LRC empty text`);count++;}if(!count)err(`Lesson ${l.id} LRC has no timestamped lines`);}
  if(!fs.existsSync(note))warn(`Lesson ${l.id} notes missing: ${path.relative(root,note)}`);
  if(!words[String(l.id)])warn(`Lesson ${l.id} words entry missing`);
}
const summary=`NCE2 compatibility: ${errors} ERROR, ${warnings} WARNING`;console.log(`\n${summary}`);process.exitCode=errors?1:0;
