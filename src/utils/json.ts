export function parseJsonWithBom<T>(raw: string): T {
  return JSON.parse(stripBom(raw)) as T;
}

export function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}