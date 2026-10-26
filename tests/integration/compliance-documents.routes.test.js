jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => Promise.resolve({ _id: id, name: 'Staff', role: 'admin', active: true })),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/services/compliance-document.service', () => ({
  upload: jest.fn(),
  listMine: jest.fn(),
  listForAdmin: jest.fn(),
  getFileForReview: jest.fn(),
  review: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const service = require('../../src/services/compliance-document.service');

const DOC = '507f1f77bcf86cd799439011';
const auth = (role, extra = {}) =>
  `Bearer ${jwt.sign({ sub: 'user1', role, ...extra }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n');

describe('compliance document routes', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  describe('cleaner upload', () => {
    it('hands the raw file to the service', async () => {
      service.upload.mockResolvedValue({ _id: DOC, status: 'pending' });
      const res = await request(app)
        .post('/compliance-documents?type=dbs&filename=cert.pdf')
        .set('Authorization', auth('cleaner'))
        .set('Content-Type', 'application/pdf')
        .send(PDF);
      expect(res.status).toBe(201);
      const args = service.upload.mock.calls[0][0];
      expect(args).toMatchObject({ type: 'dbs', filename: 'cert.pdf' });
      expect(Buffer.isBuffer(args.buffer)).toBe(true);
      expect(args.buffer.equals(PDF)).toBe(true);
    });

    it('does not treat an unaccepted content type as a file', async () => {
      service.upload.mockResolvedValue({});
      await request(app)
        .post('/compliance-documents?type=dbs')
        .set('Authorization', auth('cleaner'))
        .set('Content-Type', 'text/html')
        .send('<script>alert(1)</script>');
      expect(Buffer.isBuffer(service.upload.mock.calls[0][0].buffer)).toBe(false);
    });

    it('rejects a files over 5 MB, an unknown type, other roles and read-only support sessions', async () => {
      const big = await request(app)
        .post('/compliance-documents?type=dbs')
        .set('Authorization', auth('cleaner'))
        .set('Content-Type', 'application/pdf')
        .send(Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]));
      expect(big.status).toBe(413);

      const badType = await request(app)
        .post('/compliance-documents?type=passport')
        .set('Authorization', auth('cleaner'))
        .set('Content-Type', 'application/pdf')
        .send(PDF);
      expect(badType.status).toBe(400);

      const customer = await request(app)
        .post('/compliance-documents?type=dbs')
        .set('Authorization', auth('customer'))
        .set('Content-Type', 'application/pdf')
        .send(PDF);
      expect(customer.status).toBe(403);

      const supportView = await request(app)
        .post('/compliance-documents?type=dbs')
        .set('Authorization', auth('cleaner', { imp: 'admin1' }))
        .set('Content-Type', 'application/pdf')
        .send(PDF);
      expect(supportView.status).toBe(403);
      expect(service.upload).not.toHaveBeenCalled();
    });

    it('lists only the signed-in cleaner’s own documents', async () => {
      service.listMine.mockResolvedValue([{ _id: DOC }]);
      const res = await request(app).get('/compliance-documents/mine').set('Authorization', auth('cleaner'));
      expect(res.status).toBe(200);
      const other = await request(app).get('/compliance-documents/mine').set('Authorization', auth('customer'));
      expect(other.status).toBe(403);
    });
  });

  describe('admin review', () => {
    it('lists documents for admins only', async () => {
      service.listForAdmin.mockResolvedValue([]);
      const res = await request(app).get('/admin/compliance-documents?status=pending').set('Authorization', auth('admin'));
      expect(res.status).toBe(200);
      expect(service.listForAdmin).toHaveBeenCalledWith({ status: 'pending' });
      const operator = await request(app).get('/admin/compliance-documents').set('Authorization', auth('operator'));
      expect(operator.status).toBe(403);
    });

    it('serves a file with safe headers, and is closed to non-admins', async () => {
      service.getFileForReview.mockResolvedValue({
        doc: { originalName: 'my "cert".pdf' },
        file: { mimeType: 'application/pdf', data: PDF },
      });
      const res = await request(app).get(`/admin/compliance-documents/${DOC}/file`).set('Authorization', auth('admin'));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/pdf/);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).not.toMatch(/"cert"/);
      const cleaner = await request(app).get(`/admin/compliance-documents/${DOC}/file`).set('Authorization', auth('cleaner'));
      expect(cleaner.status).toBe(403);
    });

    it('passes a decision to the service and validates it', async () => {
      service.review.mockResolvedValue({ _id: DOC, status: 'approved' });
      const ok = await request(app)
        .post(`/admin/compliance-documents/${DOC}/review`)
        .set('Authorization', auth('admin'))
        .send({ decision: 'approve', expiresAt: '2030-01-01' });
      expect(ok.status).toBe(200);
      expect(service.review).toHaveBeenCalledWith(DOC, { decision: 'approve', expiresAt: '2030-01-01' }, expect.anything());

      const bad = await request(app)
        .post(`/admin/compliance-documents/${DOC}/review`)
        .set('Authorization', auth('admin'))
        .send({ decision: 'maybe' });
      expect(bad.status).toBe(400);
      const operator = await request(app)
        .post(`/admin/compliance-documents/${DOC}/review`)
        .set('Authorization', auth('operator'))
        .send({ decision: 'approve' });
      expect(operator.status).toBe(403);
    });
  });
});
