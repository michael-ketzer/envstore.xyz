import { adminRequest } from '@/lib/managed-keys/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ workspaceSlug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const params = await ctx.params;
  return adminRequest(req, params.workspaceSlug, 'credential.list');
}

export async function POST(req: Request, ctx: Ctx) {
  const params = await ctx.params;
  return adminRequest(req, params.workspaceSlug, 'credential.issue');
}
