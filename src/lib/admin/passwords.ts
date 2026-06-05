export const DEMO_AGENT_CREDENTIALS = [
  { username: 'gdt-a', password: 'Ya8pL3qN2x' },
  { username: 'gdt-b', password: 'R6mT9vK4sQ' },
  { username: 'douyin-a', password: 'D7xP2nV8cL' },
  { username: 'douyin-b', password: 'M5qZ8rA1tY' },
  { username: 'kuaishou-a', password: 'K9vB3sL6pN' },
  { username: 'kuaishou-b', password: 'H4tQ7xM2wR' },
  { username: 'xhs-a', password: 'X8nC5yP1zD' },
  { username: 'xhs-b', password: 'S3lV9kF6aB' },
] as const;

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateAgentPassword(length = 10) {
  const bytes = new Uint32Array(length);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 2 ** 32);
    }
  }

  return Array.from(bytes, (byte) => PASSWORD_CHARS[byte % PASSWORD_CHARS.length]).join('');
}
