-- Workforce MVP Initial Database Schema
-- Run this in Supabase SQL Editor or via migration CLI

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE user_role AS ENUM ('administrator', 'supervisor', 'employee');
CREATE TYPE shift_status AS ENUM ('draft', 'open', 'filled', 'cancelled', 'completed');
CREATE TYPE application_status AS ENUM ('pending', 'accepted', 'rejected', 'cancelled');
CREATE TYPE assignment_status AS ENUM ('assigned', 'confirmed', 'cancelled', 'completed');
CREATE TYPE attendance_status AS ENUM ('checked_in', 'checked_out', 'late', 'absent', 'missed_checkout');
CREATE TYPE notification_type AS ENUM ('shift_created', 'application_received', 'application_accepted', 'application_rejected', 'shift_updated', 'shift_cancelled', 'upcoming_shift', 'check_in_reminder', 'check_out_reminder');

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Profiles table (extends Supabase auth.users)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    city TEXT,
    preferred_language TEXT DEFAULT 'nl' CHECK (preferred_language IN ('nl', 'ar', 'en')),
    account_status TEXT DEFAULT 'active' CHECK (account_status IN ('active', 'inactive', 'suspended')),
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User roles (many-to-many for future flexibility, but single role per user for MVP)
CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role user_role NOT NULL,
    assigned_by UUID REFERENCES profiles(id),
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, role)
);

-- Employee details (extended info for employees)
CREATE TABLE employee_details (
    profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    work_categories TEXT[] DEFAULT '{}',
    qualifications JSONB DEFAULT '{}',
    employment_type TEXT DEFAULT 'temporary' CHECK (employment_type IN ('permanent', 'temporary', 'freelance')),
    hourly_rate DECIMAL(10, 2),
    bank_account_iban TEXT,
    bank_account_name TEXT,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    address TEXT,
    postal_code TEXT,
    date_of_birth DATE,
    bs_number TEXT, -- Dutch citizen service number (encrypted in production)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shifts
CREATE TABLE shifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    work_type TEXT NOT NULL,
    client_or_project TEXT,
    location TEXT NOT NULL,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    required_workers INTEGER NOT NULL DEFAULT 1 CHECK (required_workers > 0),
    compensation_type TEXT DEFAULT 'hourly' CHECK (compensation_type IN ('hourly', 'fixed', 'daily')),
    compensation_amount DECIMAL(10, 2),
    description TEXT,
    instructions TEXT,
    status shift_status DEFAULT 'draft',
    created_by UUID NOT NULL REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (end_at > start_at)
);

-- Shift applications (employees apply to shifts)
CREATE TABLE shift_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status application_status DEFAULT 'pending',
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_by UUID REFERENCES profiles(id),
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    UNIQUE (shift_id, employee_id) -- Prevent duplicate applications
);

-- Shift assignments (confirmed assignments, distinct from applications)
CREATE TABLE shift_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    application_id UUID REFERENCES shift_applications(id),
    status assignment_status DEFAULT 'assigned',
    assigned_by UUID NOT NULL REFERENCES profiles(id),
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    UNIQUE (shift_id, employee_id) -- Prevent duplicate assignments
);

-- Attendance records (check-in/check-out events)
CREATE TABLE attendance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shift_assignment_id UUID NOT NULL REFERENCES shift_assignments(id) ON DELETE CASCADE,
    check_in_at TIMESTAMPTZ,
    check_out_at TIMESTAMPTZ,
    check_in_latitude DECIMAL(10, 8),
    check_in_longitude DECIMAL(11, 8),
    check_out_latitude DECIMAL(10, 8),
    check_out_longitude DECIMAL(11, 8),
    attendance_status attendance_status DEFAULT 'checked_in',
    correction_reason TEXT,
    approved_by UUID REFERENCES profiles(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type notification_type NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    related_shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
    related_application_id UUID REFERENCES shift_applications(id) ON DELETE SET NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit logs (important admin actions)
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id UUID NOT NULL REFERENCES profiles(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_employee_details_profile_id ON employee_details(profile_id);
CREATE INDEX idx_shifts_status ON shifts(status);
CREATE INDEX idx_shifts_start_at ON shifts(start_at);
CREATE INDEX idx_shifts_created_by ON shifts(created_by);
CREATE INDEX idx_shift_applications_shift_id ON shift_applications(shift_id);
CREATE INDEX idx_shift_applications_employee_id ON shift_applications(employee_id);
CREATE INDEX idx_shift_applications_status ON shift_applications(status);
CREATE INDEX idx_shift_assignments_shift_id ON shift_assignments(shift_id);
CREATE INDEX idx_shift_assignments_employee_id ON shift_assignments(employee_id);
CREATE INDEX idx_attendance_records_assignment_id ON attendance_records(shift_assignment_id);
CREATE INDEX idx_notifications_recipient_id ON notifications(recipient_id);
CREATE INDEX idx_notifications_read_at ON notifications(read_at);
CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user's role
CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS user_role AS $$
DECLARE
    v_role user_role;
BEGIN
    SELECT role INTO v_role
    FROM user_roles
    WHERE user_id = auth.uid()
    LIMIT 1;
    RETURN v_role;
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN get_current_user_role() = 'administrator';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check if current user is supervisor
CREATE OR REPLACE FUNCTION is_supervisor()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN get_current_user_role() = 'supervisor';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check if current user is employee
CREATE OR REPLACE FUNCTION is_employee()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN get_current_user_role() = 'employee';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- PROFILES POLICIES
-- ============================================================================

-- Users can view their own profile
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles" ON profiles
    FOR SELECT USING (is_admin());

-- Admins can insert profiles (create employees)
CREATE POLICY "Admins can insert profiles" ON profiles
    FOR INSERT WITH CHECK (is_admin());

-- Admins can update any profile
CREATE POLICY "Admins can update any profile" ON profiles
    FOR UPDATE USING (is_admin());

-- ============================================================================
-- USER_ROLES POLICIES
-- ============================================================================

-- Users can view their own roles
CREATE POLICY "Users can view own roles" ON user_roles
    FOR SELECT USING (auth.uid() = user_id);

-- Admins can manage all roles
CREATE POLICY "Admins can manage roles" ON user_roles
    FOR ALL USING (is_admin());

-- ============================================================================
-- EMPLOYEE_DETAILS POLICIES
-- ============================================================================

-- Employees can view their own details
CREATE POLICY "Employees can view own details" ON employee_details
    FOR SELECT USING (auth.uid() = profile_id);

-- Employees can update their own details
CREATE POLICY "Employees can update own details" ON employee_details
    FOR UPDATE USING (auth.uid() = profile_id);

-- Admins can view all employee details
CREATE POLICY "Admins can view all employee details" ON employee_details
    FOR SELECT USING (is_admin());

-- Admins can manage all employee details
CREATE POLICY "Admins can manage employee details" ON employee_details
    FOR ALL USING (is_admin());

-- ============================================================================
-- SHIFTS POLICIES
-- ============================================================================

-- Admins can manage all shifts
CREATE POLICY "Admins can manage shifts" ON shifts
    FOR ALL USING (is_admin());

-- Supervisors can view all shifts
CREATE POLICY "Supervisors can view shifts" ON shifts
    FOR SELECT USING (is_supervisor() OR is_admin());

-- Employees can view open shifts (for applying)
CREATE POLICY "Employees can view open shifts" ON shifts
    FOR SELECT USING (
        is_employee() AND status = 'open'
        AND start_at > NOW()
    );

-- Employees can view shifts they're assigned to
CREATE POLICY "Employees can view assigned shifts" ON shifts
    FOR SELECT USING (
        is_employee() AND id IN (
            SELECT shift_id FROM shift_assignments
            WHERE employee_id = auth.uid()
        )
    );

-- ============================================================================
-- SHIFT_APPLICATIONS POLICIES
-- ============================================================================

-- Admins can manage all applications
CREATE POLICY "Admins can manage applications" ON shift_applications
    FOR ALL USING (is_admin());

-- Supervisors can view and review applications
CREATE POLICY "Supervisors can view applications" ON shift_applications
    FOR SELECT USING (is_supervisor() OR is_admin());

CREATE POLICY "Supervisors can review applications" ON shift_applications
    FOR UPDATE USING (is_supervisor() OR is_admin());

-- Employees can view their own applications
CREATE POLICY "Employees can view own applications" ON shift_applications
    FOR SELECT USING (auth.uid() = employee_id);

-- Employees can create applications for open shifts
CREATE POLICY "Employees can apply to shifts" ON shift_applications
    FOR INSERT WITH CHECK (
        auth.uid() = employee_id
        AND EXISTS (
            SELECT 1 FROM shifts
            WHERE id = shift_id
            AND status = 'open'
            AND start_at > NOW()
        )
    );

-- Employees can cancel their own pending applications
CREATE POLICY "Employees can cancel own applications" ON shift_applications
    FOR UPDATE USING (
        auth.uid() = employee_id
        AND status = 'pending'
    );

-- ============================================================================
-- SHIFT_ASSIGNMENTS POLICIES
-- ============================================================================

-- Admins can manage all assignments
CREATE POLICY "Admins can manage assignments" ON shift_assignments
    FOR ALL USING (is_admin());

-- Supervisors can view and manage assignments
CREATE POLICY "Supervisors can view assignments" ON shift_assignments
    FOR SELECT USING (is_supervisor() OR is_admin());

CREATE POLICY "Supervisors can manage assignments" ON shift_assignments
    FOR ALL USING (is_supervisor() OR is_admin());

-- Employees can view their own assignments
CREATE POLICY "Employees can view own assignments" ON shift_assignments
    FOR SELECT USING (auth.uid() = employee_id);

-- ============================================================================
-- ATTENDANCE_RECORDS POLICIES
-- ============================================================================

-- Admins can manage all attendance
CREATE POLICY "Admins can manage attendance" ON attendance_records
    FOR ALL USING (is_admin());

-- Supervisors can view and manage attendance for their shifts
CREATE POLICY "Supervisors can view attendance" ON attendance_records
    FOR SELECT USING (
        is_supervisor() OR is_admin()
        OR shift_assignment_id IN (
            SELECT id FROM shift_assignments
            WHERE shift_id IN (
                SELECT shift_id FROM shifts WHERE created_by = auth.uid()
            )
        )
    );

CREATE POLICY "Supervisors can manage attendance" ON attendance_records
    FOR ALL USING (
        is_supervisor() OR is_admin()
        OR shift_assignment_id IN (
            SELECT id FROM shift_assignments
            WHERE shift_id IN (
                SELECT shift_id FROM shifts WHERE created_by = auth.uid()
            )
        )
    );

-- Employees can view their own attendance
CREATE POLICY "Employees can view own attendance" ON attendance_records
    FOR SELECT USING (
        shift_assignment_id IN (
            SELECT id FROM shift_assignments WHERE employee_id = auth.uid()
        )
    );

-- Employees can check in/out (insert/update their own attendance)
CREATE POLICY "Employees can check in" ON attendance_records
    FOR INSERT WITH CHECK (
        shift_assignment_id IN (
            SELECT id FROM shift_assignments
            WHERE employee_id = auth.uid()
            AND status IN ('assigned', 'confirmed')
        )
    );

CREATE POLICY "Employees can check out" ON attendance_records
    FOR UPDATE USING (
        shift_assignment_id IN (
            SELECT id FROM shift_assignments WHERE employee_id = auth.uid()
        )
    );

-- ============================================================================
-- NOTIFICATIONS POLICIES
-- ============================================================================

-- Users can view their own notifications
CREATE POLICY "Users can view own notifications" ON notifications
    FOR SELECT USING (auth.uid() = recipient_id);

-- Users can mark their own notifications as read
CREATE POLICY "Users can mark notifications read" ON notifications
    FOR UPDATE USING (auth.uid() = recipient_id);

-- Admins can create notifications for anyone
CREATE POLICY "Admins can create notifications" ON notifications
    FOR INSERT WITH CHECK (is_admin());

-- ============================================================================
-- AUDIT_LOGS POLICIES
-- ============================================================================

-- Only admins can view audit logs
CREATE POLICY "Admins can view audit logs" ON audit_logs
    FOR SELECT USING (is_admin());

-- System can insert audit logs (via service role)
CREATE POLICY "Service role can insert audit logs" ON audit_logs
    FOR INSERT WITH CHECK (true);

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employee_details_updated_at BEFORE UPDATE ON employee_details
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shifts_updated_at BEFORE UPDATE ON shifts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_attendance_records_updated_at BEFORE UPDATE ON attendance_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- TRIGGER FOR AUDIT LOGGING ON SHIFTS
-- ============================================================================

CREATE OR REPLACE FUNCTION log_shift_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_values)
        VALUES (auth.uid(), 'CREATE', 'shift', NEW.id, to_jsonb(NEW));
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, old_values, new_values)
        VALUES (auth.uid(), 'UPDATE', 'shift', NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, old_values)
        VALUES (auth.uid(), 'DELETE', 'shift', OLD.id, to_jsonb(OLD));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER audit_shift_changes
    AFTER INSERT OR UPDATE OR DELETE ON shifts
    FOR EACH ROW EXECUTE FUNCTION log_shift_changes();

-- ============================================================================
-- TRIGGER FOR AUDIT LOGGING ON SHIFT_APPLICATIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION log_application_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_values)
        VALUES (auth.uid(), 'CREATE', 'shift_application', NEW.id, to_jsonb(NEW));
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, old_values, new_values)
        VALUES (auth.uid(), 'UPDATE', 'shift_application', NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER audit_application_changes
    AFTER INSERT OR UPDATE ON shift_applications
    FOR EACH ROW EXECUTE FUNCTION log_application_changes();

-- ============================================================================
-- TRIGGER FOR AUDIT LOGGING ON SHIFT_ASSIGNMENTS
-- ============================================================================

CREATE OR REPLACE FUNCTION log_assignment_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_values)
        VALUES (auth.uid(), 'CREATE', 'shift_assignment', NEW.id, to_jsonb(NEW));
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, old_values, new_values)
        VALUES (auth.uid(), 'UPDATE', 'shift_assignment', NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, old_values)
        VALUES (auth.uid(), 'DELETE', 'shift_assignment', OLD.id, to_jsonb(OLD));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER audit_assignment_changes
    AFTER INSERT OR UPDATE OR DELETE ON shift_assignments
    FOR EACH ROW EXECUTE FUNCTION log_assignment_changes();