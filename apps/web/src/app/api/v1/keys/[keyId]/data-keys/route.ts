import { runtimeRequest } from '@/lib/managed-keys/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ keyId: string }> }) {
  return runtimeRequest(req, (await ctx.params).keyId, 'generate');
}
