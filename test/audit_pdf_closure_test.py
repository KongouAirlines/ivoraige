import importlib.util
import io
import pathlib
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('audit', pathlib.Path(__file__).parents[1] / 'scripts/audit-pdf-closure.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class ClosureTest(unittest.TestCase):
    def test_missing_runtime_fails(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                audit.installed(root)

    def test_installed_record_is_declaration(self):
        with tempfile.TemporaryDirectory() as root:
            root = pathlib.Path(root)
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
            path = pathlib.Path(root) / 'fixture.tar'
            for name in ['package/plugins/mineru/runner.py', '../escape']:
                with tarfile.open(path, 'w') as t:
                    m = tarfile.TarInfo(name)
                    m.size = 1
                    t.addfile(m, io.BytesIO(b'x'))
                if name.startswith('..'):
                    with self.assertRaises(ValueError):
                        audit.archive(path)
                else:
                    self.assertEqual(audit.archive(path)['coreBoundary'], 'blocked')


if __name__ == '__main__':
    unittest.main()
