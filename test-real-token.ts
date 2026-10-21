import { verifyTokenFromCookie } from '@/lib/auth/tokens';
import { getSession } from '@/lib/auth/session';

async function test() {
  // Get a fresh token first
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'password123' }),
  });
  const cookieHeader = loginRes.headers.get('set-cookie') || '';
  console.log('Cookie header:', cookieHeader);

  // Extract access_token
  const match = cookieHeader.match(/access_token=([^;]+)/);
  if (!match) {
    console.log('No access token found');
    return;
  }
  const accessToken = match[1];
  console.log('Access token length:', accessToken.length);

  // Test verifyTokenFromCookie
  const testCookie = `access_token=${accessToken}; refresh_token=dummy`;
  const payload = await verifyTokenFromCookie(testCookie);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  if (payload) {
    console.log('\nTesting getSession...');
    const session = await getSession(payload.jti);
    console.log('Session:', JSON.stringify(session, null, 2));
  }
}

test().catch(console.error);
