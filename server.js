
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ==========================================
// SERVER CONFIGURATION
// ==========================================

const PORT = Number(process.env.PORT) || 5002;
const HOST = '0.0.0.0';

const PUBLIC = path.join(__dirname, 'PUBLIC');

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const SETTINGS_FILE =
  process.env.RISK_SETTINGS_FILE ||
  path.join(__dirname, 'data', 'risk-settings.json');

// Require a strong administrator password.
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 16) {
  throw new Error(
    'ADMIN_PASSWORD must be set and contain at least 16 characters.'
  );
}

// ==========================================
// DISTRICT INFORMATION
// ==========================================

const districts = [
  {
    id: 'bilaspur',
    name: 'Bilaspur',
    region: 'Central Himachal',
    lat: 31.34,
    lon: 76.76,
    slope: 32
  },
  {
    id: 'chamba',
    name: 'Chamba',
    region: 'Western Himachal',
    lat: 32.55,
    lon: 76.13,
    slope: 48
  },
  {
    id: 'hamirpur',
    name: 'Hamirpur',
    region: 'Central Himachal',
    lat: 31.69,
    lon: 76.52,
    slope: 28
  },
  {
    id: 'kangra',
    name: 'Kangra',
    region: 'Western Himachal',
    lat: 32.10,
    lon: 76.27,
    slope: 42
  },
  {
    id: 'kinnaur',
    name: 'Kinnaur',
    region: 'Eastern Himachal',
    lat: 31.54,
    lon: 78.27,
    slope: 65
  },
  {
    id: 'kullu',
    name: 'Kullu',
    region: 'Central Himachal',
    lat: 31.96,
    lon: 77.11,
    slope: 58
  },
  {
    id: 'lahaul-spiti',
    name: 'Lahaul and Spiti',
    region: 'Northern Himachal',
    lat: 32.57,
    lon: 77.03,
    slope: 62
  },
  {
    id: 'mandi',
    name: 'Mandi',
    region: 'Central Himachal',
    lat: 31.71,
    lon: 76.93,
    slope: 38
  },
  {
    id: 'shimla',
    name: 'Shimla',
    region: 'Southern Himachal',
    lat: 31.10,
    lon: 77.17,
    slope: 52
  },
  {
    id: 'sirmaur',
    name: 'Sirmaur',
    region: 'Southern Himachal',
    lat: 30.56,
    lon: 77.30,
    slope: 44
  },
  {
    id: 'solan',
    name: 'Solan',
    region: 'Southern Himachal',
    lat: 30.91,
    lon: 77.10,
    slope: 35
  },
  {
    id: 'una',
    name: 'Una',
    region: 'Western Himachal',
    lat: 31.47,
    lon: 76.27,
    slope: 20
  }
];

// ==========================================
// RISK SETTINGS
// ==========================================

const defaultWeights = {
  rain: 40,
  soil: 20,
  stream: 25,
  slope: 15
};

let weights = { ...defaultWeights };

// ==========================================
// ADMINISTRATOR SESSIONS
// ==========================================

const sessions = new Map();
const loginAttempts = new Map();

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// ==========================================
// RISK WEIGHT VALIDATION
// ==========================================

function validateWeights(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid risk settings.');
  }

  const keys = ['rain', 'soil', 'stream', 'slope'];

  let total = 0;
  const result = {};

  for (const key of keys) {
    const number = Number(value[key]);

    if (
      !Number.isInteger(number) ||
      number < 0 ||
      number > 100
    ) {
      throw new Error(
        `${key} weight must be a whole number between 0 and 100.`
      );
    }

    result[key] = number;
    total += number;
  }

  if (total !== 100) {
    throw new Error(
      'All risk weights must total exactly 100%.'
    );
  }

  return result;
}

// ==========================================
// LOAD AND SAVE SETTINGS
// ==========================================

function loadSettings() {
  try {
    const saved = JSON.parse(
      fs.readFileSync(SETTINGS_FILE, 'utf8')
    );

    weights = validateWeights(saved);

    console.log('Saved risk settings loaded.');

  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(
        'Settings loading failed:',
        error.message
      );
    }

    weights = { ...defaultWeights };

    saveSettings();
  }
}

function saveSettings() {
  const directory = path.dirname(SETTINGS_FILE);

  fs.mkdirSync(directory, {
    recursive: true
  });

  const temporaryFile = SETTINGS_FILE + '.tmp';

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(weights, null, 2),
    { mode: 0o600 }
  );

  fs.renameSync(temporaryFile, SETTINGS_FILE);
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function safeEqual(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));

  return (
    first.length === second.length &&
    crypto.timingSafeEqual(first, second)
  );
}

function getClientIP(req) {
  // Use the direct socket address rather than trusting
  // arbitrary client-supplied forwarded IP headers.
  return req.socket.remoteAddress || 'unknown';
}

// ==========================================
// SIMULATED READING GENERATOR
// ==========================================

function getReading(place) {
  const bucket = Math.floor(
    Date.now() / REFRESH_INTERVAL_MS
  );

  const seed = districts.indexOf(place) + 1;

  function wave(offset) {
    return (
      Math.sin(
        bucket * 0.73 + seed * 1.37 + offset
      ) + 1
    ) / 2;
  }

  const rain = Number(
    (12 + wave(1) * 115).toFixed(1)
  );

  const soil = Number(
    (35 + wave(2) * 50).toFixed(1)
  );

  const stream = Number(
    (0.7 + wave(3) * 3.6).toFixed(2)
  );

  const slope = place.slope;

  // Server-controlled risk calculation.
  const score = Math.round(
    (
      clamp(rain / 150, 0, 1) * weights.rain +
      clamp(soil / 100, 0, 1) * weights.soil +
      clamp(stream / 5, 0, 1) * weights.stream +
      clamp(slope / 90, 0, 1) * weights.slope
    )
  );

  const level =
    score >= 70
      ? 'High'
      : score >= 40
        ? 'Moderate'
        : 'Low';

  return {
    id: place.id,
    name: place.name,
    region: place.region,

    lat: place.lat,
    lon: place.lon,

    rain,
    soil,
    stream,
    slope,

    score,
    level,

    updatedAt: new Date(
      bucket * REFRESH_INTERVAL_MS
    ).toISOString()
  };
}

// ==========================================
// HTTP RESPONSE
// ==========================================

function send(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });

  res.end(JSON.stringify(data));
}

// ==========================================
// READ REQUEST BODY
// ==========================================

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;

      if (body.length > 10000) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Invalid JSON request.'));
      }
    });

    req.on('error', reject);
  });
}

// ==========================================
// COOKIE MANAGEMENT
// ==========================================

function cookies(req) {
  const result = {};

  (req.headers.cookie || '').split(';').forEach(item => {
    const index = item.indexOf('=');

    if (index > 0) {
      const key = item.slice(0, index).trim();
      const value = item.slice(index + 1).trim();

      try {
        result[key] = decodeURIComponent(value);
      } catch {
        result[key] = '';
      }
    }
  });

  return result;
}

function isHTTPS(req) {
  const forwarded = req.headers['x-forwarded-proto'];

  const protocol = forwarded
    ? forwarded.split(',')[0].trim().toLowerCase()
    : req.socket.encrypted
      ? 'https'
      : 'http';

  return protocol === 'https';
}

function sessionCookie(req, token) {
  return (
    `hw_session=${encodeURIComponent(token)}; ` +
    'HttpOnly; ' +
    (isHTTPS(req) ? 'Secure; ' : '') +
    'SameSite=Strict; ' +
    'Path=/; ' +
    `Max-Age=${SESSION_DURATION_MS / 1000}`
  );
}

function clearSessionCookie(req) {
  return (
    'hw_session=; HttpOnly; ' +
    (isHTTPS(req) ? 'Secure; ' : '') +
    'SameSite=Strict; Path=/; Max-Age=0'
  );
}

// ==========================================
// ORIGIN PROTECTION
// ==========================================

function checkOrigin(req) {
  const origin = req.headers.origin;

  if (!origin) {
    return false;
  }

  try {
    const protocol = isHTTPS(req) ? 'https' : 'http';

    const expectedOrigin =
      `${protocol}://${req.headers.host}`;

    return new URL(origin).origin === expectedOrigin;

  } catch {
    return false;
  }
}

// ==========================================
// SESSION AUTHENTICATION
// ==========================================

function getSession(req) {
  const token = cookies(req).hw_session;

  if (!token) return null;

  const session = sessions.get(token);

  if (!session) return null;

  if (session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }

  return {
    token,
    ...session
  };
}

function requireAdmin(req, res) {
  const session = getSession(req);

  if (!session) {
    send(res, 401, {
      error: 'Administrator login required.'
    });

    return null;
  }

  return session;
}

function requireCSRF(req, res, session, body) {
  const headerToken = req.headers['x-csrf-token'];
  const bodyToken = body.csrf;

  if (
    !headerToken ||
    !bodyToken ||
    !safeEqual(headerToken, session.csrf) ||
    !safeEqual(bodyToken, session.csrf)
  ) {
    send(res, 403, {
      error: 'Security verification failed.'
    });

    return false;
  }

  return true;
}

// ==========================================
// LOGIN RATE LIMITING
// ==========================================

function canAttemptLogin(ip) {
  const now = Date.now();

  let record = loginAttempts.get(ip);

  if (!record || now - record.started > LOGIN_WINDOW_MS) {
    record = {
      count: 0,
      started: now
    };
  }

  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    loginAttempts.set(ip, record);
    return false;
  }

  record.count++;
  loginAttempts.set(ip, record);

  return true;
}

// ==========================================
// STATIC FILE SERVER
// ==========================================

function serveFile(res, filePath) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  fs.readFile(filePath, (error, content) => {
    if (error) {
      send(res, 404, {
        error: 'File not found.'
      });

      return;
    }

    res.writeHead(200, {
      'Content-Type':
        types[path.extname(filePath)] ||
        'application/octet-stream',

      'Cache-Control': 'no-cache',

      'X-Content-Type-Options': 'nosniff',

      'Content-Security-Policy':
        "default-src 'self'; " +
        "script-src 'self' https://unpkg.com; " +
        "style-src 'self' 'unsafe-inline' https://unpkg.com; " +
        "img-src 'self' data: blob: https:; " +
        "connect-src 'self'; " +
        "font-src 'self' https://unpkg.com; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "frame-ancestors 'none'"
    });

    res.end(content);
  });
}

function publicPath(urlPath) {
  let decoded;

  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }

  const relative =
    decoded === '/' ? 'index.html' : decoded.slice(1);

  const resolved = path.resolve(PUBLIC, relative);

  if (
    resolved !== PUBLIC &&
    !resolved.startsWith(PUBLIC + path.sep)
  ) {
    return null;
  }

  return resolved;
}

// ==========================================
// LOAD SETTINGS BEFORE STARTING
// ==========================================

loadSettings();

// ==========================================
// MAIN SERVER
// ==========================================

const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  const route = url.pathname;

  try {

    // --------------------------------------
    // PUBLIC DISTRICT API
    // --------------------------------------

    if (
      route === '/api/districts' &&
      req.method === 'GET'
    ) {
      return send(res, 200, districts);
    }

    // --------------------------------------
    // PUBLIC RISK CONFIGURATION
    // --------------------------------------

    if (
      route === '/api/config' &&
      req.method === 'GET'
    ) {
      return send(res, 200, {
        weights
      });
    }

    // --------------------------------------
    // PUBLIC LIVE READINGS
    // --------------------------------------

    if (
      route === '/api/live' &&
      req.method === 'GET'
    ) {
      const place = districts.find(
        d => d.id === url.searchParams.get('district')
      );

      if (!place) {
        return send(res, 404, {
          error: 'District not found.'
        });
      }

      return send(res, 200, getReading(place));
    }

    // --------------------------------------
    // ADMIN LOGIN
    // --------------------------------------

    if (
      route === '/api/admin/login' &&
      req.method === 'POST'
    ) {
      if (!checkOrigin(req)) {
        return send(res, 403, {
          error: 'Invalid request origin.'
        });
      }

      const ip = getClientIP(req);

      if (!canAttemptLogin(ip)) {
        return send(res, 429, {
          error: 'Too many login attempts. Try again later.'
        });
      }

      const body = await readBody(req);

      if (
        typeof body.password !== 'string' ||
        !safeEqual(body.password, ADMIN_PASSWORD)
      ) {
        return send(res, 401, {
          error: 'Incorrect administrator password.'
        });
      }

      // Remove old sessions for this administrator.
      sessions.clear();

      const token = randomToken();
      const csrf = randomToken();

      sessions.set(token, {
        csrf,
        expires: Date.now() + SESSION_DURATION_MS
      });

      // Clear failed attempts after successful login.
      loginAttempts.delete(ip);

      return send(
        res,
        200,
        {
          success: true,
          csrf
        },
        {
          'Set-Cookie': sessionCookie(req, token)
        }
      );
    }

    // --------------------------------------
    // CHECK ADMIN LOGIN
    // --------------------------------------

    if (
      route === '/api/admin/me' &&
      req.method === 'GET'
    ) {
      const session = getSession(req);

      if (!session) {
        return send(res, 401, {
          authenticated: false
        });
      }

      return send(res, 200, {
        authenticated: true,
        csrf: session.csrf,
        weights
      });
    }

    // --------------------------------------
    // UPDATE RISK SETTINGS
    // --------------------------------------

    if (
      route === '/api/admin/settings' &&
      req.method === 'POST'
    ) {
      if (!checkOrigin(req)) {
        return send(res, 403, {
          error: 'Invalid request origin.'
        });
      }

      const session = requireAdmin(req, res);

      if (!session) return;

      const body = await readBody(req);

      if (!requireCSRF(req, res, session, body)) {
        return;
      }

      const nextWeights = validateWeights(body.weights);

      // Update server-side risk settings.
      weights = nextWeights;

      // Save to persistent storage.
      saveSettings();

      console.log('Risk settings updated:', weights);

      return send(res, 200, {
        success: true,
        weights
      });
    }

    // --------------------------------------
    // ADMIN LOGOUT
    // --------------------------------------

    if (
      route === '/api/admin/logout' &&
      req.method === 'POST'
    ) {
      if (!checkOrigin(req)) {
        return send(res, 403, {
          error: 'Invalid request origin.'
        });
      }

      const session = requireAdmin(req, res);

      if (!session) return;

      const body = await readBody(req);

      if (!requireCSRF(req, res, session, body)) {
        return;
      }

      sessions.delete(session.token);

      return send(
        res,
        200,
        {
          success: true
        },
        {
          'Set-Cookie': clearSessionCookie(req)
        }
      );
    }

    // --------------------------------------
    // BLOCK UNKNOWN API REQUESTS
    // --------------------------------------

    if (route.startsWith('/api/')) {
      return send(res, 404, {
        error: 'API endpoint not found.'
      });
    }

    // --------------------------------------
    // STATIC WEBSITE FILES
    // --------------------------------------

    if (
      req.method !== 'GET' &&
      req.method !== 'HEAD'
    ) {
      return send(res, 405, {
        error: 'Method not allowed.'
      });
    }

    if (route === '/admin') {
      return serveFile(
        res,
        path.join(PUBLIC, 'admin.html')
      );
    }

    const filePath = publicPath(route);

    if (!filePath) {
      return send(res, 403, {
        error: 'Forbidden.'
      });
    }

    if (
      !fs.existsSync(filePath) ||
      !fs.statSync(filePath).isFile()
    ) {
      return send(res, 404, {
        error: 'Page not found.'
      });
    }

    if (req.method === 'HEAD') {
      res.writeHead(200);
      return res.end();
    }

    return serveFile(res, filePath);

  } catch (error) {
    console.error('Server error:', error);

    if (!res.headersSent) {
      return send(res, 500, {
        error: 'Internal server error.'
      });
    }

    res.destroy();
  }
});

// ==========================================
// CLEAN EXPIRED SESSIONS
// ==========================================

setInterval(() => {
  const now = Date.now();

  for (const [token, session] of sessions) {
    if (session.expires < now) {
      sessions.delete(token);
    }
  }

  for (const [ip, record] of loginAttempts) {
    if (now - record.started > LOGIN_WINDOW_MS) {
      loginAttempts.delete(ip);
    }
  }

}, 60 * 1000).unref();

// ==========================================
// START SERVER
// ==========================================

server.listen(PORT, HOST, () => {
  console.log('================================');
  console.log('       HILLWATCH SERVER');
  console.log('================================');

  console.log(`Port: ${PORT}`);
  console.log(`Host: ${HOST}`);
  console.log(`Districts: ${districts.length}`);
  console.log('Reading interval: 10 minutes');

  console.log('Administrator authentication: ENABLED');
  console.log('CSRF protection: ENABLED');
  console.log('Risk settings protection: ENABLED');

  console.log('--------------------------------');
  console.log('WEBSITE URLS');
  console.log('--------------------------------');

  console.log(`Public Dashboard: http://localhost:${PORT}`);
  console.log(`Admin Panel:      http://localhost:${PORT}/admin`);

  console.log('================================');
});
