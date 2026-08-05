require('dotenv').config();
const express = require('express');
const cors = require('cors');
const taskRoutes = require('./routes/tasks');
const errorHandler = require('./middleware/errorHandler');
const { ready } = require('./db');
const { metricsMiddleware, metricsHandler } = require('./metrics');

const app = express();

app.use(cors());
app.use(express.json());
app.use(metricsMiddleware);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

app.get('/metrics', metricsHandler);

app.use('/api/tasks', async (req, res, next) => {
  try {
    await ready;
    next();
  } catch (err) {
    next(err);
  }
}, taskRoutes);

app.use(errorHandler);

const port = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(port, () => console.log(`app listening on http://localhost:${port}`));
}

module.exports = app;
