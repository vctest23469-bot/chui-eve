import os, sys, json, time, contextlib, subprocess
sys.dont_write_bytecode = True
from asr_quality import repetitive
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
            gate = subprocess.run([os.environ.get('CHUI_NODE_PATH', 'node'),
                os.path.join(os.path.dirname(__file__), 'speech-gate.cjs'), job['path']],
                check=True, capture_output=True, text=True, timeout=10)
            voice = json.loads(gate.stdout)
            if not voice['speech']:
                send({'id': job['id'], 'text': '', 'suppressed': 'no_speech', 'speechSeconds': 0})
                continue
            if np.sqrt(np.mean(samples*samples)) < 0.002:
                send({'id': job['id'], 'text': '', 'silent': True})
                continue
            started=time.monotonic()
            with contextlib.redirect_stdout(sys.stderr):
                result=model.generate(samples, max_tokens=448, verbose=False, language=job.get("language") or None, hotwords=job.get("hotwords") or None)
                mx.clear_cache()
            text=result.text.strip()
            if repetitive(text):
                send({'id': job['id'], 'text': '', 'suppressed': 'repetition', 'rejectedText': text})
                continue
            if text == 'language': raise ValueError('模型返回无效结果')
            send({'id': job['id'], 'text': text, 'ms': round((time.monotonic()-started)*1000), 'peakMemoryMB': round(mx.get_peak_memory()/1048576)})
        except subprocess.SubprocessError:
            send({'error': '语音检测进程异常，请重试或重新安装应用'})
        except Exception:
            send({'error': '模型转写失败，请检查音频格式、模型完整性和可用内存'})
except Exception as e:
    send({'fatal':'无法加载本地 MLX 环境或模型，请完成模型安装后再选择此引擎'})
    sys.exit(1)
