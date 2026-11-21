import type { Plugin } from 'vite'
import { createTextDatabase } from './textDatabase.ts'

export function textApiPlugin(directory: string): Plugin {
  const db = createTextDatabase(directory)
  return {
    name: 'bifrost-private-text-api', apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__bifrost_txt/')) return next()
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        const respond = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)) }
        const host = req.headers.host ?? ''
        if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`)) return respond(403, { message: 'Kho TXT chỉ phục vụ phát triển trên localhost.' })
        try {
          let payload = ''
          for await (const chunk of req) {
            payload += chunk
            if (Buffer.byteLength(payload) > 220000) return respond(413, { message: 'Yêu cầu quá lớn.' })
          }
          const body: unknown = payload ? JSON.parse(payload) : {}
          if (!body || typeof body !== 'object' || Array.isArray(body)) return respond(400, { message: 'Dữ liệu không hợp lệ.' })
          const result = await db.request(req.url.split('?')[0].replace('/__bifrost_txt', ''), req.method, req.headers.authorization, body as Record<string, unknown>)
          respond(result.status, result.body)
        } catch (error) {
          if (error instanceof SyntaxError) return respond(400, { message: 'JSON không hợp lệ.' })
          server.config.logger.error(`TXT database: ${String(error)}`)
          respond(500, { message: 'Không đọc/ghi được kho TXT. Hãy kiểm tra terminal; dữ liệu cũ được giữ nguyên.' })
        }
      })
    },
  }
}
