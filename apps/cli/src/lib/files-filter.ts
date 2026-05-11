// Filter logic shared by `envstore push` and `envstore pull` when running
// against a multi-file (monorepo) config.
//
// Filters AND together. An entry must satisfy every provided filter to be
// included:
//   - `path` (positional): exact match OR directory prefix, resolved against
//     the config directory + cwd.
//   - `project`: exact match on the entry's project slug.
//   - `env`: exact match on the entry's `environment` field.

import { isAbsolute, relative, resolve } from 'node:path';

import type { EnvstoreFileEntry } from '@envstore/shared';

export type FileFilters = {
  path?: string;
  project?: string;
  env?: string;
};

export function matchFiles(
  files: readonly EnvstoreFileEntry[],
  filters: FileFilters,
  configDir: string,
): EnvstoreFileEntry[] {
  const pathAbs = filters.path
    ? isAbsolute(filters.path)
      ? filters.path
      : resolve(process.cwd(), filters.path)
    : null;

  return files.filter((f) => {
    if (filters.project && f.project !== filters.project) return false;
    if (filters.env && f.environment !== filters.env) return false;
    if (pathAbs) {
      const fileAbs = resolve(configDir, f.path);
      if (fileAbs === pathAbs) return true;
      // Directory-prefix match — require the filter to be an ancestor dir.
      const rel = relative(pathAbs, fileAbs);
      if (rel.startsWith('..') || isAbsolute(rel)) return false;
    }
    return true;
  });
}
