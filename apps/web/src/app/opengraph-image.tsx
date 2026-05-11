import { ImageResponse } from 'next/og';

export const alt = 'envstore — your secrets, your keys';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#fff',
          color: '#000',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '80px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#000"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
            <circle cx="16.5" cy="7.5" r=".5" fill="#000" />
          </svg>
          <div style={{ fontSize: 36, fontWeight: 600 }}>envstore</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div
            style={{
              fontSize: 80,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            }}
          >
            Stop trusting vendors with your secrets.
          </div>
          <div style={{ fontSize: 28, color: '#666' }}>
            Zero-knowledge encrypted .env file storage. $1.99 / workspace.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
