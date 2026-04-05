#!/usr/bin/env node

import { createServer } from 'node:http'
import process from 'node:process'

const host = process.env.ROACHNET_COMPANION_HOST?.trim() || '0.0.0.0'
const port = Number(process.env.ROACHNET_COMPANION_PORT || '38111')
const token = process.env.ROACHNET_COMPANION_TOKEN?.trim() || ''
const targetOrigin = process.env.ROACHNET_COMPANION_TARGET_URL?.trim() || 'http://127.0.0.1:8080'

function writeJson(response, statusCode, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-RoachNet-Companion-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(body)
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []

    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

function extractToken(request) {
  const authorization = request.headers.authorization?.trim()
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim()
  }

  const headerToken = request.headers['x-roachnet-companion-token']
  if (Array.isArray(headerToken)) {
    return headerToken[0]?.trim() || ''
  }

  return headerToken?.trim() || ''
}

function isAuthorized(request) {
  if (!token) {
    return false
  }

  return extractToken(request) === token
}

async function proxyRequest(request, response, pathname) {
  const upstreamUrl = new URL(pathname, targetOrigin)
  const method = request.method || 'GET'
  const bodyBuffer = method === 'GET' || method === 'HEAD' ? null : await readBody(request)

  const upstreamResponse = await fetch(upstreamUrl, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': request.headers['content-type'] || 'application/json',
    },
    body: bodyBuffer && bodyBuffer.length > 0 ? bodyBuffer : undefined,
  })

  const payload = Buffer.from(await upstreamResponse.arrayBuffer())

  response.writeHead(upstreamResponse.status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-RoachNet-Companion-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8',
  })
  response.end(payload)
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://roachnet-companion.local')
  const pathname = url.pathname

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-RoachNet-Companion-Token',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Cache-Control': 'no-store',
    })
    response.end()
    return
  }

  if (pathname === '/health') {
    writeJson(response, 200, {
      status: 'ok',
      targetOrigin,
      tokenConfigured: Boolean(token),
    })
    return
  }

  if (!pathname.startsWith('/api/companion')) {
    writeJson(response, 404, {
      error: 'Not found',
    })
    return
  }

  if (!isAuthorized(request)) {
    writeJson(response, 401, {
      error: 'Invalid or missing companion token',
    })
    return
  }

  try {
    await proxyRequest(request, response, `${pathname}${url.search}`)
  } catch (error) {
    writeJson(response, 502, {
      error: error instanceof Error ? error.message : 'Failed to proxy companion request',
    })
  }
})

server.listen(port, host, () => {
  console.log(`RoachNet companion server listening on http://${host}:${port}`)
})

function shutdown() {
  server.close(() => {
    process.exit(0)
  })
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
