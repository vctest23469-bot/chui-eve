import concurrent.futures, urllib.request, pathlib, hashlib, json, time
base='https://huggingface.co/mlx-community/Qwen3-ASR-1.7B-4bit/resolve/78a389c776a5483b2d0d4ea5494e11012e0d6159/model.safetensors?download=true'
root=pathlib.Path.home()/'Library/Application Support/Chui Eve/models/Qwen3-ASR-1.7B-4bit'
size=1603081617
parts=root/'.parts';parts.mkdir(exist_ok=True)
chunk=32*1024*1024
# Range requests are for this public model file only. Each part is size-checked;
# the complete artifact must match its upstream SHA-256 before activation.
def fetch(i):
    start=i*chunk;end=min(size,start+chunk)-1;target=parts/str(i)
    if target.exists() and target.stat().st_size==end-start+1:return
    for retry in range(4):
        try:
            done=target.stat().st_size if target.exists() else 0
            req=urllib.request.Request(base+f'&part={i}',headers={'Range':f'bytes={start+done}-{end}'})
            with urllib.request.urlopen(req,timeout=60) as response:
                if response.status!=206 or not response.headers.get('Content-Range','').startswith(f'bytes {start+done}-'):raise RuntimeError('Range not honored')
                with target.open('ab') as out:
                    while data:=response.read(1024*1024):out.write(data)
            if target.stat().st_size!=end-start+1:raise RuntimeError('Part size mismatch')
            print(f'part {i+1}/{(size+chunk-1)//chunk} complete',flush=True);return
        except Exception:
            if retry==3:raise
            time.sleep(2)
with concurrent.futures.ThreadPoolExecutor(max_workers=32) as pool:list(pool.map(fetch,range((size+chunk-1)//chunk)))
out=root/'model.safetensors.assembling';sha=hashlib.sha256()
with out.open('wb') as dst:
    for i in range((size+chunk-1)//chunk):
        with (parts/str(i)).open('rb') as src:
            while data:=src.read(1024*1024):dst.write(data);sha.update(data)
expected='9848eaf7a5c1589c671b35035ac27b72e248dd0c604eacae547e7e403d29db45'
assert sha.hexdigest()==expected,(sha.hexdigest(),expected)
out.replace(root/'model.safetensors')
print('SHA256 verified: '+sha.hexdigest(),flush=True)
