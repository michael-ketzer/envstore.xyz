import 'server-only';
import { redirect } from 'next/navigation';

import { auth } from './auth';

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }
  return session;
}
