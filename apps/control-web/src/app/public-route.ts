export function normalizeControlPathname(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) return '/';
  const normalized = trimmed.replace(/\/+$/, '');
  return normalized || '/';
}

export function isPublicControlRoute(pathname: string): boolean {
  return normalizeControlPathname(pathname) === '/sign-in';
}
