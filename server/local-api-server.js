/**
 * Local API Server
 * Wraps the Lambda handler in an Express server for local development
 */

const express = require('express');
const cors = require('cors');
const { loadLocalEnv } = require('../local-env-loader');

// Load local environment variables
if (process.env.IS_OFFLINE === 'true' || process.env.STAGE === 'local' || !process.env.STAGE) {
  console.log('🔧 Loading local environment for API server...');
  loadLocalEnv();
  process.env.STAGE = process.env.STAGE || 'local';
  process.env.IS_OFFLINE = 'true';
}

// Import Lambda handler
const lambdaHandler = require('../api/api').handler;

const app = express();
const PORT = process.env.API_PORT || 3001;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Accept', 'Origin'],
  credentials: false
}));

// Handle JSON and URL-encoded bodies
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Handle raw body for multipart/form-data (Lambda handler parses it manually)
app.use((req, res, next) => {
  if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
    express.raw({ type: '*/*', limit: '50mb' })(req, res, next);
  } else {
    next();
  }
});

// Convert Express request to Lambda event format
function expressToLambdaEvent(req) {
  const protocol = req.protocol || 'http';
  const host = req.get('host') || 'localhost:3001';
  const baseUrl = `${protocol}://${host}`;
  const path = req.path || req.url.split('?')[0];
  
  // Remove /api prefix if present
  let proxyPath = path.startsWith('/api') ? path.substring(4) : path;
  if (!proxyPath.startsWith('/')) {
    proxyPath = '/' + proxyPath;
  }

  // Build query string
  const queryString = Object.keys(req.query || {})
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(req.query[key])}`)
    .join('&');

  const event = {
    version: '2.0',
    routeKey: `${req.method} ${path}`,
    rawPath: path,
    rawQueryString: queryString,
    headers: {
      ...req.headers,
      'content-type': req.headers['content-type'] || 'application/json',
    },
    requestContext: {
      accountId: '123456789012',
      apiId: 'local-api',
      domainName: host,
      domainPrefix: 'local',
      http: {
        method: req.method,
        path: path,
        protocol: 'HTTP/1.1',
        sourceIp: req.ip || req.connection.remoteAddress || '127.0.0.1',
        userAgent: req.get('user-agent') || '',
      },
      requestId: `local-${Date.now()}`,
      routeKey: `${req.method} ${path}`,
      stage: 'local',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    body: req.body ? (
      Buffer.isBuffer(req.body) ? req.body.toString('binary') :
      typeof req.body === 'string' ? req.body :
      JSON.stringify(req.body)
    ) : null,
    isBase64Encoded: false,
    pathParameters: {
      proxy: proxyPath.substring(1), // Remove leading slash
    },
    queryStringParameters: req.query && Object.keys(req.query).length > 0 ? req.query : null,
    httpMethod: req.method,
    path: proxyPath,
    rawUrl: `${baseUrl}${path}${queryString ? '?' + queryString : ''}`,
  };

  return event;
}

// Convert Lambda response to Express response
function lambdaToExpressResponse(lambdaResponse, res) {
  const statusCode = lambdaResponse.statusCode || 200;
  const headers = lambdaResponse.headers || {};
  const body = lambdaResponse.body || '';

  // Set headers
  Object.keys(headers).forEach(key => {
    res.setHeader(key, headers[key]);
  });

  // Set CORS headers if not already set
  if (!headers['Access-Control-Allow-Origin']) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.status(statusCode).send(body);
}

// Lambda context mock
const mockContext = {
  awsRequestId: `local-${Date.now()}`,
  functionName: 'masky-api-local',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:masky-api-local',
  memoryLimitInMB: '512',
  getRemainingTimeInMillis: () => 30000,
};

// API routes - catch all /api/*
app.all('/api/*', async (req, res) => {
  try {
    const event = expressToLambdaEvent(req);
    
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    
    const lambdaResponse = await lambdaHandler(event, mockContext);
    lambdaToExpressResponse(lambdaResponse, res);
  } catch (error) {
    console.error('Error handling request:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'masky-api-local' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Local API server running on http://localhost:${PORT}`);
  console.log(`   API endpoint: http://localhost:${PORT}/api`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
});

