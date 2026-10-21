import { verifyTokenFromCookie } from '@/lib/auth/tokens';
import { getSession } from '@/lib/auth/session';

async function test() {
  const cookieHeader = 'access_token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2YjU5YTM1Mi0yODRiLTQyYjgtYTJhNC1mNjkzNTBkODM3ZjIiLCJyb2xlIjoiYWRtaW5pc3RyYXRvciIsImp0aSI6ImM5NmNhMjI5OWEyYzU3OTgwZmVkYWQ1Y2I1MDZlMTEyIiwiaXBIYXNoIjoiZWZmOGU3Y2E1MDY2MjdmZSIsImlhdCI6MTc5MjM0NjA1MCwiZXhwIjoxNzkyMzQ2OTUwfQ.dummy; refresh_token=dummy';

  console.log('Testing verifyTokenFromCookie...');
  const payload = await verifyTokenFromCookie(cookieHeader);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  if (payload) {
    console.log('\nTesting getSession...');
    const session = await getSession(payload.jti);
    console.log('Session:', JSON.stringify(session, null, 2));
  }
}

test().catch(console.error);