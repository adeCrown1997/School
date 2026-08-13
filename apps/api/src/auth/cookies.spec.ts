import { cookieDomainAttribute } from './cookies';

describe('cookieDomainAttribute', () => {
  it('omits Domain for localhost so Chromium will store the session cookie', () => {
    expect(cookieDomainAttribute('localhost')).toBeUndefined();
    expect(cookieDomainAttribute('LOCALHOST')).toBeUndefined();
    expect(cookieDomainAttribute(' localhost ')).toBeUndefined();
  });

  it('omits Domain for loopback addresses', () => {
    expect(cookieDomainAttribute('127.0.0.1')).toBeUndefined();
    expect(cookieDomainAttribute('::1')).toBeUndefined();
    expect(cookieDomainAttribute('[::1]')).toBeUndefined();
  });

  it('omits Domain when unset or blank', () => {
    expect(cookieDomainAttribute(undefined)).toBeUndefined();
    expect(cookieDomainAttribute(null)).toBeUndefined();
    expect(cookieDomainAttribute('')).toBeUndefined();
    expect(cookieDomainAttribute('   ')).toBeUndefined();
  });

  it('keeps a real production domain', () => {
    expect(cookieDomainAttribute('.university.edu')).toBe('.university.edu');
    expect(cookieDomainAttribute('portal.university.edu')).toBe('portal.university.edu');
  });
});
