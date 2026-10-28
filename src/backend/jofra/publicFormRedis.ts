import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "redis";
import type { JofraPublicFormType } from "@/shared/jofra-public-form-schemas";
import { requireRedisUrl } from "@/backend/redisUrl";

const WINDOW_SECONDS = 10 * 60;
const MAX_SUBMISSIONS = 3;
const PENDING_SECONDS = 2 * 60;
const COMPLETED_SECONDS = 24 * 60 * 60;

const RESERVE_SCRIPT = `
local previous = redis.call('GET', KEYS[2])
if previous == 'sent' then return 2 end
if previous == 'pending' then return 3 end
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if count > tonumber(ARGV[2]) then return 0 end
redis.call('SET', KEYS[2], 'pending', 'EX', ARGV[3])
return 1
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == 'pending' then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

type RedisClient = ReturnType<typeof createClient>;
let redisClient: RedisClient | undefined;
let redisConnecting: Promise<RedisClient> | undefined;

async function getRedisClient(): Promise<RedisClient> {
  if (redisClient?.isOpen) return redisClient;
  if (redisConnecting) {
    const pending = redisConnecting;
    const connectedClient = await pending;
    if (connectedClient.isOpen) return connectedClient;
    if (redisConnecting === pending) redisConnecting = undefined;
  }
  if (redisConnecting) return redisConnecting;

  const client = createClient({
    url: requireRedisUrl(process.env.REDIS_URL),
    socket: { connectTimeout: 3000, reconnectStrategy: false },
  });
  client.on("error", () => {
    console.error("[Jofra public forms] Redis connection error");
  });
  redisConnecting = client.connect()
    .then(() => {
      redisClient = client;
      return client;
    })
    .catch((error: unknown) => {
      redisConnecting = undefined;
      throw error;
    });

  return redisConnecting;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type SubmissionReservation =
  | { status: "reserved"; providerKey: string; redisKey: string }
  | { status: "already-sent" }
  | { status: "in-progress" }
  | { status: "rate-limited" };

export async function reservePublicSubmission(
  type: JofraPublicFormType,
  ip: string,
  idempotencyKey: string,
): Promise<SubmissionReservation> {
  const ipKey = digest(ip);
  const redisKey = `jofra:public-form:submission:${type}:${ipKey}:${digest(idempotencyKey)}`;
  const rateKey = `jofra:public-form:rate:${type}:${ipKey}`;
  const client = await getRedisClient();
  const result = Number(await client.eval(RESERVE_SCRIPT, {
    keys: [rateKey, redisKey],
    arguments: [
      String(WINDOW_SECONDS),
      String(MAX_SUBMISSIONS),
      String(PENDING_SECONDS),
    ],
  }));

  if (result === 2) return { status: "already-sent" };
  if (result === 3) return { status: "in-progress" };
  if (result === 0) return { status: "rate-limited" };
  if (result !== 1) throw new Error("Unexpected public submission reservation response");

  return {
    status: "reserved",
    providerKey: digest(`${type}:${ipKey}:${idempotencyKey}`),
    redisKey,
  };
}

export async function markPublicSubmissionSent(redisKey: string): Promise<void> {
  const client = await getRedisClient();
  await client.set(redisKey, "sent", { EX: COMPLETED_SECONDS });
}

export async function releasePublicSubmission(redisKey: string): Promise<void> {
  const client = await getRedisClient();
  await client.eval(RELEASE_SCRIPT, { keys: [redisKey], arguments: [] });
}
