#!/usr/bin/env python3
"""Generate/synchronize LRC files from explicit segment timing JSON.

This keeps the data pipeline reproducible: edit the structured segment JSON,
then regenerate compatible LRC rather than hand-copying timestamps.
"""
from __future__ import annotations
import argparse, json
from pathlib import Path

def fmt(t):
    t=float(t); m=int(t//60); s=t-m*60
    return f'[{m:02d}:{s:06.3f}]'

def build(timing_path:Path, out:Path, album:str, artist:str, title:str, by:str='book-data-builder'):
    data=json.loads(timing_path.read_text('utf-8'))
    segs=data.get('segments',[])
    if not segs: raise SystemExit(f'No segments in {timing_path}')
    lines=[f'[al:{album}]',f'[ar:{artist}]',f'[ti:{title}]',f'[by:{by}]']
    last=-1
    for i,s in enumerate(segs,1):
        start=float(s['start']); end=float(s['end']); text=str(s.get('text','')).strip()
        if not text: raise SystemExit(f'Empty text segment {i}')
        if start <= last: raise SystemExit(f'Non-increasing start at segment {i}')
        if end <= start: raise SystemExit(f'Invalid end at segment {i}')
        last=start
        cn=str(s.get('cn','')).strip()
        lines.append(f'{fmt(start)}{text}|{cn}')
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(f'WROTE {out} ({len(segs)} lines)')

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--timings',required=True)
    ap.add_argument('--out',required=True)
    ap.add_argument('--album',required=True)
    ap.add_argument('--artist',default='Publisher Original Audio')
    ap.add_argument('--title',required=True)
    ap.add_argument('--by',default='book-data-builder')
    args=ap.parse_args()
    build(Path(args.timings),Path(args.out),args.album,args.artist,args.title,args.by)

if __name__=='__main__': main()
