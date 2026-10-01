"""Prepare source-pinned CC0 loops; writes only a local ignored cache."""
import subprocess,hashlib
from pathlib import Path
import argparse, urllib.request
p=argparse.ArgumentParser();p.add_argument('--cache', default='.cache/ambient');args=p.parse_args()
root=Path(args.cache);out=root/'encoded';out.mkdir(parents=True,exist_ok=True)
sources={'quiet-piano':'859/859607_15820073','soft-keys':'788/788677_16161631','stillness':'524/524947_9497060','evening-pad':'575/575035_11532701'}
checksums={
 'quiet-piano':'853640ecc0f906d18b4b07cb66d36e47015f94d5435cd2a4e725c034c9d36d49',
 'soft-keys':'b174863df8a0f5ab01f55e854a58e0843dd85b87cefc6f005c29166fef230294',
 'stillness':'0355ea5ddbfc25ed518ab4f91de2f9433ac24d82c7ea35f7b44f4e96245c38fd',
 'evening-pad':'02ce8ece08e96187679adbf88763a4cc2473f09c92b44de5eeef9b35a5a90c92',
}
sources.update({'rain': '640/640655_2414299', 'wind': '528/528944_3302313', 'ocean': '578/578524_5487341', 'fire': '650/650574_9782868'})
checksums.update({'rain': 'f5e4d1958e192762dc35e535e79afd30755986e18e7edabade998d84d446e6b9', 'wind': '4667388a7e4d0e080904fb072130495da659ed397466e74d6c52950e34c9730e', 'ocean': 'fd505dbd43cb1c3508f884279bf5d3e060bb14f2bc3d9b4cce334eb7a75b5d7f', 'fire': '2c952878199efd54fbb54e96f012967f790b71148e7d269162b7cd1c3c3850a3'})
for name, key in sources.items():
 target=root/(name+'-hq.mp3')
 if not target.exists():
  with urllib.request.urlopen('https://cdn.freesound.org/previews/'+key+'-hq.mp3',timeout=60) as r:target.write_bytes(r.read())
 if hashlib.sha256(target.read_bytes()).hexdigest()!=checksums[name]:
  raise ValueError(f'{name}: source changed; verify its licence and content before updating the pinned checksum')
# Decode, repeat and crossfade in PCM; cut on one cycle. The Web Audio player loops
# the decoded buffer, avoiding AAC's container/startup gap on every repeat.
for name in sources:
 src=root/(name+'-hq.mp3')
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
