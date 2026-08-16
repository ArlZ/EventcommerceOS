const LOCAL_CONTROL_WEB_ORIGIN = 'http://localhost:3000';

export function controlWebOrigin(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.CONTROL_WEB_ORIGIN?.trim();
  if (!configured) {
    if (environment.NODE_ENV === 'production') {
      throw new Error('CONTROL_WEB_ORIGIN is required in production');
    }
    return LOCAL_CONTROL_WEB_ORIGIN;
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('CONTROL_WEB_ORIGIN must be a valid absolute URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('CONTROL_WEB_ORIGIN must use http or https');
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/'
  ) {
    throw new Error(
      'CONTROL_WEB_ORIGIN must be an origin without credentials, path, query or fragment',
    );
  }
  if (environment.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('CONTROL_WEB_ORIGIN must use HTTPS in production');
  }

  return parsed.origin;
}
