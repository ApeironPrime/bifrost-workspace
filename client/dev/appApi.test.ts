import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SERVER_ORIGIN,
  apiUrl,
  buildApiUrl,
  extractDevTxtPath,
  fetchAppApi,
  isDevMockSession,
  resolveAppUrls,
} from '../src/lib/appApi.ts'

test('resolveAppUrls returns development fallbacks when env vars are unset', () => {
  const urls = resolveAppUrls({}, '')
  assert.equal(urls.serverOrigin, DEFAULT_SERVER_ORIGIN)
  assert.equal(urls.apiBaseUrl, 'http://localhost:3000/api')
  assert.equal(urls.signalingUrl, 'http://localhost:3000')
})

test('resolveAppUrls distinguishes serverOrigin, apiBaseUrl, and signalingUrl for custom VITE_API_URL', () => {
  const fromHost = resolveAppUrls({ VITE_API_URL: 'https://api.bifrost.example' }, '')
  assert.deepEqual(fromHost, {
    serverOrigin: 'https://api.bifrost.example',
    apiBaseUrl: 'https://api.bifrost.example/api',
    signalingUrl: 'https://api.bifrost.example',
  })

  const withApiPath = resolveAppUrls({ VITE_API_URL: 'https://api.bifrost.example:8443/api' }, '')
  assert.deepEqual(withApiPath, {
    serverOrigin: 'https://api.bifrost.example:8443',
    apiBaseUrl: 'https://api.bifrost.example:8443/api',
    signalingUrl: 'https://api.bifrost.example:8443',
  })

  const withSubpath = resolveAppUrls({ VITE_API_URL: 'https://gateway.bifrost.example/v1/' }, '')
  assert.deepEqual(withSubpath, {
    serverOrigin: 'https://gateway.bifrost.example',
    apiBaseUrl: 'https://gateway.bifrost.example/v1/api',
    signalingUrl: 'https://gateway.bifrost.example',
  })
})

test('resolveAppUrls honors custom VITE_SIGNALING_URL independently and strips trailing slashes', () => {
  const customBoth = resolveAppUrls(
    {
      VITE_API_URL: 'https://rest.bifrost.example/api///',
      VITE_SIGNALING_URL: 'wss://rtc.bifrost.example:9000///',
    },
    '',
  )
  assert.deepEqual(customBoth, {
    serverOrigin: 'https://rest.bifrost.example',
    apiBaseUrl: 'https://rest.bifrost.example/api',
    signalingUrl: 'wss://rtc.bifrost.example:9000',
  })

  const onlySignaling = resolveAppUrls({ VITE_SIGNALING_URL: 'http://localhost:4100/' }, '')
  assert.deepEqual(onlySignaling, {
    serverOrigin: 'http://localhost:3000',
    apiBaseUrl: 'http://localhost:3000/api',
    signalingUrl: 'http://localhost:4100',
  })
})

test('resolveAppUrls and buildApiUrl avoid duplicate /api/api and trailing slash issues', () => {
  const repeatedApi = resolveAppUrls({ VITE_API_URL: 'http://localhost:4000/api/api/' }, '')
  assert.equal(repeatedApi.serverOrigin, 'http://localhost:4000')
  assert.equal(repeatedApi.apiBaseUrl, 'http://localhost:4000/api')
  assert.equal(repeatedApi.signalingUrl, 'http://localhost:4000')

  assert.equal(buildApiUrl('/workspaces', 'http://localhost:4000/api/'), 'http://localhost:4000/api/workspaces')
  assert.equal(buildApiUrl('workspaces', 'http://localhost:4000/api'), 'http://localhost:4000/api/workspaces')
  assert.equal(buildApiUrl('/api/workspaces/1/rooms', 'http://localhost:4000/api/'), 'http://localhost:4000/api/workspaces/1/rooms')
  assert.equal(buildApiUrl('/api-keys', 'http://localhost:4000/api'), 'http://localhost:4000/api/api-keys')
  assert.equal(apiUrl('/auth/me'), 'http://localhost:3000/api/auth/me')
})

test('resolveAppUrls supports relative /api proxy configuration cleanly', () => {
  const relativeNoOrigin = resolveAppUrls({ VITE_API_URL: '/api/' }, '')
  assert.deepEqual(relativeNoOrigin, {
    serverOrigin: '',
    apiBaseUrl: '/api',
    signalingUrl: '',
  })

  const relativeWithOrigin = resolveAppUrls({ VITE_API_URL: '/api/' }, 'http://localhost:5173')
  assert.deepEqual(relativeWithOrigin, {
    serverOrigin: 'http://localhost:5173',
    apiBaseUrl: '/api',
    signalingUrl: 'http://localhost:5173',
  })
})

test('fetchAppApi preserves Dev TXT proxy routing and real API routing across custom base URLs', async () => {
  const calls: string[] = []
  const mockFetch = (async (url: RequestInfo | URL) => {
    calls.push(String(url))
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch

  assert.equal(extractDevTxtPath('https://gateway.example.com/proxy/api/workspaces/1/rooms', 'https://gateway.example.com/proxy/api'), '/workspaces/1/rooms')
  assert.equal(extractDevTxtPath('/api/auth/login', '/api'), '/auth/login')

  // Dev TXT auth route
  await fetchAppApi(
    'https://custom.example.com/api/auth/login',
    { method: 'POST' },
    { env: { DEV: true, VITE_DATA_MODE: 'txt', VITE_API_URL: 'https://custom.example.com/api' }, fetchImpl: mockFetch },
  )
  assert.equal(calls.at(-1), '/__bifrost_txt/auth/login')

  // Dev mock session token routes protected endpoints to Dev TXT proxy
  await fetchAppApi(
    '/workspaces/ws1/members',
    { headers: { Authorization: 'Bearer bifrost-txt-session-1' } },
    { env: { DEV: true, VITE_DATA_MODE: 'api', VITE_API_URL: 'https://custom.example.com/proxy/api/' }, fetchImpl: mockFetch },
  )
  assert.equal(calls.at(-1), '/__bifrost_txt/workspaces/ws1/members')

  // Dev API mode with real JWT uses configured custom API URL
  await fetchAppApi(
    '/workspaces/ws1/rooms',
    { headers: { Authorization: 'Bearer real-jwt-token' } },
    { env: { DEV: true, VITE_DATA_MODE: 'api', VITE_API_URL: 'http://localhost:4500/api/' }, fetchImpl: mockFetch },
  )
  assert.equal(calls.at(-1), 'http://localhost:4500/api/workspaces/ws1/rooms')

  // Production ignores bifrost-txt-* mock routing even if passed
  assert.equal(isDevMockSession('bifrost-txt-abc', { DEV: false }), false)
  await fetchAppApi(
    '/auth/me',
    { headers: { Authorization: 'Bearer bifrost-txt-abc' } },
    { env: { DEV: false, VITE_API_URL: 'https://prod.bifrost.app/' }, fetchImpl: mockFetch },
  )
  assert.equal(calls.at(-1), 'https://prod.bifrost.app/api/auth/me')
})
