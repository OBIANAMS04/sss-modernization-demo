import { Request } from 'express';
import { clientAddress } from './requestContext';

const request = (ip: string, headers: Record<string, string> = {}) =>
  ({ ip, get: (name: string) => headers[name.toLowerCase()] }) as unknown as Request;

describe('clientAddress (the address the audit log records)', () => {
  const render = process.env.RENDER;
  afterEach(() => {
    if (render === undefined) delete process.env.RENDER;
    else process.env.RENDER = render;
  });

  it('on Render, records the visitor address Cloudflare passes on, not the Cloudflare edge', () => {
    process.env.RENDER = 'true';
    expect(clientAddress(request('172.69.168.147', { 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(clientAddress(request('162.158.42.44', { 'cf-connecting-ip': '2001:db8::1' }))).toBe('2001:db8::1');
  });

  it('ignores a missing or malformed header and falls back to the connection address', () => {
    process.env.RENDER = 'true';
    expect(clientAddress(request('172.69.168.147'))).toBe('172.69.168.147');
    expect(clientAddress(request('172.69.168.147', { 'cf-connecting-ip': 'not-an-address' }))).toBe('172.69.168.147');
  });

  it('off Render, never trusts the header (a local caller could set it)', () => {
    delete process.env.RENDER;
    expect(clientAddress(request('::1', { 'cf-connecting-ip': '203.0.113.7' }))).toBe('::1');
  });
});
