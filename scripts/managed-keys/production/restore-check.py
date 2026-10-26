#!/usr/bin/python3
"""Isolated restore drill. Accept a private /run directory containing decrypted
raft.snap, seal.key, operations.json, proof.json and configuration/openbao.hcl.
The proof contains only a wrapped test key, its binding context and plaintext hash.
Never point this utility at production storage. Removes its own test container.
"""
import base64
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

IMAGE = 'openbao/openbao:2.7.0@sha256:71156a1c6623a5fa3f5e61b0c6a8ead0faf0df29a778339188443551995d1315'
NAME = 'envstore-openbao-restore-check'
BASE = 'http://127.0.0.1:18201/v1/'


def api(path, payload=None, token=None):
    headers = {}
    if token:
        headers['X-Vault-Token'] = token
    if isinstance(payload, dict):
        headers['Content-Type'] = 'application/json'
        payload = json.dumps(payload).encode()
    request = urllib.request.Request(BASE + path, data=payload, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read()
        return json.loads(body) if body else {}


def wait_ready(initialized):
    for _ in range(60):
        try:
            state = api('sys/seal-status')
            if state['initialized'] == initialized and (not initialized or not state['sealed']):
                # Post-unseal setup completes after seal status is updated.
                if initialized:
                    api('sys/health')
                return
        except (urllib.error.URLError, ConnectionError):
            pass
        time.sleep(1)
    raise RuntimeError('Restore instance did not become ready')


def main():
    os.umask(0o077)
    work = pathlib.Path(sys.argv[1]).resolve()
    if work.parent != pathlib.Path('/run') or not work.name.startswith('envstore-bao-restore-'):
        raise RuntimeError('Restore input must be a dedicated /run/envstore-bao-restore-* directory')
    if subprocess.run(['docker', 'inspect', NAME], capture_output=True).returncode == 0:
        raise RuntimeError('Restore container already exists; refusing to touch it')
    for name in ['data', 'logs']:
        target = work / name
        target.mkdir(mode=0o700)
        os.chown(target, 100, 1000)
    os.chown(work / 'seal.key', 100, 1000)
    config = (work / 'configuration/openbao.hcl').read_text().replace('https://bao.envstore.xyz', 'http://127.0.0.1:18201')
    (work / 'openbao.hcl').write_text(config)
    os.chmod(work / 'openbao.hcl', 0o644)
    command = ['docker', 'run', '-d', '--name', NAME, '--user', '100:1000', '--read-only', '--cap-drop=ALL', '--security-opt', 'no-new-privileges:true', '--memory', '1g', '--memory-swap', '1g', '--cpus', '1', '--pids-limit', '128', '-p', '127.0.0.1:18201:8200', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m']
    for host, container in [('openbao.hcl', '/openbao/config/openbao.hcl:ro'), ('seal.key', '/openbao/secrets/seal.key:ro'), ('data', '/openbao/data'), ('logs', '/openbao/logs')]:
        command.extend(['-v', str(work / host) + ':' + container])
    command.extend([IMAGE, 'server', '-config=/openbao/config/openbao.hcl'])
    try:
        subprocess.run(command, check=True, capture_output=True)
        wait_ready(False)
        initialized = api('sys/init', {'recovery_shares': 1, 'recovery_threshold': 1})
        wait_ready(True)
        api('sys/storage/raft/snapshot-force', (work / 'raft.snap').read_bytes(), initialized['root_token'])
        subprocess.run(['docker', 'restart', NAME], check=True, capture_output=True)
        wait_ready(True)
        proof = json.loads((work / 'proof.json').read_text())
        credentials = json.loads((work / 'operations.json').read_text())
        result = api('transit/decrypt/envstore-' + proof['keyId'], {'context': proof['context'], 'ciphertext': proof['ciphertext']}, credentials['runtime'])
        actual = hashlib.sha256(base64.b64decode(result['data']['plaintext'])).hexdigest()
        if actual != proof['sha256']:
            raise RuntimeError('Restored key did not decrypt the original data key')
        print('Restore PASSED: encrypted offsite snapshot restored into isolated OpenBao; original wrapped key decrypted to the expected SHA-256.')
    finally:
        subprocess.run(['docker', 'rm', '-f', NAME], check=False, capture_output=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = f' HTTP {error.code}' if isinstance(error, urllib.error.HTTPError) else ''
        print(f'Restore drill failed: {type(error).__name__}{code}', file=sys.stderr)
        sys.exit(1)
