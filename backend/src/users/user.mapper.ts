import type { User } from '../generated/prisma/client';

/** The `User` shape returned to clients — never `passwordHash`, `deletedBy` or other internal columns. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  designation: string | null;
  avatarUrl: string | null;
  isEmailVerified: boolean;
  status: string;
  createdAt: string;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    designation: user.designation,
    avatarUrl: user.avatarUrl,
    isEmailVerified: user.isEmailVerified,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}
