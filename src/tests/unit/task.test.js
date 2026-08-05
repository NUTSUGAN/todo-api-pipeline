jest.mock('../../db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

const { pool } = require('../../db');
const Task = require('../../models/task');

describe('Task model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates a task with a parameterized query', async () => {
    const row = { id: 'task-id', description: 'ship tests', status: 'pending' };
    pool.query.mockResolvedValue({ rows: [row] });

    const result = await Task.create('ship tests');

    expect(pool.query).toHaveBeenCalledWith(
      'INSERT INTO tasks (description) VALUES ($1) RETURNING *',
      ['ship tests']
    );
    expect(result).toBe(row);
  });

  test('keeps existing fields when updating partially', async () => {
    const existing = { id: 'task-id', description: 'old', status: 'pending' };
    const updated = { id: 'task-id', description: 'new', status: 'pending' };

    pool.query
      .mockResolvedValueOnce({ rows: [existing] })
      .mockResolvedValueOnce({ rows: [updated] });

    const result = await Task.update('task-id', { description: 'new' });

    expect(pool.query).toHaveBeenLastCalledWith(
      'UPDATE tasks SET description = $1, status = $2, updated_at = now() WHERE id = $3 RETURNING *',
      ['new', 'pending', 'task-id']
    );
    expect(result).toBe(updated);
  });

  test('returns null when updating an unknown task', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const result = await Task.update('missing-id', { description: 'new' });

    expect(result).toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
