import 'server-only';
import { Resend } from 'resend';

import { env, features } from '@/env';

const resend = features.emailOtp ? new Resend(env.RESEND_API_KEY!) : null;

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  if (!resend || !env.RESEND_FROM) {
    // Dev fallback: print the code so the dev can log in without Resend configured.
    console.warn(`[envstore-dev] OTP for ${to}: ${code}`);
    return;
  }
  await resend.emails.send({
    from: env.RESEND_FROM,
    to,
    subject: `envstore login code: ${code}`,
    text: [
      `Your envstore login code is: ${code}`,
      ``,
      `It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    ].join('\n'),
    html: `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:480px;margin:32px auto;color:#0f172a;">
  <h1 style="font-size:18px;font-weight:600;margin:0 0 16px;">envstore login code</h1>
  <p style="margin:0 0 12px;">Use this code to finish signing in:</p>
  <p style="font-family:ui-monospace,SF Mono,monospace;font-size:32px;font-weight:600;letter-spacing:6px;background:#f1f5f9;padding:16px 24px;display:inline-block;border-radius:8px;">${code}</p>
  <p style="margin:16px 0 0;color:#64748b;font-size:13px;">Expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
</body></html>`,
  });
}

export async function sendInviteEmail(opts: {
  to: string;
  workspaceName: string;
  inviterName: string;
  acceptUrl: string;
}): Promise<void> {
  if (!resend || !env.RESEND_FROM) {
    console.warn(`[envstore-dev] Invite to ${opts.to}: ${opts.acceptUrl}`);
    return;
  }
  await resend.emails.send({
    from: env.RESEND_FROM,
    to: opts.to,
    subject: `${opts.inviterName} invited you to "${opts.workspaceName}" on envstore`,
    text: [
      `${opts.inviterName} invited you to the workspace "${opts.workspaceName}" on envstore.`,
      ``,
      `Accept the invite: ${opts.acceptUrl}`,
    ].join('\n'),
  });
}
