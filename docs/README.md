# envstore docs

The 60-second version is in the [project README](../README.md). This folder
is for going deeper.

## Start here

- **[concepts.md](concepts.md)** — the model: workspace, project, environment,
  recipient, version, identity, service token. Read this first if anything in
  the CLI feels confusing.
- **[security-model.md](security-model.md)** — what zero-knowledge means in
  practice, where the keys live, what an attacker actually sees, and the
  trust-on-first-use defense against server-side key injection.
- **[commands.md](commands.md)** — full reference for every CLI command, with
  synopsis, flags, examples, and gotchas. Use Ctrl-F or the anchor links.

## Quick links to commands

| If you want to…                       | Run                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| Sign in for the first time            | [`envstore login`](commands.md#envstore-login)                                               |
| Generate / back up your local key     | [`envstore identity`](commands.md#envstore-identity)                                         |
| Set up a project                      | [`envstore init`](commands.md#envstore-init) or [`envstore link`](commands.md#envstore-link) |
| Push your `.env`                      | [`envstore push`](commands.md#envstore-push)                                                 |
| Pull on a new machine / CI            | [`envstore pull`](commands.md#envstore-pull)                                                 |
| Read or change a single var           | [`envstore get`](commands.md#envstore-get) / [`envstore set`](commands.md#envstore-set)      |
| See an env's version history          | [`envstore versions`](commands.md#envstore-versions)                                         |
| Roll back to a previous version       | [`envstore rollback`](commands.md#envstore-rollback)                                         |
| Generate a `.env.example`             | [`envstore genexample`](commands.md#envstore-genexample)                                     |
| Check for accidentally tracked `.env` | [`envstore scan`](commands.md#envstore-scan)                                                 |
| Add a teammate / rotate recipients    | [`envstore rekey`](commands.md#envstore-rekey)                                               |
| Mint a CI token                       | [`envstore token`](commands.md#envstore-token)                                               |
| Audit who you encrypt to              | [`envstore trust list`](commands.md#envstore-trust)                                          |

## Self-hosting

See the [main README's "Self-hosting" section](../README.md#self-hosting).

## Reporting bugs / security issues

- Bugs: [GitHub issues](https://github.com/michael-ketzer/envstore.xyz/issues).
- Security: [SECURITY.md](../SECURITY.md).
