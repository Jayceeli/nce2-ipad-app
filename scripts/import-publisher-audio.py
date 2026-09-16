#!/usr/bin/env python3
"""Import publisher MP3 tracks from a ZIP without modifying the originals.

Example:
  python scripts/import-publisher-audio.py /path/to/audio.zip \
    --out books/shanghai-5a/audio/source \
    --sprite books/shanghai-5a/audio/audio-sprite.ogg \
    --manifest books/shanghai-5a/audio/audio-sprite-manifest.json

The script keeps extracted MP3 files byte-for-byte as found in the ZIP.  The
optional Opus sprite is a derived web asset; it never replaces source MP3s.
"""
from __future__ import annotations
import argparse, json, re, shutil, subprocess, tempfile, zipfile
from pathlib import Path

TRACK_RE=re.compile(r'^(\d{2})[ _-]*(.+?)\.mp3$',re.I)

def safe_name(n,name):
    name=re.sub(r'[\\/:*?"<>|]','-',name).strip()
    return f'{n:02d}_{name}.mp3'

def duration(path:Path):
    out=subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(path)],text=True)
    return float(out.strip())

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('zipfile')
    ap.add_argument('--out',required=True)
    ap.add_argument('--sprite')
    ap.add_argument('--manifest')
    ap.add_argument('--bitrate',default='24k')
    args=ap.parse_args()
    if not shutil.which('ffprobe'): raise SystemExit('ffprobe is required')
    zpath=Path(args.zipfile); out=Path(args.out); out.mkdir(parents=True,exist_ok=True)
    selected={}
    with zipfile.ZipFile(zpath) as z:
        for info in z.infolist():
            if info.is_dir(): continue
            base=Path(info.filename).name
            m=TRACK_RE.match(base)
            if not m: continue
            n=int(m.group(1))
            if not 1 <= n <= 99: continue
            # Prefer the shortest archive path for duplicate/full-package entries.
            candidate=(info.filename.count('/'),len(info.filename),info)
            if n not in selected or candidate[:2] < selected[n][:2]: selected[n]=candidate
        if not selected: raise SystemExit('No numbered MP3 tracks found')
        for n,(_,__,info) in sorted(selected.items()):
            base=Path(info.filename).stem
            base=re.sub(r'^\d{2}[ _-]*','',base)
            target=out/safe_name(n,base)
            with z.open(info) as src, target.open('wb') as dst: shutil.copyfileobj(src,dst)
            print('EXTRACT',target)

    tracks=[]; cursor=0.0
    for p in sorted(out.glob('*.mp3')):
        m=re.match(r'^(\d{2})_',p.name)
        if not m: continue
        d=duration(p); tracks.append((int(m.group(1)),p,d,cursor)); cursor+=d
    print(f'Imported {len(tracks)} tracks, total {cursor:.3f}s')

    if args.sprite:
        if not shutil.which('ffmpeg'): raise SystemExit('ffmpeg is required for --sprite')
        sprite=Path(args.sprite); sprite.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile('w',encoding='utf-8',delete=False,suffix='.txt') as f:
            concat=Path(f.name)
            for _,p,_,__ in tracks: f.write("file '"+str(p.resolve()).replace("'","'\\''")+"'\n")
        try:
            subprocess.check_call(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(concat),'-vn','-ac','1','-ar','48000','-c:a','libopus','-application','audio','-b:a',args.bitrate,'-vbr','on',str(sprite)])
            print('SPRITE',sprite)
        finally: concat.unlink(missing_ok=True)

    if args.manifest:
        manifest={'codec':'source-mp3','totalDuration':round(cursor,3),'tracks':{}}
        for _,p,d,start in tracks:
            manifest['tracks'][p.name]={'start':round(start,3),'end':round(start+d,3),'duration':round(d,3)}
        if args.sprite: manifest['derivedSprite']=str(args.sprite); manifest['spriteCodec']='opus'; manifest['spriteBitrate']=args.bitrate
        mp=Path(args.manifest); mp.parent.mkdir(parents=True,exist_ok=True); mp.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8'); print('MANIFEST',mp)

if __name__=='__main__': main()
