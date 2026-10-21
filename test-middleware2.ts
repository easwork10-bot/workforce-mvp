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

  console.log('Testing middleware logic...');

  // Step 1: verifyTokenFromCookie
  console.log('\n1. verifyTokenFromCookie...');
  const payload = await verifyTokenFromCookie(browserCookieHeader);
  console.log('   Payload:', payload ? 'FOUND' : 'NULL');

  if (!payload) {
    console.log('   FAILED: No payload returned');
    return;
  }
  console.log('   JTI:', payload.jti);
  console.log('   Role:', payload.role);

  // Step 2: getSession
  console.log('\n2. getSession...');
  const session = await getSession(payload.jti);
  console.log('   Session:', session ? 'FOUND' : 'NULL');

  if (!session) {
    console.log('   FAILED: No session found');
    return;
  }
  console.log('   Role from session:', session.role);

  // Step 3: Role check (middleware logic)
  console.log('\n3. Role check...');
  const isAdminRoute = '/admin'.startsWith('/admin'); // true
  const isSupervisorRoute = '/admin'.startsWith('/supervisor'); // false
  const isEmployeeRoute = '/admin'.startsWith('/employee'); // false
  const isAttendanceRoute = '/admin'.startsWith('/attendance'); // false

  console.log('   isAdminRoute:', isAdminRoute);
  console.log('   isSupervisorRoute:', isSupervisorRoute);
  console.log('   isEmployeeRoute:', isEmployeeRoute);
  console.log('   isAttendanceRoute:', isAttendanceRoute);

  // Check role
  const role = session.role;
  console.log('   User role:', role);

  if (isAdminRoute && role !== 'administrator') {
    console.log('   REDIRECT: Wrong role for admin route');
  } else if (isAdminRoute && role === 'administrator') {
    console.log('   ALLOW: Correct role for admin route');
  }
}

test().catch(console.error);