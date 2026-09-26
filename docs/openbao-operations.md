# Hosted OpenBao operations

Deployment: `media-server` (`51.195.104.20`), `https://bao.envstore.xyz`,
OpenBao **2.7.0**, dedicated Transit mount `transit`. Envstore production on
Vercel is its client. Application backends call **envstore**, using individually
scoped `esmk_` credentials; they do not receive the OpenBao service tokens.
See [managed-key API](managed-keys.md) for provisioning and application requests.

## Layout and exposure

- `/opt/envstore-openbao`: Compose, OpenBao config, policies and maintenance script.
- `/var/lib/envstore-openbao/data`: persistent Raft database.
- `/var/log/envstore-openbao/audit.jsonl`: HMAC-protected audit records, rotated daily
  or at 100 MB, 14 rotations retained. Docker also retains bounded audit output.
- `/etc/envstore-openbao`: TPM-encrypted service credentials, age-encrypted recovery
  artifacts, and the backup recipient's public key.
- `/run/envstore-openbao/seal.key`: auto-unseal key in tmpfs, injected by systemd.
- `/var/backups/envstore-openbao`: one week of age-encrypted local snapshots.
- `/var/lib/envstore-openbao/maintenance`: last successful renewal/backup metadata.

Docker binds only `127.0.0.1:18200`. nginx exposes HTTPS and only the Transit
paths needed by envstore; `/`, `/ui`, `/v1/sys/*`, `/v1/auth/*`, key configuration,
export, deletion and snapshots are not exposed. A **404 at the domain root is
expected**. nginx imposes a 32 KiB request limit and 20 requests/second per source
IP (burst 40). Envstore additionally authenticates and limits application callers.
This is not a global distributed quota across Vercel instances.

The Let's Encrypt certificate renews through the server's existing Certbot timer.
The deployment hook tests and reloads nginx. Configuration templates are in
[`scripts/managed-keys/production`](../scripts/managed-keys/production/).

## Service and credentials

```sh
ssh media-server 'sudo systemctl status envstore-openbao.service'
ssh media-server 'sudo docker ps --filter name=envstore-openbao'
ssh media-server 'sudo systemctl list-timers "envstore-openbao-*"'
ssh media-server 'sudo cat /var/lib/envstore-openbao/maintenance/last-renewal.json'
ssh media-server 'sudo cat /var/lib/envstore-openbao/maintenance/last-backup.json'
```

`envstore-openbao.service` injects the seal key and starts Compose. The image is
pinned by digest, runs without root/capabilities, has a read-only root filesystem,
a 1 GiB memory limit, no container swap, and a health check. A service restart
recreates the container and automatically unseals its existing data.

The static seal's 32-byte key and maintenance credentials are encrypted at rest
using `systemd-creds --with-key=host+tpm2 --tpm2-pcrs=7`. Both the host secret and
TPM policy are required to decrypt these files. The age recovery copies allow
recovery on a different host. Firmware/Secure Boot policy changes can invalidate
the TPM binding; recover and re-encrypt credentials before such maintenance.
A privileged attacker on the running host can still access live keys/tokens.

Three orphan service tokens have independent policies: runtime (generate/decrypt),
admin (create/read/rotate key metadata), backup (Raft snapshot read). They are
periodic with a **24-hour lifetime**. The hourly `envstore-openbao-renew.timer`
renews each token and checks health. Failed jobs appear in systemd/journald;
**no external alert destination is configured**. Inspect failed jobs and renewal
age. If renewal stops for 24 hours, these credentials expire: use recovery shares
to generate an administrative token, issue replacements, update the TPM-encrypted
operations credential and Vercel production secrets, redeploy, and revoke the
emergency administrative token. The bootstrap root token is revoked after setup.

Production-only Vercel configuration:

- `OPENBAO_URL=https://bao.envstore.xyz`
- `OPENBAO_TRANSIT_MOUNT=transit`
- `OPENBAO_RUNTIME_TOKEN`, `OPENBAO_ADMIN_TOKEN`: separate sensitive secrets.
- `OPENBAO_BACKUP_TOKEN`: separate sensitive upload-broker bearer.
- `MANAGED_KEYS_TRUST_PROXY=true`: Vercel terminates TLS and supplies forwarding headers.

No production credentials are configured for preview builds. Application
credentials have their own explicit expiration and revocation; service renewal
does not extend application credentials.

## Backups and recovery

`envstore-openbao-backup.timer` runs hourly. It takes a Raft snapshot, bundles
configuration and recovery artifacts, and encrypts the archive with **age** to
the operator's existing `~/.ssh/id_ed25519.pub`. The private SSH key is never
copied to the media server. Treat that private key and the recovery archive as
critical disaster-recovery assets; retain them separately from the server.

The archive is stored in the existing envstore R2 bucket under
`managed-key-backups/media-server/YYYY-MM-DD/<uuid>.tar.age`. The backup job gets
a five-minute signed upload through envstore's authenticated internal broker.
It cannot list/delete historical backups or choose arbitrary object paths, and
it never receives R2 account credentials. A signed one-hour ticket permits
verification/download of only that new object. The job downloads the stored
ciphertext and verifies SHA-256 before recording success. Broker requests are
bounded to 128 MiB snapshots; investigate failures before growth reaches that cap.
Offsite snapshots are retained until deliberate operator cleanup; never discard
key history needed by stored envelopes.

Run and inspect a backup:

```sh
ssh media-server 'sudo systemctl start envstore-openbao-backup.service'
ssh media-server 'sudo cat /var/lib/envstore-openbao/maintenance/last-backup.json'
```

The operator's local recovery copies live under
`~/.config/envstore/operations/` (directory mode 0700). `openbao-seal.key.age`
contains the 32-byte static seal key; `openbao-recovery.json.age` contains all five
recovery shares, with a threshold of three. They are packaged for single-operator
recovery, not distributed among independent custodians. The initial tested
snapshot is also copied there as `openbao-initial-snapshot.tar.age`.
The final setup snapshot is `openbao-latest-snapshot.tar.age`, with its R2 object
name and SHA-256 in `openbao-latest-backup.json`. These local copies are from
setup time; hourly backups continue on the server and in R2. Deployment/restore
evidence is in `openbao-deployment.json`. No plaintext credential copies remain.

Recovery requires **the age private key, encrypted snapshot, seal key, and the
matching envstore PostgreSQL metadata**. Recover PostgreSQL using its provider's
backup/PITR facilities; the Raft backup does not back up the envstore database.
A recovery archive includes scoped service credentials inside its age encryption;
rotate them after a real compromise or recovery onto a replacement host.

Restore procedure (first use an isolated host/container):

1. Download the desired `.tar.age` from R2 with operator access, or use a retained
   local encrypted copy. Verify its recorded SHA-256.
2. Decrypt with `age -d -i ~/.ssh/id_ed25519`, extract into a private tmpfs
   directory, and decrypt the nested `seal.key.age` with the same identity.
3. Start the pinned OpenBao image with a fresh Raft data directory and the same
   static seal key/ID. Keep its API on loopback and initialize this temporary
   instance. Keep its temporary root token in tmpfs.
4. Using that temporary root token, POST the raw `raft.snap` bytes to
   `/v1/sys/storage/raft/snapshot-force`. Restart the restored instance, wait for
   it to unseal, and verify an existing wrapped data key using the original
   context. The snapshot restores token/policy state too.
   If restored service tokens have expired, generate a temporary administrative
   token using three recovery shares and issue replacements before this check.
5. For an actual replacement, re-encrypt seal/operations credentials with the
   new host's TPM, install the production systemd/nginx configuration, restore
   matching envstore metadata, replace expired/compromised credentials, update
   Vercel secrets, and switch DNS only after verification.
6. Remove plaintext recovery material from tmpfs. Never put recovery shares,
   plaintext keys or root tokens in shell arguments, logs, git or `.env` files.

`scripts/managed-keys/production/restore-check.py` automates the isolated container
portion of the drill. It accepts a private `/run/envstore-bao-restore-*` directory
containing decrypted snapshot/configuration, the recovered seal key, scoped
credentials and a test proof (wrapped key, context and expected plaintext hash).
It always removes its own test container; the operator must remove the tmpfs
input directory afterward. The deployment drill successfully recovered a data
key originally generated by the production API, after wrapping-key rotation.

This deployment is **one node on the media server**, with no standby/failover.
A server outage stops key operations. The backup recovery point is hourly;
wrapping-key creation or rotation since the last successful snapshot can be
lost, making affected envelopes unreadable. Take an immediate backup after bulk
provisioning or rotation. Stronger availability and tighter recovery objectives
require replicated nodes on separate hosts and corresponding operational work.
