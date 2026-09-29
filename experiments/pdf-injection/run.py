"""BabelDOC source experiment: capture blocks, then replay accepted records.

No model endpoint. Unknown requests fail and invalidate the export.
"""
import argparse
from dataclasses import asdict
import json
import logging
import os
from pathlib import Path
import sys
import socket
import threading

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'evaluation/runs/m1-pdf-injection'
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / 'experiments/vendor/babeldoc'))
import babeldoc.const as const

# Keep writable DB/work files local; reuse existing assets without copying them.
ASSETS = Path.home() / '.cache/babeldoc'
const.CACHE_FOLDER = OUT / 'cache'
const.CACHE_FOLDER.mkdir(exist_ok=True)
def cache_path(filename, sub_folder=None):
    old = ASSETS / (sub_folder or '') / filename
    if old.is_file():
        return old
    new = const.CACHE_FOLDER / (sub_folder or '') / filename
    new.parent.mkdir(parents=True, exist_ok=True)
    return new
const.get_cache_file_path = cache_path
os.environ['TIKTOKEN_CACHE_DIR'] = str(ASSETS / 'tiktoken')

import pymupdf
from babeldoc.docvision.doclayout import OnnxModel
from babeldoc.format.pdf.high_level import translate
from babeldoc.format.pdf.translation_config import TranslationConfig, WatermarkOutputMode
from babeldoc.translator.translator import BaseTranslator
from babeldoc.format.pdf.document_il.midend.il_translator import ILTranslator

local = threading.local()
original = ILTranslator.translate_paragraph
def located(self, paragraph, page, *args, **kwargs):
    local.location = {'page': page.page_number, 'paragraph_id': paragraph.debug_id,
                      'box': asdict(paragraph.box), 'source_unicode': paragraph.unicode}
    return original(self, paragraph, page, *args, **kwargs)
ILTranslator.translate_paragraph = located

FIXED = {
 'Reuse of accepted scientific translations': '已接受科研译文的复用',
 'The applied field changes the magnetization direction.': '外加磁场改变磁化方向。',
 'We retain the accepted translation and export it without another model request.': '我们保留已接受的译文，在导出时直接复用该修订版本，并且无需再次请求正文翻译模型。',
 'A second page tests position-aware reuse.': '第二页用于检验带来源位置的译文复用。',
 'Long translations must remain readable inside the original paragraph area.': '当目标语言译文比原文更长时，排版系统仍须保证整个段落清晰可读，合理调整字号与换行，并避免文字越出原始段落区域或覆盖相邻内容。',
}

def fixture():
    path = OUT / 'original-control.pdf'
    if path.exists():
        return path
    doc = pymupdf.open()
    p = doc.new_page(width=595, height=842)
    p.insert_text((55, 70), 'Reuse of accepted scientific translations', fontsize=18)
    p.insert_textbox((55, 115, 535, 155), 'The applied field changes the magnetization direction.', fontsize=12)
    p.insert_textbox((55, 180, 535, 240), 'We retain the accepted translation and export it without another model request.', fontsize=12)
    p.insert_text((55, 280), 'E = - m H', fontsize=15, fontname='tiit')
    p.draw_rect((55, 340, 300, 480), color=(0, 0, 0))
    p.draw_line((70, 450), (280, 365), color=(0.2, 0.4, 0.8), width=2)
    p = doc.new_page(width=595, height=842)
    p.insert_text((55, 70), 'A second page tests position-aware reuse.', fontsize=17)
    p.insert_textbox((55, 120, 535, 180), 'The applied field changes the magnetization direction.', fontsize=12)
    p.insert_textbox((55, 205, 420, 275), 'Long translations must remain readable inside the original paragraph area.', fontsize=12)
    doc.save(path)
    return path

class Replay(BaseTranslator):
    name = 'ivoraige-replay'
    model = 'accepted-r1'
    def __init__(self, mode, records):
        super().__init__('en', 'zh', True)
        self.mode, self.records, self.calls, self.errors = mode, records, [], []
    def do_llm_translate(self, text, rate_limit_params=None):
        raise NotImplementedError('No LLM capability; no prompt interpretation')
    def get_formular_placeholder(self, placeholder_id):
        return f'<b{placeholder_id}>', f'<b{placeholder_id}>'
    def get_rich_text_left_placeholder(self, placeholder_id):
        return f'<b{placeholder_id}>', f'<b{placeholder_id}>'
    def get_rich_text_right_placeholder(self, placeholder_id):
        return f'</b{placeholder_id}>', f'</b{placeholder_id}>'
    def do_translate(self, text, rate_limit_params=None):
        loc = dict(local.location)
        key = 'p' + str(loc['page']) + ':' + ','.join(f"{v:.3f}" for v in loc['box'].values())
        if self.mode == 'capture':
            self.calls.append(dict(loc, key=key, request_text=text))
            return text
        record = self.records.get(key)
        if not record or record['request_text'] != text:
            self.errors.append({'key': key, 'request_text': text})
            raise ValueError(f'Unmapped block {key}; export invalid')
        self.calls.append(dict(loc, key=key, record_id=record['record_id'], revision=record['revision'], request_text=text))
        return record.get('replay_target', record['target'])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('mode', choices=['capture', 'replay', 'repeat'])
    mode = ap.parse_args().mode
    logging.basicConfig(level=logging.INFO)
    blocked_network = []
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex
    def deny_connect(sock, address):
        # Windows asyncio uses a loopback socket pair for its own event loop.
        if isinstance(address, tuple) and address[0] in ('127.0.0.1', '::1'):
            return original_connect(sock, address)
        blocked_network.append(str(address))
        raise RuntimeError('Network disabled in replay experiment')
    def deny_connect_ex(sock, address):
        if isinstance(address, tuple) and address[0] in ('127.0.0.1', '::1'):
            return original_connect_ex(sock, address)
        return deny_connect(sock, address)
    socket.socket.connect = deny_connect
    socket.socket.connect_ex = deny_connect_ex
    records = json.loads((OUT / 'accepted.json').read_text(encoding='utf-8')) if mode != 'capture' else []
    records.sort(key=lambda r: (r['page'], -r['box']['y2'], r['box']['x']))
    engine = Replay(mode, {r['key']: r for r in records})
    config = TranslationConfig(translator=engine, input_file=fixture(), lang_in='en', lang_out='zh',
       doc_layout_model=OnnxModel(str(ASSETS / 'models/doclayout_yolo_docstructbench_imgsz1024.onnx')),
       output_dir=OUT / mode, working_dir=OUT / (mode + '-work'), debug=False,
       no_dual=True, watermark_output_mode=WatermarkOutputMode.NoWatermark,
       auto_extract_glossary=False, auto_enable_ocr_workaround=False, skip_scanned_detection=True,
       disable_rich_text_translate=True, pool_max_workers=1, qps=100, min_text_length=5)
    result = translate(config)
    (OUT / f'{mode}-calls.json').write_text(json.dumps(engine.calls, ensure_ascii=False, indent=2), encoding='utf-8')
    if engine.errors:
        raise RuntimeError(engine.errors)
    if mode == 'capture':
        records = []
        for n, call in enumerate(engine.calls):
            source = ' '.join(call['request_text'].split())
            if source == 'retain the accepted translation and export it without another model request.':
                target = '保留已接受的译文，在导出时直接复用该修订版本，并且无需再次请求正文翻译模型。'
            elif source == 'E <b1>- m H':
                target = 'E = - m H'
            elif source not in FIXED:
                raise ValueError(f'Capture needs explicit translation: {source!r}')
            else:
                target = FIXED[source]
            if source == 'The applied field changes the magnetization direction.' and call['page'] == 1:
                target = '施加的磁场使磁化方向发生变化。'
            records.append(dict(call, record_id=f'control-{n+1:02}', revision=1,
                                target=target, replay_target=source if source == 'E <b1>- m H' else target,
                                status='accepted_fixture', target_language='zh'))
        if not records:
            raise RuntimeError('No blocks captured')
        records.sort(key=lambda r: (r['page'], -r['box']['y2'], r['box']['x']))
        (OUT / 'accepted.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
    else:
        (OUT / mode / 'translations.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
        (OUT / mode / 'translations.md').write_text('\n\n'.join(f"<!-- {r['record_id']} r{r['revision']} {r['key']} -->\n{r['target']}" for r in records), encoding='utf-8')
        pdf = Path(result.mono_pdf_path)
        doc = pymupdf.open(pdf)
        checks = []
        def normalize_pdf_text(value):
            # PDF extraction exposes glyph-separator control U+0003 in the formula.
            return ''.join(c for c in value if not c.isspace() and ord(c) >= 32)
        for r in records:
            found = normalize_pdf_text(r['target']) in normalize_pdf_text(doc[r['page']].get_text())
            checks.append({'record_id': r['record_id'], 'revision': r['revision'], 'page':r['page'], 'pdf_text_matches': found})
        for i, page in enumerate(doc):
            page.get_pixmap(matrix=pymupdf.Matrix(1.4, 1.4)).save(OUT / mode / f'page-{i+1}.png')
        evidence = {'babeldoc_version': const.__version__, 'pdf': str(pdf), 'adapter_requests':len(engine.calls),
                    'real_model_requests':0, 'llm_requests':0, 'cache_hits':engine.translate_cache_call_count,
                    'blocked_network_attempts':blocked_network,
                    'mapping_errors':engine.errors, 'records':checks, 'all_pdf_text_matches':all(x['pdf_text_matches'] for x in checks)}
        (OUT / f'{mode}-evidence.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
        if not evidence['all_pdf_text_matches']:
            raise RuntimeError('PDF text lost accepted record content')
    print(result)

if __name__ == '__main__':
    main()
