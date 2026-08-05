const client = require('prom-client');
const { pool } = require('./db');

const register = new client.Registry();

client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Nombre total de requetes HTTP servies',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duree des requetes HTTP en secondes',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

const tasksCreatedTotal = new client.Counter({
  name: 'tasks_created_total',
  help: 'Nombre total de taches creees depuis le demarrage',
  registers: [register],
});

const tasksInDatabase = new client.Gauge({
  name: 'tasks_in_database',
  help: 'Nombre de taches actuellement en base',
  registers: [register],
  async collect() {
    try {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM tasks');
      this.set(rows[0].count);
    } catch (err) {
      this.set(0);
    }
  },
});

function getRouteLabel(req) {
  if (!req.route) return 'unmatched';
  if (!req.baseUrl) return req.route.path;
  if (req.route.path === '/') return req.baseUrl;
  return `${req.baseUrl}${req.route.path}`;
}

function metricsMiddleware(req, res, next) {
  const endTimer = httpRequestDurationSeconds.startTimer();

  res.on('finish', () => {
    const labels = {
      method: req.method,
      route: getRouteLabel(req),
      status: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels);
    endTimer(labels);

    if (labels.method === 'POST' && labels.route === '/api/tasks' && labels.status === '201') {
      tasksCreatedTotal.inc();
    }
  });

  next();
}

async function metricsHandler(req, res, next) {
  try {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
  } catch (err) {
    next(err);
  }
}

module.exports = {
  metricsMiddleware,
  metricsHandler,
  register,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  tasksCreatedTotal,
  tasksInDatabase,
};
