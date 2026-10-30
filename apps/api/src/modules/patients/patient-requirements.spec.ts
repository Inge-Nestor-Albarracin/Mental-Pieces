import { Gender } from '../../../generated/prisma/client';
import { normalizePolicyBody, policySha256 } from '../legal/data-policy';
import {
  isMinor,
  isProfileComplete,
  isValidBirthDate,
  isValidPhone,
} from './patient-requirements';

const TODAY = '2026-10-28';
const complete = {
  fullName: 'Paciente Sintética',
  birthDate: new Date('1990-05-01T00:00:00.000Z'),
  gender: Gender.PREFER_NOT_TO_SAY,
  genderOther: null,
  phone: '300 123 4567',
};

describe('isProfileComplete (server-side rule)', () => {
  it('accepts a complete profile; PREFER_NOT_TO_SAY is a valid answer', () => {
    expect(isProfileComplete(complete, TODAY)).toBe(true);
  });

  it('values must be valid, not just present', () => {
    expect(isProfileComplete({ ...complete, fullName: '     ' }, TODAY)).toBe(false);
    expect(isProfileComplete({ ...complete, fullName: ' a ' }, TODAY)).toBe(false);
    expect(isProfileComplete({ ...complete, phone: '' }, TODAY)).toBe(false);
    expect(isProfileComplete({ ...complete, phone: '       ' }, TODAY)).toBe(false);
    expect(isProfileComplete({ ...complete, birthDate: null }, TODAY)).toBe(false);
    expect(isProfileComplete({ ...complete, birthDate: new Date('invalid') }, TODAY)).toBe(false);
    expect(isProfileComplete({ ...complete, birthDate: new Date('2026-10-29T00:00:00.000Z') }, TODAY)).toBe(false);
    expect(isProfileComplete({ ...complete, gender: 'ALIEN' as Gender }, TODAY)).toBe(false);
    expect(isProfileComplete({ ...complete, gender: Gender.OTHER, genderOther: '  ' }, TODAY)).toBe(false);
    expect(isProfileComplete({ ...complete, gender: Gender.OTHER, genderOther: 'Género fluido' }, TODAY)).toBe(true);
  });

  it('keeps already complete profiles complete (common phone formats)', () => {
    for (const phone of ['3001234567', '+57 300 123 4567', '(601) 555-1234', '601.555.1234']) {
      expect(isValidPhone(phone)).toBe(true);
    }
    expect(isValidPhone('abcdefg')).toBe(false);
    expect(isValidPhone('12 34 5')).toBe(false);
  });

  it('birth dates: not in the future (Bogotá date) and not before 1900', () => {
    expect(isValidBirthDate(new Date('2026-10-28T00:00:00.000Z'), TODAY)).toBe(true);
    expect(isValidBirthDate(new Date('1899-12-31T00:00:00.000Z'), TODAY)).toBe(false);
  });
});

describe('isMinor', () => {
  it('is 18 or older from the birthday itself', () => {
    expect(isMinor(new Date('2008-10-28T00:00:00.000Z'), TODAY)).toBe(false);
    expect(isMinor(new Date('2008-10-29T00:00:00.000Z'), TODAY)).toBe(true);
  });
});

describe('policy text fingerprint', () => {
  it('normalises line endings before hashing (same text, same hash)', () => {
    const lf = normalizePolicyBody('Línea 1\nLínea 2\n\n');
    const crlf = normalizePolicyBody('Línea 1\r\nLínea 2\r\n');
    expect(lf).toBe(crlf);
    expect(policySha256(lf)).toMatch(/^[0-9a-f]{64}$/);
    expect(policySha256(lf)).toBe(policySha256(crlf));
  });
});
