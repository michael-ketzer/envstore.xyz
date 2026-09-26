ui = false
api_addr = "https://bao.envstore.xyz"
cluster_addr = "https://127.0.0.1:8201"
disable_mlock = true
log_level = "info"

storage "raft" {
  path = "/openbao/data"
  node_id = "media-server-1"
}
listener "tcp" {
  address = "0.0.0.0:8200"
  tls_disable = true
}

# systemd decrypts a host+TPM-bound credential into /run (tmpfs).
# No unseal key is stored in the image, Compose environment, or data volume.
seal "static" {
  current_key_id = "media-server-20260926-1"
  current_key = "file:///openbao/secrets/seal.key"
}

audit "file" "local-file" {
  options {
    file_path = "/openbao/logs/audit.jsonl"
    log_raw = "false"
  }
}
audit "file" "container-output" {
  options {
    file_path = "stdout"
    log_raw = "false"
  }
}
