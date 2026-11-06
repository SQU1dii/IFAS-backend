const { registerSchema, loginSchema, refreshSchema } = require('../../src/validators/auth.validators');

describe('Auth validators', () => {
  describe('registerSchema', () => {
    test('accepts valid input', () => {
      expect(() => registerSchema.parse({
        email: 'user@ifas.dev',
        password: 'Str0ngP@ss',
        full_name: 'Alice Kamau',
      })).not.toThrow();
    });

    test('rejects short password', () => {
      expect(() => registerSchema.parse({
        email: 'user@ifas.dev',
        password: 'short',
        full_name: 'Alice Kamau',
      })).toThrow();
    });

    test('rejects invalid email', () => {
      expect(() => registerSchema.parse({
        email: 'not-an-email',
        password: 'validpassword123',
        full_name: 'Alice Kamau',
      })).toThrow();
    });

    test('rejects missing full_name', () => {
      expect(() => registerSchema.parse({
        email: 'user@ifas.dev',
        password: 'validpassword123',
      })).toThrow();
    });
  });

  describe('loginSchema', () => {
    test('accepts valid input', () => {
      expect(() => loginSchema.parse({ email: 'user@ifas.dev', password: 'any' })).not.toThrow();
    });

    test('rejects empty password', () => {
      expect(() => loginSchema.parse({ email: 'user@ifas.dev', password: '' })).toThrow();
    });
  });

  describe('refreshSchema', () => {
    test('accepts a token string', () => {
      expect(() => refreshSchema.parse({ refresh_token: 'sometoken' })).not.toThrow();
    });

    test('rejects missing refresh_token', () => {
      expect(() => refreshSchema.parse({})).toThrow();
    });
  });
});
