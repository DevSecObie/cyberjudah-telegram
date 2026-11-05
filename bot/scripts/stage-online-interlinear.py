#!/usr/bin/env python3
"""Stage a locally generated, verified interlinear publication; never deploy or fetch content."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile


def stage(source, destination):
    assert not destination.exists(), 'Destination already exists'
    manifest = json.loads((source / 'manifest.json').read_text())
    assert manifest['version'] == 1 and manifest['datasetId'] == 'CYBERJUDAH'
    assert re.fullmatch('[a-f0-9]{64}', manifest['textSha256']) and manifest['textRevision']
    assert {'text/coverage.json', 'en/coverage.json'} <= manifest['files'].keys()
    # Verify the entire publication before exposing any file in the destination.
    for name, digest in manifest['files'].items():
        assert re.fullmatch(r'(text|en)/(coverage|[1-9][0-9]*/[1-9][0-9]*)\.json', name), 'Unexpected asset path'
        raw = (source / name).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == digest, 'Asset hash mismatch: ' + name
        resource = json.loads(raw)['resource']
        assert resource['versionId'] == 'BHG'
        assert resource['textRevision'] == manifest['textRevision'] and resource['textSha256'] == manifest['textSha256']
        if name.startswith('en/'):
            assert resource['datasetId'] == 'CYBERJUDAH' and resource['language'] == 'en'
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.interlinear-', dir=destination.parent) as tmp:
        staging = Path(tmp) / 'publication'
        staging.mkdir()
        for name, digest in manifest['files'].items():
            target = staging / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / name, target)
            assert hashlib.sha256(target.read_bytes()).hexdigest() == digest, 'Source changed during staging'
        (staging / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')))
        staging.rename(destination)
    print(json.dumps({'staged': len(manifest['files']), 'textSha256': manifest['textSha256'], 'destination': str(destination)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    stage(args.source, args.destination)
