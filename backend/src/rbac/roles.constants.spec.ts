import { DEFAULT_ROLE_PERMISSIONS, orgRoleSatisfies, PERMISSION_KEYS, STAFF_ROLE_KEYS } from './roles.constants';

describe('role/permission constants', () => {
  it('every default grant references a real permission key', () => {
    for (const key of STAFF_ROLE_KEYS) {
      for (const permission of DEFAULT_ROLE_PERMISSIONS[key]) {
        expect(PERMISSION_KEYS).toContain(permission);
      }
    }
  });

  it('SUPER_ADMIN is granted every permission', () => {
    expect(new Set(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN)).toEqual(new Set(PERMISSION_KEYS));
  });

  it('every staff role has at least admin.access', () => {
    for (const key of STAFF_ROLE_KEYS) {
      expect(DEFAULT_ROLE_PERMISSIONS[key]).toContain('admin.access');
    }
  });
});

describe('orgRoleSatisfies', () => {
  it('ranks OWNER > MEMBER > VIEWER', () => {
    expect(orgRoleSatisfies('OWNER', 'OWNER')).toBe(true);
    expect(orgRoleSatisfies('OWNER', 'MEMBER')).toBe(true);
    expect(orgRoleSatisfies('OWNER', 'VIEWER')).toBe(true);
    expect(orgRoleSatisfies('MEMBER', 'OWNER')).toBe(false);
    expect(orgRoleSatisfies('MEMBER', 'MEMBER')).toBe(true);
    expect(orgRoleSatisfies('VIEWER', 'MEMBER')).toBe(false);
    expect(orgRoleSatisfies('VIEWER', 'VIEWER')).toBe(true);
  });
});
