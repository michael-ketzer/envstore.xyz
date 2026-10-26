import { adminRequest } from '@/lib/managed-keys/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ workspaceSlug: string; credentialId: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  const params = await ctx.params;
  return adminRequest(req, params.workspaceSlug, 'credential.revoke', params.credentialId);
}
