const request = require('supertest');
const app = require('../../app');
const { pool, ready } = require('../../db');

function readMetricValue(metrics, metricName, labels = {}) {
  const labelFilter = Object.entries(labels)
    .map(([key, value]) => `${key}="${value}"`)
    .join(',');
  const matcher = new RegExp(`^${metricName}(?:\\{([^}]*)\\})?\\s+([0-9.e+-]+)$`, 'm');
  const lines = metrics.split('\n');

  for (const line of lines) {
    const match = line.match(matcher);
    if (!match) continue;
    const labelText = match[1] || '';
    if (!labelFilter || labelFilter.split(',').every((label) => labelText.includes(label))) {
      return Number(match[2]);
    }
  }

  return 0;
}

describe('Todo API integration tests', () => {
  beforeAll(async () => {
    await ready;
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM tasks');
  });

  afterAll(async () => {
    await pool.end();
  });

  test('creates a task and reads it by id', async () => {
    const createResponse = await request(app)
      .post('/api/tasks')
      .send({ description: 'write integration tests' })
      .expect(201);

    expect(createResponse.body).toMatchObject({
      description: 'write integration tests',
      status: 'pending',
    });
    expect(createResponse.body.id).toBeDefined();

    const readResponse = await request(app)
      .get(`/api/tasks/${createResponse.body.id}`)
      .expect(200);

    expect(readResponse.body).toMatchObject({
      id: createResponse.body.id,
      description: 'write integration tests',
      status: 'pending',
    });
  });

  test('returns 404 for an unknown task', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000000';

    const response = await request(app)
      .get(`/api/tasks/${unknownId}`)
      .expect(404);

    expect(response.body).toEqual({ error: 'Task not found' });
  });

  test('rejects invalid request bodies', async () => {
    await request(app)
      .post('/api/tasks')
      .send({})
      .expect(400)
      .expect(({ body }) => {
        expect(body).toEqual({ error: 'description is required' });
      });

    await request(app)
      .post('/api/tasks')
      .send({ description: 'x'.repeat(1001) })
      .expect(400)
      .expect(({ body }) => {
        expect(body.error).toBe('description must be at most 1000 characters');
      });
  });

  test('deletes a task and removes it from the list', async () => {
    const createResponse = await request(app)
      .post('/api/tasks')
      .send({ description: 'delete me' })
      .expect(201);

    await request(app)
      .delete(`/api/tasks/${createResponse.body.id}`)
      .expect(204);

    await request(app)
      .get(`/api/tasks/${createResponse.body.id}`)
      .expect(404);

    const listResponse = await request(app)
      .get('/api/tasks')
      .expect(200);

    expect(listResponse.body).toEqual([]);
  });

  test('exposes HTTP and task metrics in Prometheus format', async () => {
    const beforeMetrics = await request(app)
      .get('/metrics')
      .expect(200)
      .expect('Content-Type', /text\/plain/);

    const beforeGetTasks = readMetricValue(beforeMetrics.text, 'http_requests_total', {
      method: 'GET',
      route: '/api/tasks',
      status: '200',
    });
    const beforeCreated = readMetricValue(beforeMetrics.text, 'tasks_created_total');

    await request(app).get('/api/tasks').expect(200);
    await request(app).get('/api/tasks').expect(200);
    await request(app).get('/api/tasks').expect(200);
    await request(app).post('/api/tasks').send({ description: 'metric task' }).expect(201);

    const afterMetrics = await request(app)
      .get('/metrics')
      .expect(200);

    const afterGetTasks = readMetricValue(afterMetrics.text, 'http_requests_total', {
      method: 'GET',
      route: '/api/tasks',
      status: '200',
    });
    const afterCreated = readMetricValue(afterMetrics.text, 'tasks_created_total');

    expect(afterGetTasks - beforeGetTasks).toBe(3);
    expect(afterCreated - beforeCreated).toBe(1);
    expect(afterMetrics.text).toContain('http_request_duration_seconds_bucket');
    expect(afterMetrics.text).toContain('tasks_in_database');
  });

  test('counts unknown routes without using ids as metric labels', async () => {
    await request(app).get('/missing-route').expect(404);

    const response = await request(app).get('/metrics').expect(200);

    expect(response.text).toContain('http_requests_total{method="GET",route="unmatched",status="404"}');
    expect(response.text).not.toContain('/api/tasks/00000000-0000-0000-0000-000000000000');
  });
});
