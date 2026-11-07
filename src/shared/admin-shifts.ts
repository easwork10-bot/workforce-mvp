export type ShiftStatus = 'draft' | 'open' | 'filled' | 'cancelled' | 'completed';

export type AdminShift = {
  id: string;
  title: string;
  workType: string;
  clientOrProject: string | null;
  location: string;
  startAt: string;
  endAt: string;
  requiredWorkers: number;
  status: ShiftStatus;
  applicationCount: number;
  assignedCount: number;
};

export type ShiftStatusCounts = {
  total: number;
  draft: number;
  open: number;
  filled: number;
  cancelled: number;
  completed: number;
};

export type AdminShiftPage = {
  shifts: AdminShift[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  stats: ShiftStatusCounts;
};

export type AdminShiftQuery = {
  page?: number;
  limit?: number;
  status?: ShiftStatus;
  sortBy?: 'startAt' | 'createdAt' | 'title';
  sortOrder?: 'asc' | 'desc';
};

export type AdminShiftInput = {
  title: string;
  workType: string;
  clientOrProject: string | null;
  location: string;
  latitude: number | null;
  longitude: number | null;
  startAt: string;
  endAt: string;
  requiredWorkers: number;
  compensationType: 'hourly' | 'fixed' | 'daily';
  compensationAmount: number | null;
  description: string | null;
  instructions: string | null;
};
