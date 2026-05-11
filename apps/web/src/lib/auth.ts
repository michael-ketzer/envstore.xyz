import NextAuth, { type DefaultSession } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import type { Provider } from 'next-auth/providers';
import { z } from 'zod';

import { prisma } from '@envstore/db';
import { DEFAULTS } from '@envstore/shared';

import { env, features } from '@/env';
import { verifyOtp } from './auth-otp';

// Augment the default Session type with our `user.id`.
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
  }
}

const providers: Provider[] = [];

if (features.githubAuth) {
  providers.push(
    GitHub({
      clientId: env.AUTH_GITHUB_ID!,
      clientSecret: env.AUTH_GITHUB_SECRET!,
      // Allow the same email to link across providers — the user might sign in
      // with GitHub one day and Google the next.
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

if (features.googleAuth) {
  providers.push(
    Google({
      clientId: env.AUTH_GOOGLE_ID!,
      clientSecret: env.AUTH_GOOGLE_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

const otpCredentialsSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(new RegExp(`^\\d{${DEFAULTS.otpDigits}}$`)),
});

providers.push(
  Credentials({
    id: 'email-otp',
    name: 'Email code',
    credentials: {
      email: { label: 'Email', type: 'email' },
      code: { label: 'Code', type: 'text' },
    },
    authorize: async (raw) => {
      const parsed = otpCredentialsSchema.safeParse(raw);
      if (!parsed.success) return null;
      const userId = await verifyOtp(parsed.data.email, parsed.data.code);
      if (!userId) return null;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      return user ?? null;
    },
  }),
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Credentials providers require JWT — adapter is still used for OAuth account linking.
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers,
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user && 'id' in user && typeof user.id === 'string') {
        token.userId = user.id;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (typeof token.userId === 'string') {
        session.user.id = token.userId;
      }
      return session;
    },
  },
  trustHost: true,
});
