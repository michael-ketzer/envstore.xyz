# A single-segment wildcard prevents accidental access to /config or /backup.
# This policy covers all key names on the mount: use a dedicated Transit mount.
path "transit/keys/+" {
  capabilities = ["create", "update", "read"]
}
path "transit/keys/+/rotate" {
  capabilities = ["update"]
}
