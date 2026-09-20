'use strict'

const http = require('http')
const https = require('https')
const Service = require('webos-service')

const service = new Service('com.shiv.rally.service')
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024
const MAX_REDIRECTS = 4
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])


let proxyPort = 0

const proxyServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`)
    const targetUrlStr = parsedUrl.searchParams.get('url')
    if (!targetUrlStr) {
      res.writeHead(400); res.end('Missing url parameter.')
      return
    }
    const targetUrl = new URL(targetUrlStr)
    const headersStr = parsedUrl.searchParams.get('headers')
    let headers = {}
    if (headersStr) {
      try { headers = JSON.parse(headersStr) } catch { /* ignore invalid JSON headers */ }
    }

    const transport = targetUrl.protocol === 'https:' ? https : http
    const proxyReq = transport.request(targetUrl, {
      method: 'GET',
      headers: { ...headers, host: targetUrl.host },
    }, (proxyRes) => {
      const contentType = proxyRes.headers['content-type'] || ''
      const isM3u8 = contentType.includes('mpegurl') || targetUrl.pathname.endsWith('.m3u8')

      if (isM3u8) {
        delete proxyRes.headers['content-length']
        res.writeHead(proxyRes.statusCode, proxyRes.headers)
        let body = ''
        proxyRes.on('data', chunk => body += chunk.toString())
        proxyRes.on('end', () => {
          const rewriteUri = (uri) => {
            try {
              const absoluteUrl = new URL(uri, targetUrl).toString()
              return `http://127.0.0.1:${proxyPort}/?url=${encodeURIComponent(absoluteUrl)}&headers=${encodeURIComponent(headersStr || '{}')}`
            } catch { return uri }
          }
          const rewritten = body.split('\n').map(line => {
            line = line.trim()
            if (!line) return line
            if (line.startsWith('#')) {
              return line.replace(/URI="([^"]+)"/g, (match, uri) => `URI="${rewriteUri(uri)}"`)
            }
            return rewriteUri(line)
          }).join('\n')
          res.end(rewritten)
        })
      } else {
        res.writeHead(proxyRes.statusCode, proxyRes.headers)
        proxyRes.pipe(res, { end: true })
      }
    })

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502)
        res.end(err.message)
      }
    })
    req.pipe(proxyReq, { end: true })
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500)
      res.end(err.message)
    }
  }
})

proxyServer.listen(0, '127.0.0.1', () => {
  proxyPort = proxyServer.address().port
})

service.register('getProxyPort', (message) => {
  message.respond({ returnValue: true, port: proxyPort })
})
service.register('fetch', (message) => {
  const headers = message.payload.headers && typeof message.payload.headers === 'object' ? message.payload.headers : {}
  let completed = false

  const respond = (payload) => {
    if (completed) return
    completed = true
    message.respond(payload)
  }

  const fetchUrl = (url, redirectsRemaining) => {
    let target
    try {
      target = new URL(String(url || ''))
    } catch {
      respond({ returnValue: false, errorText: 'Invalid URL.' })
      return
    }
    if (!ALLOWED_PROTOCOLS.has(target.protocol)) {
      respond({ returnValue: false, errorText: 'Only HTTP and HTTPS are supported.' })
      return
    }

    const transport = target.protocol === 'https:' ? https : http
    const request = transport.request(target, { method: 'GET', headers, timeout: 12000 }, (response) => {
      const location = response.headers.location
      if (location && [301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume()
        if (redirectsRemaining === 0) {
          respond({ returnValue: false, errorText: 'Too many provider redirects.' })
          return
        }
        fetchUrl(new URL(location, target).toString(), redirectsRemaining - 1)
        return
      }

      const chunks = []
      let bytes = 0
      response.on('data', (chunk) => {
        bytes += chunk.length
        if (bytes > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('Response exceeds the 12 MiB service limit.'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        if (completed) return
        const responseHeaders = {}
        for (const [name, value] of Object.entries(response.headers)) responseHeaders[name] = Array.isArray(value) ? value.join(', ') : String(value || '')
        respond({ returnValue: true, status: response.statusCode || 0, headers: responseHeaders, bodyBase64: Buffer.concat(chunks).toString('base64') })
      })
    })
    request.on('timeout', () => request.destroy(new Error('Network request timed out.')))
    request.on('error', (error) => respond({ returnValue: false, errorText: error.message }))
    request.end()
  }

  fetchUrl(message.payload.url, MAX_REDIRECTS)
})
