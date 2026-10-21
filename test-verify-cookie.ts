import { verifyTokenFromCookie } from '@/lib/auth/tokens';

async function test() {
  const cookieHeader = 'access_token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2YjU5YTM1Mi0yODRiLTQyYjgtYTJhNC1mNjkzNTBkODM3ZjIiLCJyb2xlIjoiYWRtaW5pc3RyYXRvciIsImp0aSI6ImI5NzJjNGZkYzM4YjMwM2YzNzNmYmMwZmU1NjU1Yjk3IiwiaXBIYXNoIjoiZWZmOGU3Y2E1MDY2MjdmZSIsImlhdCI6MTc5MjM0NzYzMSwiZXhwIjoxNzkyMzQ4NTMxfQ.NyntjeiQBF8rkcRACQUOENHIKTeXFszKdnzeAszIr99TqiItMNX9SlLbiNdVurRDbQVdHWk25bVr1vUeF87R4gBluJRY59Gd4smo3r4BzSFiajbB7bn9bNa5edMxoidqvn3gHl39HgucGYK3FXL-8RnmWwLcEMxNAjOv5mxVyDY63hKPUg8vYKQqsE3C0r1LgmqCjuMrRLn0Bes113XANQsrpmOEltm8OBopAQPEPEtsrU56sQNOJUuB2kA9IVoT_5qInDp59aUp-TI4QXm5P6N7Utss-SiWFVPRVaSRBm06kP9FdawcOn2bP29HXyVgY3UErBwWbsh5ZIjBDI9rmw; refresh_token=SCiIcSa1otdIY_a7kU5uRIOkMW4Em-AAUuGHLpa4F9U';

  console.log('Testing verifyTokenFromCookie...');
  console.log('Cookie header length:', cookieHeader.length);

  // Test the regex
  const match = cookieHeader.match(/access_token=([^;]+)/);
  console.log('Regex match:', match ? match[1].substring(0, 50) + '...' : 'NO MATCH');

  const payload = await verifyTokenFromCookie(cookieHeader);
  console.log('Payload:', payload ? 'FOUND' : 'NULL');
  if (payload) {
    console.log('JTI:', payload.jti);
    console.log('Role:', payload.role);
  }
}

test().catch(console.error);