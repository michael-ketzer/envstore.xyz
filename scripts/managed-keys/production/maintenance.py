#!/usr/bin/python3
"""Root-only OpenBao renewal and encrypted offsite backups. No secret-bearing logs."""
import datetime
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request

ROOT = pathlib.Path('/opt/envstore-openbao')
STATE = pathlib.Path('/var/lib/envstore-openbao/maintenance')
BACKUPS = pathlib.Path('/var/backups/envstore-openbao')
BROKER = 'https://www.envstore.xyz/api/internal/managed-keys/backups'
MAX_BYTES = 128 * 1024 * 1024


def http(url, *, token=None, payload=None, method=None, headers=None, limit=MAX_BYTES):
    headers = dict(headers or {})
    if token:
        headers['X-Vault-Token'] = token
    if isinstance(payload, dict):
        payload = json.dumps(payload).encode()
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, data=payload, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=90) as response:
        body = response.read(limit + 1)
        if len(body) > limit:
            raise RuntimeError('Response exceeds size limit')
        return body


def bao(path, token, payload=None):
    raw = http('http://127.0.0.1:18200/v1/' + path, token=token, payload=payload)
    return json.loads(raw) if raw else {}


def record(name, value):
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = STATE / (name + '.tmp')
    temp.write_text(json.dumps(value) + '\n')
    temp.replace(STATE / name)


def main():
    os.umask(0o077)
    creds = json.loads((pathlib.Path(os.environ['CREDENTIALS_DIRECTORY']) / 'operations.json').read_text())
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if sys.argv[1] == 'renew':
        for role in ['runtime', 'admin', 'backup']:
            result = bao('auth/token/renew-self', creds[role], {})
            if not result['auth']['renewable'] or result['auth']['lease_duration'] < 3600:
                raise RuntimeError('Unexpected renewal duration')
        health = bao('sys/health', creds['backup'])
        if health['sealed'] or not health['initialized']:
            raise RuntimeError('OpenBao is not ready')
        record('last-renewal.json', {'at': now, 'roles': ['runtime', 'admin', 'backup'], 'healthy': True})
        print('OpenBao healthy; all three service credentials renewed.')
        return
    if sys.argv[1] != 'backup':
        raise RuntimeError('Expected renew or backup')
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='envstore-bao-backup-', dir='/run') as directory:
        work = pathlib.Path(directory)
        snapshot = http('http://127.0.0.1:18200/v1/sys/storage/raft/snapshot', token=creds['backup'])
        (work / 'raft.snap').write_bytes(snapshot)
        del snapshot
        (work / 'operations.json').write_text(json.dumps(creds))
        bundle = work / 'snapshot.tar'
        with tarfile.open(bundle, 'w') as archive:
            archive.add(work / 'raft.snap', arcname='raft.snap')
            archive.add(work / 'operations.json', arcname='operations.json')
            for name in ['seal.key.age', 'recovery.json.age', 'backup-recipient.pub']:
                archive.add(pathlib.Path('/etc/envstore-openbao') / name, arcname=name)
            for file in ROOT.iterdir():
                if file.is_file():
                    archive.add(file, arcname='configuration/' + file.name)
        encrypted = work / 'snapshot.tar.age'
        subprocess.run(['age', '-R', '/etc/envstore-openbao/backup-recipient.pub', '-o', str(encrypted), str(bundle)], check=True, capture_output=True)
        size = encrypted.stat().st_size
        if size > MAX_BYTES:
            raise RuntimeError('Encrypted backup exceeds broker limit')
        digest = hashlib.sha256(encrypted.read_bytes()).hexdigest()
        headers = {'Authorization': 'Bearer ' + creds['upload']}
        prepared = json.loads(http(BROKER, payload={'operation': 'prepare', 'sizeBytes': size, 'sha256Hex': digest}, headers=headers, limit=16384))
        upload = prepared['upload']
        http(upload['url'], method='PUT', payload=encrypted.read_bytes(), headers=upload['requiredHeaders'], limit=16384)
        verified = json.loads(http(BROKER, payload={'operation': 'verify', 'ticket': prepared['ticket']}, headers=headers, limit=16384))
        durable = http(verified['download']['url'])
        if len(durable) != size or hashlib.sha256(durable).hexdigest() != digest:
            raise RuntimeError('Offsite backup verification failed')
        filename = prepared['key'].rsplit('/', 1)[1]
        (BACKUPS / filename).write_bytes(durable)
        # Preserve historical offsite snapshots; retain one week of local copies.
        cutoff = datetime.datetime.now().timestamp() - 7 * 86400
        for old in BACKUPS.glob('*.tar.age'):
            if old.stat().st_mtime < cutoff:
                old.unlink()
        record('last-backup.json', {'at': now, 'key': prepared['key'], 'sha256': digest, 'sizeBytes': size, 'verified': True})
        print('Encrypted snapshot uploaded and downloaded; SHA-256 verified. Object: ' + prepared['key'])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Exception messages can contain presigned URLs or authorization data.
        code = f' HTTP {error.code}' if isinstance(error, urllib.error.HTTPError) else ''
        print(f'OpenBao maintenance failed: {type(error).__name__}{code}', file=sys.stderr)
        sys.exit(1)
