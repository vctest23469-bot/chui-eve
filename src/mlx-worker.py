import os, sys, json, time, contextlib
# stdout is reserved for the line protocol; model diagnostics go to stderr.
def send(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)
try:
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        import soundfile as sf
        import mlx.core as mx
        from mlx_audio.stt.utils import load_model
        model = load_model(os.environ['CHUI_MODEL'])
    send({'ready': True})
    for line in sys.stdin:
        try:
            job=json.loads(line)
            samples, rate=sf.read(job['path'], dtype='float32')
            if np.sqrt(np.mean(samples*samples)) < 0.002:
                send({'id': job['id'], 'text': '', 'silent': True})
                continue
            started=time.monotonic()
            with contextlib.redirect_stdout(sys.stderr):
                result=model.generate(samples, max_tokens=448, verbose=False)
                mx.clear_cache()
            text=result.text.strip()
            if text == 'language': raise ValueError('模型返回无效结果')
            send({'id': job['id'], 'text': text, 'ms': round((time.monotonic()-started)*1000), 'peakMemoryMB': round(mx.get_peak_memory()/1048576)})
        except Exception as e: send({'error': str(e)})
except Exception as e:
    send({'fatal':str(e)})
    sys.exit(1)
