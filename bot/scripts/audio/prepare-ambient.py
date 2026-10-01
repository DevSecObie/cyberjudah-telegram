"""Prepare four source-pinned CC0 loops; writes only a local ignored cache."""
import subprocess,hashlib
from pathlib import Path
import argparse, urllib.request
p=argparse.ArgumentParser();p.add_argument('--cache', default='.cache/ambient');args=p.parse_args()
root=Path(args.cache);out=root/'encoded';out.mkdir(parents=True,exist_ok=True)
sources={'quiet-piano':'859/859607_15820073','soft-keys':'788/788677_16161631','stillness':'524/524947_9497060','evening-pad':'575/575035_11532701'}
checksums={
 'quiet-piano':'34a1167e62481497f0bbc2fc53147399a38dfd19744a78d2cb0f97fa52ec72b1',
 'soft-keys':'121354297afb04043c906429e2b3cb4005b31e20dd602db4fe439272c4ca9c1c',
 'stillness':'839dc7b1d278c4a38b44096e185637ed580c04ce768884fc543b2aaa811b25f9',
 'evening-pad':'9d10edf9ad84f5a302c754c37ad94fbcb180ca39788fc9cf3faf4ba0e8064c83',
}
for name, key in sources.items():
 target=root/(name+'.mp3')
 if not target.exists():
  with urllib.request.urlopen('https://cdn.freesound.org/previews/'+key+'-lq.mp3',timeout=60) as r:target.write_bytes(r.read())
 if hashlib.sha256(target.read_bytes()).hexdigest()!=checksums[name]:
  raise ValueError(f'{name}: source changed; verify its licence and content before updating the pinned checksum')
# Decode, repeat and crossfade in PCM; cut on one cycle. The Web Audio player loops
# the decoded buffer, avoiding AAC's container/startup gap on every repeat.
for name in ['quiet-piano','soft-keys','stillness','evening-pad']:
 src=root/(name+'.mp3')
 duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(src)]))
 cycle=duration-2
 # Build a 2–4 minute period from crossfaded repetitions, then crossfade final tail to head.
 repeats=max(2,int(150/cycle)+1);length=min(240.,cycle*repeats)
 import numpy as np
 # Crossfade each original loop boundary, then keep an integer number of joined cycles.
 wav=np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-i',str(src),'-ac','2','-ar','44100','-f','f32le','pipe:1']),dtype=np.float32).reshape(-1,2)
 n=88200;fade=np.linspace(0,1,n,dtype=np.float32)[:,None];joined=wav.copy()
 for _ in range(repeats):joined=np.concatenate([joined[:-n],joined[-n:]*(1-fade)+wav[:n]*fade,wav[n:]])
 target=min(len(joined)-n,int(length*44100));track=joined[:target+n];track[:n]=track[-n:]*(1-fade)+track[:n]*fade;track=track[:-n]
 peak=float(np.abs(track).max());track*=.65/max(peak,.001)
 dst=out/(name+'.m4a')
 subprocess.run(['ffmpeg','-v','error','-y','-f','f32le','-ar','44100','-ac','2','-i','pipe:0','-c:a','aac','-b:a','96k','-movflags','+faststart',str(dst)],input=track.astype(np.float32).tobytes(),check=True)
 print(name,len(track)/44100,dst.stat().st_size,hashlib.sha256(dst.read_bytes()).hexdigest(),flush=True)
