import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  decimal,
  jsonb,
  index,
  uniqueIndex,
  check,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ============================================================================
// ENUMS
// ============================================================================

export const userRoleEnum = pgEnum('user_role', ['administrator', 'supervisor', 'employee']);
export const shiftStatusEnum = pgEnum('shift_status', ['draft', 'open', 'filled', 'cancelled', 'completed']);
export const applicationStatusEnum = pgEnum('application_status', ['pending', 'accepted', 'rejected', 'cancelled']);
export const assignmentStatusEnum = pgEnum('assignment_status', ['assigned', 'confirmed', 'cancelled', 'completed']);
export const attendanceStatusEnum = pgEnum('attendance_status', ['checked_in', 'checked_out', 'late', 'absent', 'missed_checkout']);
export const notificationTypeEnum = pgEnum('notification_type', [
  'shift_created',
  'application_received',
  'application_accepted',
  'application_rejected',
  'shift_updated',
  'shift_cancelled',
  'upcoming_shift',
  'check_in_reminder',
  'check_out_reminder',
]);
export const compensationTypeEnum = pgEnum('compensation_type', ['hourly', 'fixed', 'daily']);
export const employmentTypeEnum = pgEnum('employment_type', ['permanent', 'temporary', 'freelance']);
export const accountStatusEnum = pgEnum('account_status', ['active', 'inactive', 'suspended']);
export const preferredLanguageEnum = pgEnum('preferred_language', ['nl', 'ar', 'en']);

// ============================================================================
// CORE TABLES
// ============================================================================

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fullName: text('full_name').notNull(),
    email: text('email').notNull().unique(),
    phone: text('phone'),
    city: text('city'),
    preferredLanguage: preferredLanguageEnum('preferred_language').default('nl').notNull(),
    accountStatus: accountStatusEnum('account_status').default('active').notNull(),
    avatarUrl: text('avatar_url'),
    passwordHash: text('password_hash'), // Added for self-hosted auth (nullable for migrated users)
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: index('idx_profiles_email').on(table.email),
  })
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    role: userRoleEnum('role').notNull(),
    assignedBy: uuid('assigned_by').references(() => profiles.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index('idx_user_roles_user_id').on(table.userId),
    uniqueUserRole: uniqueIndex('unique_user_role').on(table.userId, table.role),
  })
);

export const employeeDetails = pgTable(
  'employee_details',
  {
    profileId: uuid('profile_id')
      .primaryKey()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    workCategories: text('work_categories').array().default([]).notNull(),
    qualifications: jsonb('qualifications').default({}).notNull(),
    employmentType: employmentTypeEnum('employment_type').default('temporary').notNull(),
    hourlyRate: decimal('hourly_rate', { precision: 10, scale: 2 }),
    bankAccountIban: text('bank_account_iban'),
    bankAccountName: text('bank_account_name'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    address: text('address'),
    postalCode: text('postal_code'),
    dateOfBirth: timestamp('date_of_birth', { withTimezone: false, mode: 'date' }),
    bsNumber: text('bs_number'), // Dutch citizen service number (encrypted in production)
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    profileIdIdx: index('idx_employee_details_profile_id').on(table.profileId),
  })
);

export const shifts = pgTable(
  'shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    workType: text('work_type').notNull(),
    clientOrProject: text('client_or_project'),
    location: text('location').notNull(),
    latitude: decimal('latitude', { precision: 10, scale: 8 }),
    longitude: decimal('longitude', { precision: 11, scale: 8 }),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    requiredWorkers: integer('required_workers').default(1).notNull(),
    compensationType: compensationTypeEnum('compensation_type').default('hourly').notNull(),
    compensationAmount: decimal('compensation_amount', { precision: 10, scale: 2 }),
    description: text('description'),
    instructions: text('instructions'),
    status: shiftStatusEnum('status').default('draft').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profiles.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index('idx_shifts_status').on(table.status),
    startAtIdx: index('idx_shifts_start_at').on(table.startAt),
    createdByIdx: index('idx_shifts_created_by').on(table.createdBy),
  })
);

export const shiftApplications = pgTable(
  'shift_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    status: applicationStatusEnum('status').default('pending').notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }).defaultNow().notNull(),
    reviewedBy: uuid('reviewed_by').references(() => profiles.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
  },
  (table) => ({
    shiftIdIdx: index('idx_shift_applications_shift_id').on(table.shiftId),
    employeeIdIdx: index('idx_shift_applications_employee_id').on(table.employeeId),
    statusIdx: index('idx_shift_applications_status').on(table.status),
    uniqueShiftEmployee: uniqueIndex('unique_shift_employee').on(table.shiftId, table.employeeId),
  })
);

export const shiftAssignments = pgTable(
  'shift_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    applicationId: uuid('application_id').references(() => shiftApplications.id),
    status: assignmentStatusEnum('status').default('assigned').notNull(),
    assignedBy: uuid('assigned_by')
      .notNull()
      .references(() => profiles.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (table) => ({
    shiftIdIdx: index('idx_shift_assignments_shift_id').on(table.shiftId),
    employeeIdIdx: index('idx_shift_assignments_employee_id').on(table.employeeId),
    uniqueShiftEmployee: uniqueIndex('unique_shift_assignment_employee').on(table.shiftId, table.employeeId),
  })
);

export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shiftAssignmentId: uuid('shift_assignment_id')
      .notNull()
      .references(() => shiftAssignments.id, { onDelete: 'cascade' }),
    checkInAt: timestamp('check_in_at', { withTimezone: true }),
    checkOutAt: timestamp('check_out_at', { withTimezone: true }),
    checkInLatitude: decimal('check_in_latitude', { precision: 10, scale: 8 }),
    checkInLongitude: decimal('check_in_longitude', { precision: 11, scale: 8 }),
    checkOutLatitude: decimal('check_out_latitude', { precision: 10, scale: 8 }),
    checkOutLongitude: decimal('check_out_longitude', { precision: 11, scale: 8 }),
    attendanceStatus: attendanceStatusEnum('attendance_status').default('checked_in').notNull(),
    correctionReason: text('correction_reason'),
    approvedBy: uuid('approved_by').references(() => profiles.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    assignmentIdIdx: index('idx_attendance_records_assignment_id').on(table.shiftAssignmentId),
  })
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    message: text('message'),
    relatedShiftId: uuid('related_shift_id').references(() => shifts.id, { onDelete: 'set null' }),
    relatedApplicationId: uuid('related_application_id').references(() => shiftApplications.id, { onDelete: 'set null' }),
    idempotencyKey: text('idempotency_key'),
    idempotencyPayloadHash: text('idempotency_payload_hash'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    recipientIdIdx: index('idx_notifications_recipient_id').on(table.recipientId),
    readAtIdx: index('idx_notifications_read_at').on(table.readAt),
    idempotencyKeyUnique: uniqueIndex('notifications_recipient_idempotency_key_uq')
      .on(table.recipientId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    idempotencyFieldsPaired: check(
      'notifications_idempotency_fields_ck',
      sql`(${table.idempotencyKey} IS NULL) = (${table.idempotencyPayloadHash} IS NULL)`
    ),
  })
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => profiles.id),
    actorType: text('actor_type').$type<'user' | 'system'>().default('user').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    oldValues: jsonb('old_values'),
    newValues: jsonb('new_values'),
    ipAddress: text('ip_address'), // INET type not directly supported, store as text
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    actorIdIdx: index('idx_audit_logs_actor_id').on(table.actorId),
    entityIdx: index('idx_audit_logs_entity').on(table.entityType, table.entityId),
    createdAtIdx: index('idx_audit_logs_created_at').on(table.createdAt),
    actorTypeCheck: check(
      'audit_logs_actor_type_ck',
      sql`(${table.actorType} = 'user' AND ${table.actorId} IS NOT NULL) OR (${table.actorType} = 'system' AND ${table.actorId} IS NULL)`
    ),
  })
);

// ============================================================================
// RELATIONS
// ============================================================================

export const profilesRelations = relations(profiles, ({ one, many }) => ({
  userRoles: many(userRoles),
  employeeDetails: one(employeeDetails, { fields: [profiles.id], references: [employeeDetails.profileId] }),
  createdShifts: many(shifts, { relationName: 'createdShifts' }),
  shiftApplications: many(shiftApplications, { relationName: 'applications' }),
  shiftAssignments: many(shiftAssignments, { relationName: 'assignments' }),
  assignedShifts: many(shiftAssignments, { relationName: 'assignedShifts' }),
  reviewedApplications: many(shiftApplications, { relationName: 'reviewedApplications' }),
  assignedBy: many(shiftAssignments, { relationName: 'assignedBy' }),
  attendanceRecords: many(attendanceRecords, { relationName: 'approvedAttendance' }),
  notifications: many(notifications),
  auditLogs: many(auditLogs),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(profiles, { fields: [userRoles.userId], references: [profiles.id] }),
  assignedBy: one(profiles, { fields: [userRoles.assignedBy], references: [profiles.id] }),
}));

export const employeeDetailsRelations = relations(employeeDetails, ({ one }) => ({
  profile: one(profiles, { fields: [employeeDetails.profileId], references: [profiles.id] }),
}));

export const shiftsRelations = relations(shifts, ({ one, many }) => ({
  createdBy: one(profiles, { fields: [shifts.createdBy], references: [profiles.id], relationName: 'createdShifts' }),
  applications: many(shiftApplications),
  assignments: many(shiftAssignments),
  notifications: many(notifications),
}));

export const shiftApplicationsRelations = relations(shiftApplications, ({ one, many }) => ({
  shift: one(shifts, { fields: [shiftApplications.shiftId], references: [shifts.id] }),
  employee: one(profiles, { fields: [shiftApplications.employeeId], references: [profiles.id], relationName: 'applications' }),
  reviewedBy: one(profiles, { fields: [shiftApplications.reviewedBy], references: [profiles.id], relationName: 'reviewedApplications' }),
  assignments: many(shiftAssignments),
}));

export const shiftAssignmentsRelations = relations(shiftAssignments, ({ one, many }) => ({
  shift: one(shifts, { fields: [shiftAssignments.shiftId], references: [shifts.id] }),
  employee: one(profiles, { fields: [shiftAssignments.employeeId], references: [profiles.id], relationName: 'assignments' }),
  application: one(shiftApplications, { fields: [shiftAssignments.applicationId], references: [shiftApplications.id] }),
  assignedBy: one(profiles, { fields: [shiftAssignments.assignedBy], references: [profiles.id], relationName: 'assignedBy' }),
  attendanceRecords: many(attendanceRecords),
}));

export const attendanceRecordsRelations = relations(attendanceRecords, ({ one }) => ({
  shiftAssignment: one(shiftAssignments, { fields: [attendanceRecords.shiftAssignmentId], references: [shiftAssignments.id] }),
  approvedBy: one(profiles, { fields: [attendanceRecords.approvedBy], references: [profiles.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipient: one(profiles, { fields: [notifications.recipientId], references: [profiles.id] }),
  shift: one(shifts, { fields: [notifications.relatedShiftId], references: [shifts.id] }),
  application: one(shiftApplications, { fields: [notifications.relatedApplicationId], references: [shiftApplications.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(profiles, { fields: [auditLogs.actorId], references: [profiles.id] }),
}));

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = typeof userRoles.$inferInsert;
export type EmployeeDetail = typeof employeeDetails.$inferSelect;
export type NewEmployeeDetail = typeof employeeDetails.$inferInsert;
export type Shift = typeof shifts.$inferSelect;
export type NewShift = typeof shifts.$inferInsert;
export type ShiftApplication = typeof shiftApplications.$inferSelect;
export type NewShiftApplication = typeof shiftApplications.$inferInsert;
export type ShiftAssignment = typeof shiftAssignments.$inferSelect;
export type NewShiftAssignment = typeof shiftAssignments.$inferInsert;
export type AttendanceRecord = typeof attendanceRecords.$inferSelect;
export type NewAttendanceRecord = typeof attendanceRecords.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;