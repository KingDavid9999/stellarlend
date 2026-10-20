import express from 'express';
import request from 'supertest';
import { config } from '../config';
import { errorHandler } from '../middleware/errorHandler';
import v1Routes from '../routes/v1';
import { assetMetadataService } from '../services/assetMetadata.service';
import { readCacheService } from '../services/readCache.service';
import { redisCacheService } from '../services/redisCache.service';

// Mounts the real v1 router and error handler without the full app, so these
// tests exercise the production route wiring, cache middleware and error envelope.
const app = express();
app.use(express.json());
app.use('/api/v1', v1Routes);
app.use(errorHandler);

describe('AssetMetadataService', () => {
  it('lists assets with complete metadata and unique symbols', () => {
    const assets = assetMetadataService.listAssets();

    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      expect(asset).toEqual({
        symbol: expect.any(String),
        name: expect.any(String),
        category: expect.stringMatching(/^(native|stablecoin|crypto|defi)$/),
        decimals: expect.any(Number),
        isNative: expect.any(Boolean),
      });
      expect(asset.symbol).not.toBe('');
      expect(asset.name).not.toBe('');
      expect(Number.isInteger(asset.decimals)).toBe(true);
    }

    const symbols = assets.map((a) => a.symbol.toUpperCase());
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('marks exactly one asset as native, and it is XLM', () => {
    const natives = assetMetadataService.listAssets().filter((a) => a.isNative);
    expect(natives.map((a) => a.symbol)).toEqual(['XLM']);
  });

  it('looks assets up case-insensitively and trims whitespace', () => {
    expect(assetMetadataService.getAsset('usdc')?.symbol).toBe('USDC');
    expect(assetMetadataService.getAsset('YXLM')?.symbol).toBe('yXLM');
    expect(assetMetadataService.getAsset('  xlm ')?.symbol).toBe('XLM');
  });

  it('returns undefined for unknown or empty symbols', () => {
    expect(assetMetadataService.getAsset('NOPE')).toBeUndefined();
    expect(assetMetadataService.getAsset('')).toBeUndefined();
  });

  it('returns copies so callers cannot mutate the registry', () => {
    const [first] = assetMetadataService.listAssets();
    first!.name = 'tampered';
    const lookedUp = assetMetadataService.getAsset('XLM')!;
    lookedUp.decimals = 99;

    expect(assetMetadataService.listAssets()[0]!.name).not.toBe('tampered');
    expect(assetMetadataService.getAsset('XLM')!.decimals).not.toBe(99);
  });
});

describe('GET /api/v1/assets', () => {
  const originalReadCache = { ...config.readCache };

  beforeEach(() => {
    Object.assign(config.readCache, { enabled: true });
    redisCacheService.clearAllForTests();
    readCacheService.resetForTests();
  });

  afterEach(() => {
    Object.assign(config.readCache, originalReadCache);
  });

  it('returns every supported asset with its metadata', async () => {
    const res = await request(app).get('/api/v1/assets');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(assetMetadataService.listAssets());
    expect(res.body.data.map((a: { symbol: string }) => a.symbol)).toEqual(
      expect.arrayContaining(['XLM', 'USDC'])
    );
  });

  it('is cached: second request is a HIT with an identical body', async () => {
    const miss = await request(app).get('/api/v1/assets');
    const hit = await request(app).get('/api/v1/assets');

    expect(miss.headers['x-cache']).toBe('MISS');
    expect(hit.headers['x-cache']).toBe('HIT');
    expect(hit.status).toBe(200);
    expect(hit.body).toEqual(miss.body);
  });

  it('advertises the configured TTL via Cache-Control on both MISS and HIT', async () => {
    const expected = `public, max-age=${Math.floor(config.cache.assetMetadataTtlMs / 1000)}`;

    const miss = await request(app).get('/api/v1/assets');
    const hit = await request(app).get('/api/v1/assets');

    expect(miss.headers['cache-control']).toBe(expected);
    expect(hit.headers['cache-control']).toBe(expected);
  });

  it('bypasses the cache when the client sends Cache-Control: no-cache', async () => {
    await request(app).get('/api/v1/assets');
    const res = await request(app).get('/api/v1/assets').set('Cache-Control', 'no-cache');

    expect(res.status).toBe(200);
    expect(res.headers['x-cache']).toBe('BYPASS');
  });

  it('still serves correct data when the read cache is disabled', async () => {
    Object.assign(config.readCache, { enabled: false });

    const res = await request(app).get('/api/v1/assets');

    expect(res.status).toBe(200);
    expect(res.headers['x-cache']).toBeUndefined();
    expect(res.body.data).toEqual(assetMetadataService.listAssets());
  });
});

describe('GET /api/v1/assets/:symbol', () => {
  beforeEach(() => {
    Object.assign(config.readCache, { enabled: true });
    redisCacheService.clearAllForTests();
    readCacheService.resetForTests();
  });

  it('returns metadata for a known asset', async () => {
    const res = await request(app).get('/api/v1/assets/XLM');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: assetMetadataService.getAsset('XLM'),
    });
  });

  it('resolves symbols case-insensitively to the canonical form', async () => {
    const res = await request(app).get('/api/v1/assets/yxlm');

    expect(res.status).toBe(200);
    expect(res.body.data.symbol).toBe('yXLM');
  });

  it('returns a 404 with the standard error envelope for an unknown asset', async () => {
    const res = await request(app).get('/api/v1/assets/NOPE');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toContain('NOPE');
  });

  it('caches successful lookups (MISS then HIT) and does not cache 404s', async () => {
    const miss = await request(app).get('/api/v1/assets/USDC');
    const hit = await request(app).get('/api/v1/assets/USDC');
    expect(miss.headers['x-cache']).toBe('MISS');
    expect(hit.headers['x-cache']).toBe('HIT');
    expect(hit.body).toEqual(miss.body);

    const first404 = await request(app).get('/api/v1/assets/NOPE');
    const second404 = await request(app).get('/api/v1/assets/NOPE');
    expect(first404.status).toBe(404);
    expect(second404.status).toBe(404);
    expect(second404.headers['x-cache']).toBe('MISS');
  });

  it('keeps list and per-asset cache entries independent', async () => {
    await request(app).get('/api/v1/assets');
    const single = await request(app).get('/api/v1/assets/XLM');

    expect(single.headers['x-cache']).toBe('MISS');
    expect(single.body.data.symbol).toBe('XLM');
  });
});
