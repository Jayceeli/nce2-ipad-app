#!/usr/bin/env python3
"""Validate book configs, lessons, LRC/timing data and local media.

Usage:
  python scripts/validate-book-data.py
  python scripts/validate-book-data.py --book shanghai-5a-2026
  python scripts/validate-book-data.py --online

External production media URLs are reported as REMOTE unless --online is used.
Exit code is non-zero when any ERROR is found.
"""
from __future__ import annotations
import argparse, json, os, re, shutil, subprocess, sys, urllib.request
from pathlib import Path
from urllib.parse import urlparse

LRC_RE = re.compile(r"^\[(\d+):(\d+(?:\.\d+)?)\](.*)$")
META_RE = re.compile(r"^\[(al|ar|ti|by):", re.I)

class Report:
    def __init__(self): self.errors=0; self.warnings=0
    def emit(self, level, code, detail=''):
        if level=='ERROR': self.errors+=1
        elif level=='WARNING': self.warnings+=1
        print(f"{level:<7} {code}" + (f"  {detail}" if detail else ''))
    def ok(self, code, detail=''): self.emit('PASS', code, detail)
    def warn(self, code, detail=''): self.emit('WARNING', code, detail)
    def err(self, code, detail=''): self.emit('ERROR', code, detail)

def load_json(path: Path):
    with path.open('r', encoding='utf-8') as f: return json.load(f)

def is_url(value): return isinstance(value,str) and value.startswith(('http://','https://'))
def norm_text(s): return re.sub(r"[\s\W_]+", '', str(s or '').lower(), flags=re.UNICODE)

def exact_path(root:Path, rel:str):
    p=root/rel
    if not p.exists(): return None
    cur=root
    for part in Path(rel).parts:
        try: names={x.name:x for x in cur.iterdir()}
        except Exception: return None
        if part not in names: return None
        cur=names[part]
    return cur

def ffprobe_duration(path:Path):
    if not shutil.which('ffprobe'): return None
    try:
        out=subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(path)],text=True,stderr=subprocess.DEVNULL,timeout=20)
        return float(out.strip())
    except Exception: return None

def lrc_items(path:Path):
    items=[]
    for no,line in enumerate(path.read_text('utf-8').replace('\r','').splitlines(),1):
        line=line.strip()
        if not line or META_RE.match(line): continue
        m=LRC_RE.match(line)
        if not m: continue
        t=int(m.group(1))*60+float(m.group(2)); body=m.group(3).strip()
        en,cn=(body.split('|',1)+[''])[:2] if '|' in body else (body,'')
        items.append({'line':no,'start':t,'en':en.strip(),'cn':cn.strip()})
    return items

def check_remote(url, report, code):
    try:
        req=urllib.request.Request(url,method='HEAD',headers={'User-Agent':'book-validator'})
        with urllib.request.urlopen(req,timeout=12) as r:
            if 200 <= r.status < 400: report.ok(code, f"remote HTTP {r.status}")
            else: report.err(code, f"remote HTTP {r.status}")
    except Exception as e: report.err(code, f"remote unavailable: {e}")

def fill(pattern, row):
    vals={'id':row.get('id'),'id2':str(row.get('id')).zfill(2),'id3':str(row.get('id')).zfill(3),'filename':row.get('filename','')}
    return re.sub(r'\{([^}]+)\}',lambda m:str(vals.get(m.group(1),'')),pattern or '')

def validate_book(root:Path, entry, report:Report, online=False):
    cfg_path=exact_path(root,entry['config'])
    if not cfg_path: report.err(entry['id'],f"book config not found/case mismatch: {entry['config']}"); return
    book=load_json(cfg_path); bid=book['id']; report.ok(bid,f"{book.get('title','')}")
    lesson_path=exact_path(root,book['lessonData'])
    if not lesson_path: report.err(bid,'lessonData missing'); return
    raw=load_json(lesson_path)
    lessons=[]
    if book.get('legacy'):
        lg=book['legacy']
        for row in raw:
            unit=next((u for u in book.get('units',[]) if u.get('lessonRange') and u['lessonRange'][0] <= int(row['id']) <= u['lessonRange'][1]),None)
            lessons.append({'id':f"{bid}-l{int(row['id']):03d}",'order':int(row['id']),'filename':row['filename'],'title':row['title'],
                'unitId':unit.get('id') if unit else None,'audio':fill(lg.get('audioPattern',''),row),'transcript':fill(lg.get('transcriptPattern',''),row),
                'notes':fill(lg.get('notesPattern',''),row),'wordsKey':fill(lg.get('wordsKey','{id}'),row),'wordsSource':book.get('words'),'pointReading':True})
    else: lessons=raw

    ids=set(); filenames=set(); orders=[]
    words_data=None
    words_path=book.get('words')
    if words_path:
        wp=exact_path(root,words_path)
        if wp: words_data=load_json(wp); report.ok(f"{bid}:words",words_path)
        else: report.err(f"{bid}:words",f"missing/case mismatch: {words_path}")

    for lesson in lessons:
        lid=lesson.get('id'); code=f"{bid}:{lid}"; orders.append(lesson.get('order',0))
        if not lid: report.err(code,'missing lesson id'); continue
        if lid in ids: report.err(code,'duplicate lesson id')
        ids.add(lid)
        fn=lesson.get('filename')
        if fn:
            if fn in filenames: report.err(code,f'duplicate filename: {fn}')
            filenames.add(fn)

        audio=lesson.get('audio')
        duration=None
        if audio:
            if is_url(audio):
                if online: check_remote(audio,report,code+':audio')
                else: report.emit('REMOTE',code+':audio',audio)
                duration=float(lesson.get('audioDuration') or 0) or None
            else:
                ap=exact_path(root,audio)
                if not ap: report.err(code+':audio',f'missing/case mismatch: {audio}')
                else:
                    duration=ffprobe_duration(ap); report.ok(code+':audio',f'{audio}'+(f' ({duration:.3f}s)' if duration else ''))

        transcript=lesson.get('transcript')
        litems=[]
        if transcript:
            tp=exact_path(root,transcript)
            if not tp: report.err(code+':lrc',f'missing/case mismatch: {transcript}')
            else:
                litems=lrc_items(tp)
                if not litems: report.err(code+':lrc','no timestamped lines')
                else:
                    last=-1
                    for i,it in enumerate(litems):
                        if not it['en']: report.err(code+':lrc',f"empty English line {it['line']}")
                        if it['start'] <= last: report.err(code+':lrc',f"timestamps not increasing at line {it['line']}")
                        last=it['start']
                        if not it['cn']:
                            if lesson.get('translationStatus')=='missing' or book.get('translationStatus')=='missing': report.warn(code+':translation',f"missing by source, line {it['line']}")
                            elif book.get('translationStatus')!='missing': report.warn(code+':translation',f"missing translation line {it['line']}")
                    report.ok(code+':lrc',f'{len(litems)} timestamped lines')
        elif lesson.get('pointReading') is not False:
            report.err(code+':lrc','pointReading lesson has no transcript')

        timings=lesson.get('timings')
        if timings:
            pp=exact_path(root,timings)
            if not pp: report.err(code+':timings',f'missing/case mismatch: {timings}')
            else:
                data=load_json(pp); segs=data.get('segments',[])
                if litems and len(segs)!=len(litems): report.err(code+':timings',f'count {len(segs)} != LRC {len(litems)}')
                prev=-1
                for i,s in enumerate(segs):
                    st=float(s.get('start',-1)); en=float(s.get('end',-1))
                    if st < 0 or en <= st: report.err(code+':timings',f'invalid segment {i+1}: {st}-{en}')
                    if st < prev: report.err(code+':timings',f'non-increasing segment {i+1}')
                    prev=st
                    if litems and i<len(litems) and norm_text(s.get('text'))!=norm_text(litems[i]['en']): report.err(code+':timings',f'text mismatch segment {i+1}')
                    if lesson.get('audioDuration') and en > float(lesson['audioDuration']) + .05: report.err(code+':timings',f'segment {i+1} ends after lesson audio: {en}')
                if segs: report.ok(code+':timings',f'{len(segs)} explicit start/end segments')

        if lesson.get('wordsKey') and words_data is not None:
            if isinstance(words_data,dict) and lesson['wordsKey'] not in words_data:
                report.err(code+':words',f"wordsKey not found: {lesson['wordsKey']}")

        notes=lesson.get('notes')
        if notes and not exact_path(root,notes): report.err(code+':notes',f'missing/case mismatch: {notes}')

    if orders != sorted(orders): report.err(bid+':order','lesson order is not increasing')
    else: report.ok(bid+':order',f'{len(lessons)} contents')

    unit_orders=[u.get('order') for u in book.get('units',[]) if u.get('order') is not None]
    if unit_orders != sorted(unit_orders) or len(unit_orders)!=len(set(unit_orders)): report.err(bid+':units','Unit order invalid/duplicate')
    else: report.ok(bid+':units',f'{len(unit_orders)} units')

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--root',default='.'); ap.add_argument('--book'); ap.add_argument('--online',action='store_true'); args=ap.parse_args()
    root=Path(args.root).resolve(); report=Report()
    catalog_path=root/'data/books.json'
    if not catalog_path.exists(): report.err('catalog','data/books.json not found'); return 1
    catalog=load_json(catalog_path)
    entries=catalog.get('books',[])
    if args.book: entries=[e for e in entries if e.get('id')==args.book]
    if not entries: report.err('catalog','no matching books'); return 1
    for entry in entries: validate_book(root,entry,report,args.online)
    print(f"\nSUMMARY errors={report.errors} warnings={report.warnings}")
    return 1 if report.errors else 0

if __name__=='__main__': sys.exit(main())
