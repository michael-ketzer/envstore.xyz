# Use a dedicated Transit mount for envstore. Replace transit if configured otherwise.
path "transit/datakey/plaintext/envstore-*" {
  capabilities = ["update"]
}
path "transit/decrypt/envstore-*" {
  capabilities = ["update"]
}
