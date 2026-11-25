export type UserRole = 'super_admin' | 'admin' | 'client';
export type AccessState = 'pending' | 'approved' | 'suspended' | 'removed';
export interface DashboardUser {
  id: string;
  email: string;
  username?: string;
  credentialsReady?: boolean;
  role: UserRole;
  status: AccessState;
  verified: boolean;
  expiresAt?: number;
  approvedBy?: string;
  approvedAt?: number;
  createdAt: number;
  canAccess: boolean;
  accessMessage: string;
}
export const isDashboardAdmin = (user: Pick<DashboardUser, 'role'>) => user.role !== 'client';
