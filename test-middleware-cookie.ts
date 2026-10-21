import { verifyTokenFromCookie } from '@/lib/auth/tokens';
import { getSession } from '@/lib/auth/session';

async function test() {
  // Simulate the exact cookie header the middleware would receive
  const cookieHeader = 'access_token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2YjU5YTM1Mi0yODRiLTQyYjgtYTJhNC1mNjkzNTBkODM3ZjIiLCJyb2xlIjoiYWRtaW5pc3RyYXRvciIsImp0aSI6ImQzZTdkYTZlM2EyNjI0NzllY2RmOTkxZDI2ODQ0NzczIiwiaXBIYXNoIjoiM2U0OGVmOWQyMmUwOTZkYSIsImlhdCI6MTc5MjM0NjM3MiwiZXhwIjoxNzkyMzQ3MjcyfQ.IxMqUXrejhCrob4teg-ya1hHLNX-vFrWXlFlKz4qSvnBHqu_b1WW4oE98_TH38DPKudy3SxNIUteohEIREPLRcrTRZGUVsrcC7R99yZtHexiSTLkJFGzcs04d071MZMyJPeHDUp87VrKrJW4_-CIKwComUL2l8WzS_RI8j_oZSfMkTS--TI4t4sIjZMgfYhCDfqnMzsadCzhI3YBs-KNwVWMlY-hswDmMl7CkqyqXHE2Y-6gr9VuHEjHOx-1bBDdQJmPJ4ptfaZ7qIBxB6r4ma4o9x14JOxkd60a1HBk4HqukfiYu7BEXz8owmTTOLtnkdJI7b46JQzeYzi8sIkZRA; refresh_token=iP9ZN25hoaURQZ0CpRfaNTC1F7-URJUFYG22iNbsMbs';

  console.log('Testing with middleware-style cookie header...');
  const payload = await verifyTokenFromCookie(cookieHeader);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  if (payload) {
    console.log('\nTesting getSession...');
    const session = await getSession(payload.jti);
    console.log('Session:', JSON.stringify(session, null, 2));
  }
}

test().catch(console.error);