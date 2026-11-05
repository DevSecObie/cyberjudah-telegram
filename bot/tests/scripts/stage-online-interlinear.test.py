import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('stage', Path(__file__).parents[2] / 'scripts/stage-online-interlinear.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StagingTests(unittest.TestCase):
    def fixture(self, root):
        source, destination = root / 'source', root / 'destination'
        source.mkdir()
        resource = dict(versionId='BHG', textRevision='revision', textSha256='a' * 64,
                        datasetId='CYBERJUDAH', language='en')
        raw = json.dumps(dict(resource=resource)).encode()
        files = {}
        for name in ['text/coverage.json', 'en/coverage.json']:
            target = source / name
            target.parent.mkdir()
            target.write_bytes(raw)
            files[name] = hashlib.sha256(raw).hexdigest()
        manifest = dict(version=1, datasetId='CYBERJUDAH', textRevision='revision', textSha256='a' * 64, files=files)
        (source / 'manifest.json').write_text(json.dumps(manifest))
        return source, destination, manifest

    def test_stages_only_verified_manifest_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, dest, manifest = self.fixture(Path(tmp))
            (source / 'unlisted.txt').write_text('excluded')
            module.stage(source, dest)
            self.assertEqual(json.loads((dest / 'manifest.json').read_text()), manifest)
            self.assertFalse((dest / 'unlisted.txt').exists())
            with self.assertRaises(AssertionError):
                module.stage(source, dest)

    def test_bad_hash_or_path_never_exposes_destination(self):
        for mode in ['hash', 'path']:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                source, dest, manifest = self.fixture(Path(tmp))
                if mode == 'hash':
                    (source / 'en/coverage.json').write_text('{}')
                else:
                    manifest['files']['../outside.json'] = 'a' * 64
                    (source / 'manifest.json').write_text(json.dumps(manifest))
                with self.assertRaises(AssertionError):
                    module.stage(source, dest)
                self.assertFalse(dest.exists())


if __name__ == '__main__':
    unittest.main()
