import argon2 from 'argon2';

const options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hash of a non-password. Used so a missing account takes about as long as a real check. */
const dummyPasswordHash =
  '$argon2id$v=19$m=19456,p=1,t=2$fAEnIsJcQgutQR3u6IJXtA$RNJ1jK9cVDTxIi10taND44z9bhFtOb7qzxBeIuBT+io';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, options);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

export async function absorbMissingAccount(password: string): Promise<void> {
  await verifyPassword(password, dummyPasswordHash);
}
