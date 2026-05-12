// Lightweight mock of the envstore API + R2 used by CLI integration tests.
//
// One running instance answers BOTH /api/v1/* calls AND the presigned R2
// PUT/GET we generate inline. The test owns the fixture state (workspaces,
// projects, environments, versions, ciphertext blobs) so it can stage exactly
// the situation the test asserts against and inspect what the CLI sent.
//
// Why a single in-process server: subprocess CLI exec + 1 HTTP listener is
// the smallest moving-parts surface that still exercises the real argv →
// command dispatch → fetch → file I/O pipeline.

export type RecordedRequest = {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
};

export type EnvVersionFixture = {
  versionId: string;
  version: number;
  environmentSlug: string;
  ciphertext: Uint8Array;
  ciphertextSha256: string;
  recipientsHash: string;
};

export type ProjectFixture = {
  slug: string;
  name: string;
  environments: Map<string, EnvVersionFixture[]>; // envSlug → versions[]
};

export type WorkspaceFixture = {
  slug: string;
  type: 'PERSONAL' | 'TEAM';
  projects: Map<string, ProjectFixture>; // projectSlug → project
  recipients: string[]; // age public keys the workspace encrypts to
  // Workspace-level version-history cap. Surfaced on the versions-list
  // response so CLI/dashboard tests can assert it round-trips correctly.
  versionHistoryLimit?: number;
};

// Pointer per (workspace, project, env) into the current version. Maps a
// fixture identity to the version a `pull` (or rollback target) should
// return. Tests that don't set anything explicitly fall back to the
// newest version in the array.
export type CurrentVersionPointer = {
  workspaceSlug: string;
  projectSlug: string;
  envSlug: string;
  versionId: string;
};

export type MockServerState = {
  workspaces: Map<string, WorkspaceFixture>; // workspaceSlug → workspace
  // Per-call overrides — let a single test stage a one-off response without
  // permanently mutating the fixture state.
  pushInitOverride?: (req: Request) => Promise<Response> | Response;
  // Explicit current-version pointers. If a key is present, the versions
  // and pull endpoints respect it; absent → newest-in-array semantics.
  currentVersions?: CurrentVersionPointer[];
};

export type MockServer = {
  url: string;
  state: MockServerState;
  requests: RecordedRequest[];
  stop: () => Promise<void>;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// Default current = newest version, BUT respect any explicit pointer the
// test pinned via state.currentVersions. Used by both /pull and the
// versions/rollback handlers so they share semantics.
function resolveCurrent(
  state: MockServerState,
  workspaceSlug: string,
  projectSlug: string,
  envSlug: string,
  versions: EnvVersionFixture[],
): EnvVersionFixture | undefined {
  const pinned = state.currentVersions?.find(
    (c) =>
      c.workspaceSlug === workspaceSlug &&
      c.projectSlug === projectSlug &&
      c.envSlug === envSlug,
  );
  if (pinned) {
    const found = versions.find((v) => v.versionId === pinned.versionId);
    if (found) return found;
  }
  return versions[versions.length - 1];
}

export async function startMockServer(state: MockServerState): Promise<MockServer> {
  const requests: RecordedRequest[] = [];
  // Cache R2-style blob storage in memory keyed by the synthetic presigned path.
  const r2Blobs = new Map<string, Uint8Array>();

  const server = Bun.serve({
    port: 0, // OS-assigned free port
    async fetch(req: Request) {
      const url = new URL(req.url);
      const method = req.method.toUpperCase();
      // Record everything so tests can assert what the CLI sent.
      let bodyJson: unknown = null;
      let rawBody: Uint8Array | null = null;
      if (method !== 'GET' && method !== 'HEAD') {
        const buf = await req.arrayBuffer();
        rawBody = new Uint8Array(buf);
        if (req.headers.get('content-type')?.includes('application/json')) {
          try {
            bodyJson = JSON.parse(new TextDecoder().decode(rawBody));
          } catch {
            bodyJson = null;
          }
        }
      }
      requests.push({
        method,
        path: url.pathname + (url.search || ''),
        body: bodyJson,
        headers: Object.fromEntries(req.headers.entries()),
      });

      // ----- Synthetic R2 endpoints -----
      // GET/HEAD resolve against r2Blobs first (anything the current test
      // PUT during its run) and then fall back to walking the fixture state
      // so tests can pre-seed historical ciphertext on EnvVersionFixture
      // without also pre-PUTting it to the blob map.
      if (url.pathname.startsWith('/r2/')) {
        const versionId = url.pathname.slice('/r2/'.length);
        const resolveBlob = (): Uint8Array | null => {
          const direct = r2Blobs.get(url.pathname);
          if (direct) return direct;
          for (const ws of state.workspaces.values()) {
            for (const proj of ws.projects.values()) {
              for (const versions of proj.environments.values()) {
                const v = versions.find((vv) => vv.versionId === versionId);
                if (v && v.ciphertext.byteLength > 0) return v.ciphertext;
              }
            }
          }
          return null;
        };
        if (method === 'PUT' && rawBody) {
          r2Blobs.set(url.pathname, rawBody);
          return new Response(null, { status: 200 });
        }
        if (method === 'GET') {
          const blob = resolveBlob();
          if (!blob) return new Response('not found', { status: 404 });
          return new Response(blob, { status: 200 });
        }
        if (method === 'HEAD') {
          const blob = resolveBlob();
          if (!blob) return new Response(null, { status: 404 });
          return new Response(null, {
            status: 200,
            headers: { 'content-length': String(blob.byteLength) },
          });
        }
      }

      // ----- API endpoints -----
      // We accept any Authorization header — auth checks live in the real
      // server; the integration tests just verify the CLI sends the right
      // requests to the right paths.

      // GET /api/v1/me — only relevant for `init`/`link`; return a minimal
      // payload describing one workspace.
      if (method === 'GET' && url.pathname === '/api/v1/me') {
        const ws = Array.from(state.workspaces.values());
        return json(200, {
          user: { id: 'u_test', email: 'test@example.com', name: 'Test User' },
          workspaces: ws.map((w) => ({
            slug: w.slug,
            name: w.slug,
            type: w.type,
            role: 'OWNER',
          })),
          recipients: ws[0]?.recipients.map((r, i) => ({
            id: `r_${i}`,
            recipient: r,
            kind: 'AGE_X25519',
            label: 'test',
          })) ?? [],
        });
      }

      // GET /api/v1/workspaces/<ws>/recipients[?project=<slug>]
      let m = /^\/api\/v1\/workspaces\/([^/]+)\/recipients$/.exec(url.pathname);
      if (method === 'GET' && m) {
        const ws = state.workspaces.get(m[1]!);
        if (!ws) return json(404, { error: 'Workspace not found.' });
        return json(200, {
          workspace: { slug: ws.slug, type: ws.type },
          recipients: ws.recipients.map((r, i) => ({
            id: `r_${i}`,
            recipient: r,
            kind: 'AGE_X25519',
            label: 'test',
            userEmail: 'test@example.com',
          })),
        });
      }

      // GET /api/v1/workspaces/<ws>/projects
      m = /^\/api\/v1\/workspaces\/([^/]+)\/projects$/.exec(url.pathname);
      if (method === 'GET' && m) {
        const ws = state.workspaces.get(m[1]!);
        if (!ws) return json(404, { error: 'Workspace not found.' });
        return Response.json(
          Array.from(ws.projects.values()).map((p) => ({
            slug: p.slug,
            name: p.name,
            description: null,
            group: null,
          })),
        );
      }

      // GET /api/v1/workspaces/<ws>/projects/<proj>/environments
      m = /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/environments$/.exec(
        url.pathname,
      );
      if (method === 'GET' && m) {
        const ws = state.workspaces.get(m[1]!);
        const proj = ws?.projects.get(m[2]!);
        if (!ws || !proj) return json(404, { error: 'Not found.' });
        return Response.json(
          Array.from(proj.environments.entries()).map(([envSlug, versions]) => {
            const current = versions[versions.length - 1];
            return {
              slug: envSlug,
              name: envSlug,
              currentVersion: current
                ? {
                    version: current.version,
                    createdAt: new Date().toISOString(),
                    ciphertextSize: current.ciphertext.byteLength,
                  }
                : null,
              versionsCount: versions.length,
            };
          }),
        );
      }

      // POST /api/v1/workspaces/<ws>/projects/<proj>/push — push init
      m = /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/push$/.exec(url.pathname);
      if (method === 'POST' && m) {
        if (state.pushInitOverride) return state.pushInitOverride(req);
        const ws = state.workspaces.get(m[1]!);
        const proj = ws?.projects.get(m[2]!);
        if (!ws || !proj) return json(404, { error: 'Not found.' });
        const body = bodyJson as {
          env: string;
          ciphertextSize: number;
          ciphertextSha256: string;
          recipientsHash: string;
        };
        const versions = proj.environments.get(body.env) ?? [];
        const versionNumber = (versions[versions.length - 1]?.version ?? 0) + 1;
        const versionId = `v_${proj.slug}_${body.env}_${versionNumber}`;
        // Stash a placeholder fixture; the actual ciphertext bytes get
        // captured when the CLI PUTs to the R2 URL below.
        const fixture: EnvVersionFixture = {
          versionId,
          version: versionNumber,
          environmentSlug: body.env,
          ciphertext: new Uint8Array(0),
          ciphertextSha256: body.ciphertextSha256,
          recipientsHash: body.recipientsHash,
        };
        versions.push(fixture);
        proj.environments.set(body.env, versions);
        return json(200, {
          versionId,
          version: versionNumber,
          environmentSlug: body.env,
          workspaceType: ws.type,
          uploadUrl: `${url.origin}/r2/${versionId}`,
          // The URL we just constructed uses the same origin as the incoming
          // request, which is the same listener — the CLI's subsequent PUT
          // will land back on this server's `/r2/*` branch above.
          requiredHeaders: { 'content-type': 'application/octet-stream' },
          expiresIn: 600,
        });
      }

      // POST /api/v1/workspaces/<ws>/projects/<proj>/push/<versionId>/finalize
      m = /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/push\/([^/]+)\/finalize$/.exec(
        url.pathname,
      );
      if (method === 'POST' && m) {
        const ws = state.workspaces.get(m[1]!);
        const proj = ws?.projects.get(m[2]!);
        if (!ws || !proj) return json(404, { error: 'Not found.' });
        // Locate the fixture for this versionId and copy in the bytes the CLI PUT.
        for (const [envSlug, versions] of proj.environments) {
          const v = versions.find((vv) => vv.versionId === m![3]);
          if (v) {
            const blob = r2Blobs.get(`/r2/${v.versionId}`);
            if (blob) v.ciphertext = blob;
            return json(200, {
              versionId: v.versionId,
              version: v.version,
              environmentSlug: envSlug,
            });
          }
        }
        return json(404, { error: 'Version not found.' });
      }

      // GET /api/v1/workspaces/<ws>/projects/<proj>/pull?env=<slug>
      m = /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/pull$/.exec(url.pathname);
      if (method === 'GET' && m) {
        const ws = state.workspaces.get(m[1]!);
        const proj = ws?.projects.get(m[2]!);
        if (!ws || !proj) return json(404, { error: 'Not found.' });
        const envSlug = url.searchParams.get('env') ?? 'development';
        const versions = proj.environments.get(envSlug) ?? [];
        const current = resolveCurrent(state, ws.slug, proj.slug, envSlug, versions);
        if (!current) return json(404, { error: 'Environment has no pushed version yet.' });
        return json(200, {
          versionId: current.versionId,
          version: current.version,
          environmentSlug: envSlug,
          workspaceType: ws.type,
          ciphertextSize: current.ciphertext.byteLength,
          ciphertextSha256: current.ciphertextSha256,
          recipientsHash: current.recipientsHash,
          downloadUrl: `${url.origin}/r2/${current.versionId}`,
          expiresIn: 300,
        });
      }

      // GET /api/v1/workspaces/<ws>/projects/<proj>/environments/<env>/versions
      m = /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/environments\/([^/]+)\/versions$/.exec(
        url.pathname,
      );
      if (method === 'GET' && m) {
        const ws = state.workspaces.get(m[1]!);
        const proj = ws?.projects.get(m[2]!);
        if (!ws || !proj) return json(404, { error: 'Not found.' });
        const envSlug = m[3]!;
        const versions = proj.environments.get(envSlug) ?? [];
        const current = resolveCurrent(state, ws.slug, proj.slug, envSlug, versions);
        // Newest-first response shape matches the real API.
        const ordered = [...versions].sort((a, b) => b.version - a.version);
        return json(200, {
          environmentSlug: envSlug,
          versionHistoryLimit: ws.versionHistoryLimit ?? 50,
          versions: ordered.map((v) => ({
            id: v.versionId,
            version: v.version,
            ciphertextSize: v.ciphertext.byteLength,
            comment: null,
            createdAt: new Date().toISOString(),
            createdByEmail: 'test@example.com',
            current: current ? v.versionId === current.versionId : false,
          })),
        });
      }

      // POST /api/v1/workspaces/<ws>/projects/<proj>/environments/<env>/current
      m = /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/environments\/([^/]+)\/current$/.exec(
        url.pathname,
      );
      if (method === 'POST' && m) {
        const ws = state.workspaces.get(m[1]!);
        const proj = ws?.projects.get(m[2]!);
        if (!ws || !proj) return json(404, { error: 'Not found.' });
        const envSlug = m[3]!;
        const versions = proj.environments.get(envSlug) ?? [];
        const body = bodyJson as { versionId?: string; version?: number };
        if (!body || (!body.versionId && body.version === undefined)) {
          return json(400, { error: 'pass exactly one of `versionId` or `version`' });
        }
        const target = body.versionId
          ? versions.find((v) => v.versionId === body.versionId)
          : versions.find((v) => v.version === body.version);
        if (!target) return json(404, { error: 'Version not found.' });

        const previous = resolveCurrent(state, ws.slug, proj.slug, envSlug, versions);
        const isNoop = previous?.versionId === target.versionId;
        if (!isNoop) {
          // Record the new current pointer.
          state.currentVersions = state.currentVersions ?? [];
          const existingIdx = state.currentVersions.findIndex(
            (c) =>
              c.workspaceSlug === ws.slug &&
              c.projectSlug === proj.slug &&
              c.envSlug === envSlug,
          );
          const entry: CurrentVersionPointer = {
            workspaceSlug: ws.slug,
            projectSlug: proj.slug,
            envSlug,
            versionId: target.versionId,
          };
          if (existingIdx >= 0) state.currentVersions[existingIdx] = entry;
          else state.currentVersions.push(entry);
        }
        return json(200, {
          ok: true,
          noop: isNoop,
          versionId: target.versionId,
          version: target.version,
          environmentSlug: envSlug,
        });
      }

      return json(404, { error: `No mock handler for ${method} ${url.pathname}` });
    },
  });

  return {
    url: server.url.origin,
    state,
    requests,
    stop: async () => {
      await server.stop(true);
    },
  };
}
