export const DEFAULT_SERVER_ORIGIN = 'http://localhost:3000'
export const DEFAULT_API_URL = `${DEFAULT_SERVER_ORIGIN}/api`
export const DEV_TXT_PROXY_PREFIX = '/__bifrost_txt'

export interface AppUrlEnv {
  DEV?: boolean
  VITE_DATA_MODE?: string
  VITE_API_URL?: string
  VITE_SIGNALING_URL?: string
}

export interface ResolvedAppUrls {
  /** Base HTTP(S) origin of the backend host (e.g. 'http://localhost:3000'), or '' for relative proxy mode. */
  serverOrigin: string
  /** Normalized REST API base URL ending with a single '/api' segment and no trailing slash. */
  apiBaseUrl: string
  /** Normalized Socket.IO signaling URL with no trailing slash. */
  signalingUrl: string
}

export interface FetchAppApiOptions {
  env?: AppUrlEnv
  apiBaseUrl?: string
  fetchImpl?: typeof fetch
}

function getRuntimeEnv(): AppUrlEnv {
  return ((import.meta as { env?: AppUrlEnv }).env) ?? {}
}

function getBrowserOrigin(): string {
  return typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

function normalizeApiPathname(pathname: string): string {
  const cleaned = stripTrailingSlashes(pathname)
  if (!cleaned) return '/api'
  if (/(\/api)+$/i.test(cleaned)) {
    return cleaned.replace(/(\/api)+$/i, '/api')
  }
  return `${cleaned}/api`
}

function normalizeSignalingUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const stripped = stripTrailingSlashes(trimmed)
  return stripped || '/'
}

/**
 * Resolves and distinguishes Server Origin, REST API Base URL, and Socket.IO Signaling URL
 * from Vite env vars (`VITE_API_URL`, `VITE_SIGNALING_URL`) with development fallbacks.
 */
export function resolveAppUrls(
  env: AppUrlEnv = getRuntimeEnv(),
  browserOrigin: string = getBrowserOrigin(),
): ResolvedAppUrls {
  const rawApi = (env.VITE_API_URL ?? '').trim()

  let serverOrigin = DEFAULT_SERVER_ORIGIN
  let apiBaseUrl = DEFAULT_API_URL

  if (rawApi) {
    if (rawApi.startsWith('/')) {
      serverOrigin = stripTrailingSlashes(browserOrigin)
      apiBaseUrl = normalizeApiPathname(rawApi)
    } else {
      const candidate = /^[a-z][a-z\d+\-.]*:\/\//i.test(rawApi) ? rawApi : `http://${rawApi}`
      try {
        const parsed = new URL(stripTrailingSlashes(candidate))
        serverOrigin = parsed.origin
        apiBaseUrl = `${parsed.origin}${normalizeApiPathname(parsed.pathname)}`
      } catch {
        serverOrigin = DEFAULT_SERVER_ORIGIN
        apiBaseUrl = DEFAULT_API_URL
      }
    }
  }

  const rawSignaling = normalizeSignalingUrl(env.VITE_SIGNALING_URL ?? '')
  const signalingUrl = rawSignaling || serverOrigin

  return {
    serverOrigin,
    apiBaseUrl,
    signalingUrl,
  }
}

/**
 * Joins an API endpoint path onto the resolved `apiBaseUrl` without double slashes or `/api/api`.
 */
export function buildApiUrl(endpoint: string, apiBaseUrl: string = API_URL): string {
  const trimmedBase = stripTrailingSlashes(apiBaseUrl.trim())
  const normalizedBase = trimmedBase.startsWith('/')
    ? normalizeApiPathname(trimmedBase)
    : (() => {
        try {
          const parsed = new URL(trimmedBase)
          return `${parsed.origin}${normalizeApiPathname(parsed.pathname)}`
        } catch {
          return DEFAULT_API_URL
        }
      })()

  const trimmedEndpoint = endpoint.trim().replace(/^\/+/, '')
  const cleanEndpoint = trimmedEndpoint.replace(/^api(?=\/|$)/i, '').replace(/^\/+/, '')
  return cleanEndpoint ? `${normalizedBase}/${cleanEndpoint}` : normalizedBase
}

export function extractDevTxtPath(url: string, apiBaseUrl: string = API_URL): string {
  const parsedUrl = new URL(url, 'http://localhost')
  const parsedBase = new URL(apiBaseUrl || DEFAULT_API_URL, 'http://localhost')
  const basePath = stripTrailingSlashes(parsedBase.pathname)

  let relativePath = parsedUrl.pathname
  if (basePath && (relativePath === basePath || relativePath.startsWith(`${basePath}/`))) {
    relativePath = relativePath.slice(basePath.length)
  } else {
    relativePath = relativePath.replace(/^.*?\/api(?=\/|$)/i, '')
  }

  if (!relativePath.startsWith('/')) {
    relativePath = `/${relativePath}`
  }
  return `${relativePath}${parsedUrl.search}`
}

const resolvedDefaults = resolveAppUrls()

export const SERVER_ORIGIN = resolvedDefaults.serverOrigin
export const API_URL = resolvedDefaults.apiBaseUrl
export const SIGNALING_URL = resolvedDefaults.signalingUrl

export function apiUrl(endpoint: string): string {
  return buildApiUrl(endpoint, API_URL)
}

/** Development TXT storage is private to Vite; production keeps the existing API. */
export function isDevMockSession(token: string, env: AppUrlEnv = getRuntimeEnv()): boolean {
  return Boolean(env.DEV) && (token.startsWith('bifrost-txt-') || token === 'bifrost-ui-mock-admin')
}

export async function fetchAppApi(
  input: string,
  init?: RequestInit,
  options?: FetchAppApiOptions,
): Promise<Response> {
  const env = options?.env ?? getRuntimeEnv()
  const baseUrl = options?.apiBaseUrl ?? resolveAppUrls(env).apiBaseUrl
  const fetchFn = options?.fetchImpl ?? fetch

  if (input.startsWith(`${DEV_TXT_PROXY_PREFIX}/`) || input === DEV_TXT_PROXY_PREFIX) {
    return fetchFn(input, init)
  }

  const targetUrl = /^(https?:)?\/\//i.test(input) ? input : buildApiUrl(input, baseUrl)

  if (env.DEV) {
    const bearer = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /, '') ?? ''
    const txtPath = extractDevTxtPath(targetUrl, baseUrl)
    const routePath = txtPath.split('?')[0]
    const localAuth = env.VITE_DATA_MODE !== 'api' && ['/auth/login', '/auth/register'].includes(routePath)
    if (localAuth || isDevMockSession(bearer, env)) {
      return fetchFn(`${DEV_TXT_PROXY_PREFIX}${txtPath}`, init)
    }
  }

  return fetchFn(targetUrl, init)
}
