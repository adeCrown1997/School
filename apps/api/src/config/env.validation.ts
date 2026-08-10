import { z } from 'zod';

/**
 * Environment schema. The app refuses to boot if required variables are
 * missing or malformed — no silent defaults for anything security-relevant.
 * Secrets are read here and NEVER shipped to the client.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  COOKIE_DOMAIN: z.string().default('localhost'),

  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(12),
  ACTIVATION_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  MAX_ACTIVATION_ATTEMPTS: z.coerce.number().int().positive().default(5),

  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().default('System Administrator'),

  UPLOAD_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_LOCAL_DIR: z.string().default('./uploads'),
});

export type AppEnv = z.infer<typeof EnvSchema>;

/**
 * Validate raw process.env once at startup. Throws a readable aggregated error
 * listing every invalid/missing variable.
 */
export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
