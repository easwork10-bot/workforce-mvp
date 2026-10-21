import { verifyTokenFromCookie } from '@/lib/auth/tokens';
import { getSession } from '@/lib/auth/session';

async function test() {
  // Simulate exactly what the middleware receives
  // Get fresh token from API
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'password123' }),
  });

  const cookieHeader = loginRes.headers.get('set-cookie') || '';
  console.log('Raw cookie header from login response:');
  console.log(cookieHeader);
  console.log('---');

  // The middleware gets cookies from req.headers.get('cookie')
  // This would be the Cookie header sent by the browser
  // Format: access_token=xxx; refresh_token=yyy

  // Parse the set-cookie header to extract tokens
  const accessMatch = cookieHeader.match(/access_token=([^;]+)/);
  const refreshMatch = cookieHeader.match(/refresh_token=([^;]+)/);

  if (!accessMatch) {
    console.log('No access token found in set-cookie');
    return;
  }

  const accessToken = accessMatch[1];
  const refreshToken = refreshMatch ? refreshMatch[1] : 'dummy';

  // Now construct the Cookie header as the browser would send it
  const browserCookieHeader = `access_token=${accessToken}; refresh_token=${refreshToken}`;
  console.log('Browser Cookie header:');
  console.log(browserCookieHeader);
  console.log('---');

  // Test verifyTokenFromCookie with this
  const payload = await verifyTokenFromCookie(browserCookieHeader);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  if (payload) {
    console.log('\nTesting getSession...');
    const session = await getSession(payload.jti);
    console.log('Session:', JSON.stringify(session, null, 2));
  }
}

test().catch(console.error);