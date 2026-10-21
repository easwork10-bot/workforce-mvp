import { db } from '..';
import { profiles, userRoles, employeeDetails } from '../schema';
import { eq, and, desc, asc, ilike, or, count } from 'drizzle-orm';
import type { Profile, EmployeeDetail } from '../schema';

/**
 * Get employees with profile and details
 */
export async function getEmployees({
  role,
  accountStatus,
  search,
  page = 1,
  limit = 20,
  sortOrder = 'desc',
}: {
  role?: string;
  accountStatus?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortOrder?: 'asc' | 'desc';
}): Promise<{
  data: (Profile & {
    role: string;
    details: EmployeeDetail | null;
  })[];
  total: number;
}> {
  const offset = (page - 1) * limit;

  // Build conditions for profiles
  const conditions = [];

  if (accountStatus) {
    conditions.push(eq(profiles.accountStatus, accountStatus as any));
  }

  if (search) {
    conditions.push(
      or(
        ilike(profiles.fullName, `%${search}%`),
        ilike(profiles.email, `%${search}%`),
        ilike(profiles.city || '', `%${search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total
  const [{ total: totalCount }] = await db
    .select({ total: count() })
    .from(profiles)
    .where(whereClause);

  // Get profiles
  const profileList = await db
    .select()
    .from(profiles)
    .where(whereClause)
    .orderBy(sortOrder === 'desc' ? desc(profiles.createdAt) : asc(profiles.createdAt))
    .limit(limit)
    .offset(offset);

  // Join roles and details manually for safety
  const data = await Promise.all(
    profileList.map(async (profile) => {
      const [roleData] = await db
        .select({ role: userRoles.role })
        .from(userRoles)
        .where(eq(userRoles.userId, profile.id))
        .limit(1);

      const [detailsData] = await db
        .select()
        .from(employeeDetails)
        .where(eq(employeeDetails.profileId, profile.id))
        .limit(1);

      return {
        ...profile,
        role: roleData?.role || 'employee',
        details: detailsData || null,
      };
    })
  );

  // Filter by role if requested
  const filteredData = role ? data.filter((item) => item.role === role) : data;

  return {
    data: filteredData,
    total: totalCount,
  };
}

/**
 * Get employee by ID with full details
 */
export async function getEmployeeById(id: string): Promise<(Profile & {
  role: string;
  details: EmployeeDetail | null;
}) | null> {
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, id))
    .limit(1);

  if (!profile) return null;

  const [roleData] = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, id))
    .limit(1);

  const [detailsData] = await db
    .select()
    .from(employeeDetails)
    .where(eq(employeeDetails.profileId, id))
    .limit(1);

  return {
    ...profile,
    role: roleData?.role || 'employee',
    details: detailsData || null,
  };
}

/**
 * Update employee details
 */
export async function updateEmployee(
  id: string,
  profileData: Partial<Profile>,
  roleData?: 'administrator' | 'supervisor' | 'employee',
  detailsData?: Partial<EmployeeDetail>
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    // Update profile
    if (Object.keys(profileData).length > 0) {
      await tx
        .update(profiles)
        .set({ ...profileData, updatedAt: new Date() })
        .where(eq(profiles.id, id));
    }

    // Update role
    if (roleData) {
      await tx
        .insert(userRoles)
        .values({
          userId: id,
          role: roleData,
        })
        .onConflictDoUpdate({
          target: [userRoles.userId, userRoles.role],
          set: { role: roleData, assignedAt: new Date() },
        });
    }

    // Update or insert employee details
    if (detailsData && Object.keys(detailsData).length > 0) {
      await tx
        .insert(employeeDetails)
        .values({
          profileId: id,
          ...detailsData,
        })
        .onConflictDoUpdate({
          target: employeeDetails.profileId,
          set: { ...detailsData, updatedAt: new Date() },
        });
    }

    return true;
  });
}