#!/usr/bin/env python3
from __future__ import annotations
import json, os, signal, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PORT=18082
procs:list[subprocess.Popen]=[]

def run(cmd, cwd=None, env=None, timeout=120):
    print('+', ' '.join(map(str,cmd)), flush=True)
    return subprocess.run(cmd,cwd=cwd or ROOT,env=env,check=True,text=True,timeout=timeout)

def get(path):
    with urllib.request.urlopen(f'http://127.0.0.1:{PORT}{path}',timeout=5) as r: return r.read()

def post(path):
    req=urllib.request.Request(f'http://127.0.0.1:{PORT}{path}',method='POST')
    with urllib.request.urlopen(req,timeout=5) as r: return r.read()

def spawn(cmd, env, log):
    f=open(log,'wb')
    p=subprocess.Popen(cmd,cwd=ROOT,env=env,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
    p._skygrid_log=f
    procs.append(p)
    return p

def cleanup():
    for p in reversed(procs):
        if p.poll() is None:
            try: os.killpg(p.pid, signal.SIGTERM)
            except ProcessLookupError: pass
    deadline=time.time()+2
    for p in reversed(procs):
        if p.poll() is None:
            try: p.wait(max(0.01,deadline-time.time()))
            except subprocess.TimeoutExpired:
                try: os.killpg(p.pid,signal.SIGKILL)
                except ProcessLookupError: pass
        try: p._skygrid_log.close()
        except Exception: pass

try:
    # Static repository integrity checks. These catch packaging/config corruption
    # before starting language-specific builds.
    json.loads((ROOT/'web/tsconfig.json').read_text())
    json.loads((ROOT/'web/package.json').read_text())
    assert (ROOT/'web/tsconfig.json').stat().st_size > 100
    assert 'FROM gcc:14' in (ROOT/'simulator/Dockerfile').read_text()
    procedural = (ROOT/'web/src/procedural.tsx').read_text()
    for feature in ['loft(', 'ProceduralFighter', 'ProceduralMech', 'RibbonTrail', 'PlasmaShell', 'Shockwave']:
        assert feature in procedural, f'missing procedural visual feature: {feature}'
    print('static repository integrity passed')
    run(['cmake','-S','simulator','-B','simulator/build'])
    run(['cmake','--build','simulator/build','-j'])
    run(['ctest','--test-dir','simulator/build','--output-on-failure'])
    env=os.environ.copy();env['GOTOOLCHAIN']='local'
    run(['go','test','./...'],ROOT/'control',env)
    run(['go','vet','./...'],ROOT/'control',env)
    (ROOT/'bin').mkdir(exist_ok=True)
    run(['go','build','-o',str(ROOT/'bin/skygrid-control'),'./cmd/control'],ROOT/'control',env)
    run(['go','test','./...'],ROOT/'loadgen',env)
    run(['go','vet','./...'],ROOT/'loadgen',env)
    run(['go','build','-o',str(ROOT/'bin/skygrid-loadgen'),'.'],ROOT/'loadgen',env)
    run(['npm','install','--silent'],ROOT/'web')
    run(['npm','run','build'],ROOT/'web')

    with tempfile.TemporaryDirectory(prefix='skygrid-verify-') as td:
        td=Path(td);(td/'data').mkdir()
        e=os.environ.copy();e.update(HTTP_PORT=str(PORT),DATA_DIR=str(td/'data'),SHARD_TIMEOUT='3s')
        spawn([str(ROOT/'bin/skygrid-control')],e,td/'control.log')
        time.sleep(1)
        for shard in ('west','central','east'):
            e=os.environ.copy();e.update(SHARD_ID=shard,CONTROL_HOST='127.0.0.1',CONTROL_PORT='7000',SEED_COUNT='250')
            spawn([str(ROOT/'simulator/build/skygrid-sim')],e,td/f'{shard}.log')
        for _ in range(40):
            try: get('/healthz');break
            except Exception: time.sleep(.2)
        time.sleep(3)
        d=json.loads(get('/api/status'))
        assert len(d['aircraft'])==750
        assert len(d['shards'])==3 and all(s['healthy'] for s in d['shards'])
        print('initial status passed:',sorted((s['id'],s['aircraft']) for s in d['shards']))

        run([str(ROOT/'bin/skygrid-loadgen'),'-clients','20','-duration','2s','-url',f'ws://127.0.0.1:{PORT}/ws'],timeout=10)
        event_path=td/'data/events.jsonl'; handoff_id=None
        deadline=time.time()+20
        while time.time()<deadline and handoff_id is None:
            if event_path.exists():
                for line in event_path.read_text().splitlines():
                    e=json.loads(line)
                    if e['type']=='handoff_commit':handoff_id=e['aircraft']['id']
            if handoff_id is None:time.sleep(.2)
        assert handoff_id is not None
        events=json.loads(get(f'/api/aircraft/{handoff_id}/replay'))
        types={e['type'] for e in events}
        assert {'handoff_prepare','handoff_commit'} <= types
        print('replay passed:',len(events),sorted(types))

        post('/api/shards/central/terminate');time.sleep(3)
        d=json.loads(get('/api/status')); assert len(d['aircraft'])==750
        central=next(s for s in d['shards'] if s['id']=='central')
        assert not central['healthy'] and central['aircraft']==0
        metrics=get('/metrics').decode();line=next(x for x in metrics.splitlines() if x.startswith('skygrid_recoveries_total '))
        assert int(line.split()[1])>0
        print('failure recovery passed:',central,line)

        deadline=time.time()+8;snap=td/'data/events.jsonl.snapshot.json'
        while time.time()<deadline and not snap.exists():time.sleep(.2)
        assert snap.exists() and snap.stat().st_size>0
        sd=json.loads(snap.read_text());assert len(sd['aircraft'])==750
        print('snapshot persistence passed:',snap.stat().st_size,'bytes')
        print('SKYGRID VERIFICATION PASSED')
finally:
    cleanup()
