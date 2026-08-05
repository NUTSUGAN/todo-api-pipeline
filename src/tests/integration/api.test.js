const request = require('supertest');
const app = require('../../app');
const { pool, ready } = require('../../db');

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
});
