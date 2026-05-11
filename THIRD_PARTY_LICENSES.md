# Third-party licenses

envstore itself is licensed under [AGPL v3](LICENSE). The software bundles or
depends on the following third-party components, whose own licenses are
reproduced below as required by their terms.

For the complete list of transitive dependencies and their licenses, run:

```sh
pnpm licenses list --prod
```

This file covers the components with redistribution-notice requirements that
ship as part of our compiled CLI binary or the web server.

---

## age-encryption (TypeScript port of age)

- Package: [`age-encryption`](https://www.npmjs.com/package/age-encryption)
- Upstream: <https://github.com/FiloSottile/typage>
- Reference implementation (Go): <https://github.com/FiloSottile/age>
- License: BSD 3-Clause

envstore uses `age-encryption` for all end-to-end encryption: encrypting `.env`
files to workspace-member public keys, decrypting on pull. The same BSD
3-Clause license applies to the reference Go implementation at
`github.com/FiloSottile/age`.

**envstore is not affiliated with, endorsed by, or sponsored by the age
project or its authors.** We use age as a dependency under the terms of its
license; references to age in our documentation and marketing are descriptive
of the underlying cryptography, not an endorsement claim.

License text (verbatim from the npm package):

```
Copyright 2023 The age Authors

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of the age project nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

The Go reference implementation at `github.com/FiloSottile/age` carries a
substantively identical BSD 3-Clause license; the only difference is the
copyright line:

```
Copyright 2019 The age Authors
Copyright 2019 Google LLC
Copyright 2022 Filippo Valsorda
```

---

## Other notable dependencies

Most other production dependencies are MIT, Apache-2.0, ISC, or BSD-licensed —
all permissive licenses that require attribution but no source-code
re-distribution. The complete attribution list is generated from the lockfile
via `pnpm licenses list --prod`, which prints package, version, and SPDX
identifier for every transitive dependency. Each package's own `LICENSE` file
ships inside its `node_modules` install.

The following components have a notable role in the service:

| Component | License | Role |
| --- | --- | --- |
| [Next.js](https://github.com/vercel/next.js) | MIT | Web framework |
| [React](https://github.com/facebook/react) | MIT | UI runtime |
| [Prisma](https://github.com/prisma/prisma) | Apache-2.0 | ORM / database access |
| [Auth.js](https://github.com/nextauthjs/next-auth) | ISC | Authentication |
| [AWS SDK v3](https://github.com/aws/aws-sdk-js-v3) | Apache-2.0 | Cloudflare R2 (S3-compatible) client |
| [Zod](https://github.com/colinhacks/zod) | MIT | Schema validation |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) | MIT | Styling |
| [Bun](https://github.com/oven-sh/bun) | MIT | CLI runtime / compiler |
| [lucide-react](https://github.com/lucide-icons/lucide) | ISC | Icon set |

---

## Reporting an attribution error

If you believe a component is missing from this file or that the attribution
above is incomplete, please open an issue at
<https://github.com/michael-ketzer/envstore.xyz/issues> or email
<legal@envstore.xyz>. We will correct it promptly.
