import { applicationRequest } from '@/lib/managed-keys/applications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ workspaceSlug: string }> }) {
  return applicationRequest(req, (await ctx.params).workspaceSlug, 'unwrap');
}
