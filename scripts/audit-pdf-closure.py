#!/usr/bin/env python3
"""Offline inventory, not a legal verdict. Never import installed packages or extract tar."""
import argparse
import csv
import email
import json
import os
import re
import tarfile
from pathlib import Path, PurePosixPath

NOTICE = re.compile(r'(licen[cs]e|copying|copyright|notice)', re.I)
NATIVE = re.compile(r'(\.so(?:\.|$)|\.(dll|dylib|pyd|exe)$)', re.I)
ASSET = re.compile(r'\.(onnx|pt|safetensors|ttf|otf|ttc|woff2?)$', re.I)


def safe_root(path):
    root = Path(os.path.abspath(path))
    # Reject links before resolving or reading any descendant, including root ancestors.
    for part in reversed([root, *root.parents]):
        if part.is_symlink():
            raise ValueError('Linked input path: ' + str(part))
    return root


def linked_or_outside(root, rel):
    p = Path(rel)
    if p.is_absolute() or '..' in p.parts:
        return True
    current = root
    for part in p.parts:
        current = current / part
        if current.is_symlink():
            return True
    return False


def kind(path):
    if path.lower().endswith('.pth'):
        return 'ambiguous-pth-data-or-python-path'
    return 'native' if NATIVE.search(path) else 'model-or-font' if ASSET.search(path) else 'code-or-data'


def installed(root):
    root = safe_root(root)
    if not root.is_dir() or not list(root.glob('*.dist-info')):
        raise ValueError('No installed dist-info metadata: ' + str(root))
    result = []
    for info in sorted(root.glob('*.dist-info')):
        for rel in [info.name, info.name + '/METADATA', info.name + '/RECORD']:
            if linked_or_outside(root, rel):
                raise ValueError('Linked distribution metadata: ' + rel)
        meta = email.message_from_bytes((info / 'METADATA').read_bytes())
        files, notices, missing, external = [], [], [], []
        record = info / 'RECORD'
        for row in csv.reader(record.read_text(encoding='utf-8').splitlines()) if record.exists() else []:
            if not row:
                continue
            rel = row[0]
            path = root / rel
            if linked_or_outside(root, rel):
                external.append(rel)
                continue
            if not path.is_file():
                missing.append(rel)
                continue
            files.append({'path': rel, 'bytes': path.stat().st_size, 'kind': kind(rel)})
            if NOTICE.search(path.name):
                notices.append(rel)
        result.append({'name': meta.get('Name'), 'version': meta.get('Version'),
                       'licenseDeclaration': meta.get('License-Expression') or meta.get('License'),
                       'licenseEvidence': {'metadataPath': info.name + '/METADATA',
                           'licenseExpression': meta.get('License-Expression'),
                           'licenseHeader': meta.get('License'), 'normalized': False},
                       'licenseClassifiers': [x for x in meta.get_all('Classifier', []) if x.startswith('License')],
                       'upstreamLinks': meta.get_all('Project-URL', []) + meta.get_all('Home-page', []),
                       'requiresDist': meta.get_all('Requires-Dist', []),
                       'noticeFiles': notices, 'files': files, 'missingRecordFiles': missing,
                       'outsideOrLinkedRecordFiles': external, 'recordPresent': record.exists(),
                       'correspondingSource': 'not-verified', 'redistribution': 'not-cleared'})
    return result


def archive(path):
    rows, seen = [], set()
    with tarfile.open(safe_root(path), 'r:*') as tar:
        for m in tar:
            p = PurePosixPath(m.name)
            if p.is_absolute() or '..' in p.parts or str(p) in seen or '\\' in m.name:
                raise ValueError('Unsafe or duplicate archive member: ' + m.name)
            if m.issym() or m.islnk():
                raise ValueError('Archive link requires separate review: ' + m.name)
            seen.add(str(p))
            rows.append({'path': m.name, 'bytes': m.size, 'kind': kind(m.name),
                         'linked': m.issym() or m.islnk()})
    # These are structural candidates, not proof of their legal license scope.
    candidates = [r['path'] for r in rows if re.search(r'(^|/)(plugins/(mineru|babeldoc)|sidecars?/|src/(adapters/pdf[^/]*\.mjs|sidecar[^/]*\.mjs)|pymupdf|docvortex)', r['path'], re.I)]
    return {'files': rows, 'pdfBoundaryCandidates': candidates,
            'coreBoundary': 'requires-pdf-boundary-review' if candidates else 'needs-dependency-and-license-review',
            'redistribution': 'not-cleared'}


def assets(root):
    root = safe_root(root)
    if not root.is_dir():
        raise ValueError('Missing asset directory: ' + str(root))
    rows = []
    for directory, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in {'.cache', '.locks'})
        for name in sorted(dirs + files):
            p = Path(directory) / name
            rel = str(p.relative_to(root))
            if p.is_symlink():
                rows.append({'path': rel, 'linked': True, 'bytes': None,
                             'kind': 'uninspected-link', 'license': 'not-verified',
                             'redistribution': 'not-cleared'})
            elif p.is_file():
                rows.append({'path': rel, 'bytes': p.stat().st_size,
                             'kind': kind(p.name), 'license': 'not-verified',
                             'redistribution': 'not-cleared'})
    return sorted(rows, key=lambda row: row['path'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site-packages', action='append', default=[], metavar='LABEL=PATH')
    parser.add_argument('--assets', action='append', default=[], metavar='LABEL=PATH')
    parser.add_argument('--tar', action='append', default=[], metavar='LABEL=PATH')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    if not (args.site_packages or args.assets or args.tar):
        parser.error('At least one --site-packages, --assets or --tar input is required')
    out = {'schemaVersion': 1, 'limitations': ['Installed files are not final runtime archives.',
           'RECORD ownership is declarative, not upstream byte verification.',
           'Metadata license labels and upstream homepages do not establish corresponding source or redistribution clearance.']}
    for key, values, fn in [('installed', args.site_packages, installed), ('assets', args.assets, assets), ('archives', args.tar, archive)]:
        out[key] = {}
        for value in values:
            label, path = value.split('=', 1)
            if label in out[key]:
                raise ValueError('Duplicate label: ' + label)
            out[key][label] = fn(path)
    with open(args.output, 'x', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write('\n')


if __name__ == '__main__':
    main()
