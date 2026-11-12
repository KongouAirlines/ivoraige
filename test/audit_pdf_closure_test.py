import importlib.util
import io
import pathlib
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock
from types import SimpleNamespace
import stat

spec = importlib.util.spec_from_file_location('audit', pathlib.Path(__file__).parents[1] / 'scripts/audit-pdf-closure.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class ClosureTest(unittest.TestCase):
    def test_missing_runtime_fails(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                audit.installed(pathlib.Path(root).resolve())

    def test_installed_record_is_declaration(self):
        with tempfile.TemporaryDirectory() as root:
            root = pathlib.Path(root).resolve()
            info = root / 'demo-1.dist-info'
            info.mkdir()
            (info / 'METADATA').write_text('Name: demo\nVersion: 1\nLicense-Expression: MIT\n')
            (root / 'lib.so').write_bytes(b'fixture')
            (info / 'LICENSE').write_text('fixture license')
            (info / 'RECORD').write_text('lib.so,,\ndemo-1.dist-info/LICENSE,,\nmissing.py,,\n../../../outside,,\n')
            p = audit.installed(root)[0]
            self.assertEqual(p['redistribution'], 'not-cleared')
            self.assertEqual(p['files'][0]['kind'], 'native')
            self.assertEqual(p['missingRecordFiles'], ['missing.py'])
            self.assertEqual(p['outsideOrLinkedRecordFiles'], ['../../../outside'])

    def test_tar_boundary_and_traversal(self):
        with tempfile.TemporaryDirectory() as root:
            path = pathlib.Path(root).resolve() / 'fixture.tar'
            for name in ['package/plugins/mineru/runner.py', '../escape']:
                with tarfile.open(path, 'w') as t:
                    m = tarfile.TarInfo(name)
                    m.size = 1
                    t.addfile(m, io.BytesIO(b'x'))
                if name.startswith('..'):
                    with self.assertRaises(ValueError):
                        audit.archive(path)
                else:
                    self.assertEqual(audit.archive(path)['coreBoundary'], 'requires-pdf-boundary-review')

    def test_no_inputs_rejected_without_output(self):
        with tempfile.TemporaryDirectory() as root:
            output = pathlib.Path(root).resolve() / 'out.json'
            result = subprocess.run([sys.executable, str(spec.origin), '--output', str(output)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(output.exists())

    def test_metadata_links_rejected_before_read(self):
        for target in ['distribution', 'METADATA', 'RECORD']:
            with self.subTest(target=target), tempfile.TemporaryDirectory() as temp:
                root = pathlib.Path(temp).resolve() / 'runtime'
                root.mkdir()
                info = root / 'demo-1.dist-info'
                info.mkdir()
                outside = pathlib.Path(temp).resolve() / 'fixture-outside'
                outside.mkdir()
                (info / 'METADATA').write_text('Name: demo\nVersion: 1\n')
                (info / 'RECORD').write_text('')
                try:
                    if target == 'distribution':
                        (info / 'METADATA').unlink()
                        (info / 'RECORD').unlink()
                        info.rmdir()
                        info.symlink_to(outside, target_is_directory=True)
                    else:
                        (info / target).unlink()
                        (info / target).symlink_to(outside / 'missing-fixture')
                except OSError as exc:
                    self.skipTest('Symlinks unavailable: ' + str(exc))
                with self.assertRaisesRegex(ValueError, 'Linked distribution metadata'):
                    audit.installed(pathlib.Path(root).resolve())

    def test_parent_links_and_asset_links(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp).resolve() / 'runtime'
            root.mkdir()
            outside = pathlib.Path(temp).resolve() / 'fixture-outside'
            outside.mkdir()
            (outside / 'fixture').write_text('fixture')
            try:
                (root / 'linked').symlink_to(outside, target_is_directory=True)
            except OSError as exc:
                self.skipTest('Symlinks unavailable: ' + str(exc))
            self.assertTrue(audit.linked_or_outside(root, 'linked/fixture'))
            with self.assertRaisesRegex(ValueError, 'Linked input path'):
                audit.assets(root / 'linked')
            rows = audit.assets(root)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['kind'], 'uninspected-link')
            self.assertIsNone(rows[0]['bytes'])

    def test_tar_alias_duplicates_and_links(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp).resolve() / 'fixture.tar'
            with tarfile.open(path, 'w') as t:
                for name in ['package/a', 'package/./a']:
                    t.addfile(tarfile.TarInfo(name))
            with self.assertRaisesRegex(ValueError, 'duplicate'):
                audit.archive(path)
            for linktype in [tarfile.SYMTYPE, tarfile.LNKTYPE]:
                with tarfile.open(path, 'w') as t:
                    member = tarfile.TarInfo('package/link')
                    member.type = linktype
                    member.linkname = '../../fixture-outside'
                    t.addfile(member)
                with self.assertRaisesRegex(ValueError, 'link requires separate review'):
                    audit.archive(path)

    def test_candidates_are_not_license_classification(self):
        self.assertEqual(audit.kind('site-packages/path.pth'), 'ambiguous-pth-data-or-python-path')
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp).resolve() / 'fixture.tar'
            names = ['package/src/adapters/pdf-text.mjs', 'package/src/sidecar.mjs', 'package/sidecar/main.py']
            with tarfile.open(path, 'w') as t:
                for name in names:
                    t.addfile(tarfile.TarInfo(name))
            result = audit.archive(path)
            self.assertEqual(result['pdfBoundaryCandidates'], names)
            self.assertEqual(result['redistribution'], 'not-cleared')

    def test_label_path_validation_before_audit(self):
        with tempfile.TemporaryDirectory() as temp:
            output = pathlib.Path(temp).resolve() / 'out.json'
            for value in ['demo=', '=fixture', 'demo', 'demo=   ', ' =fixture']:
                with self.subTest(value=value):
                    result = subprocess.run([sys.executable, str(spec.origin), '--assets', value,
                                             '--output', str(output)], capture_output=True, text=True)
                    self.assertEqual(result.returncode, 2)
                    self.assertIn('nonempty LABEL=PATH', result.stderr)
                    self.assertNotIn('Traceback', result.stderr)
                    self.assertFalse(output.exists())

    def test_portable_record_and_tar_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp).resolve()
            archive = root / 'fixture.tar'
            for value in [r'\rooted', '/rooted', 'C:/file', 'C:file',
                          r'\\host\share\file', r'..\outside', r'\?\C:\file']:
                with self.subTest(path=value):
                    self.assertTrue(audit.linked_or_outside(root, value))
                    with tarfile.open(archive, 'w') as t:
                        t.addfile(tarfile.TarInfo(value))
                    with self.assertRaisesRegex(ValueError, 'Unsafe'):
                        audit.archive(archive)
            self.assertFalse(audit.linked_or_outside(root, 'package/data.bin'))

    def test_windows_reparse_attribute_guard(self):
        # Portable contract fixture, not a claim of execution on Windows.
        path = mock.Mock()
        path.lstat.return_value = SimpleNamespace(st_mode=stat.S_IFDIR,
            st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT)
        self.assertTrue(audit.is_link_or_reparse(path))
        path.lstat.assert_called_once_with()
        path.lstat.return_value = SimpleNamespace(st_mode=stat.S_IFDIR, st_file_attributes=0)
        self.assertFalse(audit.is_link_or_reparse(path))

    def test_reparse_walk_prunes_before_descending(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp).resolve()
            junction = root / 'junction-fixture'
            junction.mkdir()
            (junction / 'must-not-list').write_text('fixture')
            real_guard = audit.is_link_or_reparse
            with mock.patch.object(audit, 'is_link_or_reparse',
                    side_effect=lambda p: p == junction or real_guard(p)):
                rows = audit.assets(root)
                self.assertEqual([r['path'] for r in rows], ['junction-fixture'])
                self.assertEqual(rows[0]['kind'], 'uninspected-link')
                with self.assertRaisesRegex(ValueError, 'Linked input path'):
                    audit.safe_root(junction / 'must-not-list')

    def test_cache_directory_links_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp).resolve() / 'assets'
            root.mkdir()
            outside = root.parent / 'fixture-outside'
            outside.mkdir()
            try:
                for name in ['.cache', '.locks']:
                    (root / name).symlink_to(outside, target_is_directory=True)
            except OSError as exc:
                self.skipTest('Symlinks unavailable: ' + str(exc))
            rows = audit.assets(root)
            self.assertEqual([r['path'] for r in rows], ['.cache', '.locks'])
            self.assertTrue(all(r['kind'] == 'uninspected-link' for r in rows))
            for name in ['.cache', '.locks']:
                (root / name).unlink()
                (root / name).mkdir()
                (root / name / 'excluded').write_text('fixture')
            self.assertEqual(audit.assets(root), [])

    def test_drive_like_components_rejected(self):
        for value in ['./C:/file', 'pkg/C:file', 'pkg/C:..', 'C:..']:
            with self.subTest(path=value):
                self.assertFalse(audit.portable_relative(value))
        self.assertTrue(audit.portable_relative('pkg/normal.txt'))

    def test_record_non_directory_parent_is_missing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp).resolve()
            info = root / 'demo-1.dist-info'
            info.mkdir()
            (info / 'METADATA').write_text('Name: demo\nVersion: 1\n')
            (info / 'RECORD').write_text('foo/bar,,\n')
            (root / 'foo').write_text('ordinary file')
            row = audit.installed(root)[0]
            self.assertEqual(row['missingRecordFiles'], ['foo/bar'])
            self.assertEqual(row['outsideOrLinkedRecordFiles'], [])

    def test_link_probe_does_not_hide_permission_errors(self):
        path = mock.Mock()
        path.lstat.side_effect = PermissionError('fixture denied')
        with self.assertRaises(PermissionError):
            audit.is_link_or_reparse(path)


if __name__ == '__main__':
    unittest.main()
