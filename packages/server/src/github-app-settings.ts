import { createPrivateKey } from "node:crypto";

export type GitHubAppSettings = {
  appId: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  webhookSecret: string;
};

type Environment = Readonly<Record<string, string | undefined>>;

function required(env: Environment, name: string, validate: (value: string) => boolean) {
  const value = env[name];
  if (!value || !validate(value)) throw new Error(`Set a valid ${name}.`);
  return value;
}

export function isConfiguredSecret(value: string, minimum: number) {
  return value.length >= minimum && value.length <= 1024 && value.trim() === value && !/\p{Cc}/u.test(value);
}

export function readGitHubAppSettings(env: Environment = process.env): GitHubAppSettings {
  const appId = required(env, "GITHUB_APP_ID", (value) => /^[1-9][0-9]{0,19}$/u.test(value));
  const clientId = required(env, "GITHUB_APP_CLIENT_ID", (value) => /[A-Za-z]/u.test(value) && /^[A-Za-z0-9_.-]{8,128}$/u.test(value));
  const clientSecret = required(env, "GITHUB_APP_CLIENT_SECRET", (value) => isConfiguredSecret(value, 16) && /^[A-Za-z0-9_.-]+$/u.test(value));
  const webhookSecret = required(env, "GITHUB_APP_WEBHOOK_SECRET", (value) => isConfiguredSecret(value, 32));
  const privateKey = required(env, "GITHUB_APP_PRIVATE_KEY", (value) => value.length <= 16_384)
    .replaceAll("\\r\\n", "\n").replaceAll("\\n", "\n").trim();
  try {
    if (!/^-----BEGIN (?:RSA )?PRIVATE KEY-----\r?\n/u.test(privateKey)) throw new Error();
    const key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
  } catch {
    throw new Error("GITHUB_APP_PRIVATE_KEY must be an unencrypted RSA private key of at least 2048 bits.");
  }
  return { appId, clientId, clientSecret, privateKey, webhookSecret };
}
