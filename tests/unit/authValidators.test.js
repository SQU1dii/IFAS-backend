'use strict';
const { registerSchema, loginSchema } = require('../../src/validators/auth.validators');

describe('Auth validators', () => {
  describe('registerSchema', () => {
    test('accepts full_name field', () => {
      expect(() => registerSchema.parse({
        email: 'user@ifas.dev', password: 'Str0ngP@ss', full_name: 'Alice Kamau',
      })).not.toThrow();
    });

    test('accepts name field (frontend)', () => {
      expect(() => registerSchema.parse({
        email: 'user@ifas.dev', password: 'Str0ngP@ss', name: 'Alice Kamau',
      })).not.toThrow();
    });

    test('rejects when neither full_name nor name is provided', () => {
      expect(() => registerSchema.parse({
        email: 'user@ifas.dev', password: 'validpassword123',
      })).toThrow();
    });

    test('rejects short password', () => {
      expect(() => registerSchema.parse({
        email: 'user@ifas.dev', password: 'short', full_name: 'Alice Kamau',
      })).toThrow();
    });

    test('rejects invalid email', () => {
      expect(() => registerSchema.parse({
        email: 'not-an-email', password: 'validpassword123', full_name: 'Alice Kamau',
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
});
