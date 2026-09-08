import json, re
from pathlib import Path
root=Path.home()/'Library/Application Support/Eve Recorder/models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25/test_wavs'
reference={line.split(' ',1)[0]:line.split(' ',1)[1] for line in (root/'transcript.txt').read_text().splitlines() if ' ' in line}
def normalize(text):
    return ''.join(c.lower() for c in text if c.isalnum())
def cer(expected,actual):
    a,b=normalize(expected),normalize(actual)
    prev=list(range(len(b)+1))
    for i,x in enumerate(a,1):
        row=[i]
        for j,y in enumerate(b,1):row.append(min(row[-1]+1,prev[j]+1,prev[j-1]+(x!=y)))
        prev=row
    return round(100*prev[-1]/max(1,len(a)),2)
report=[]
for backend in ['sherpa','mlx']:
    file=Path(f'artifacts/bench-{backend}.json')
    if not file.exists():continue
    result=json.loads(file.read_text())
    for r in result['results']:
        report.append({'backend':backend,'sample':r['name'],'seconds':r['seconds'],'inferenceSeconds':round(r['inferenceMs']/1000,3),'RTF':round(r['inferenceMs']/1000/r['seconds'],3),'characterErrorPercent':cer(reference[r['name']],r['text']),'peakMLXMemoryMB':r.get('peakMemoryMB')or None})
Path('artifacts/model-comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
