export interface Operator {
  id: string;
  name: string;
  description?: string;
  status?: 'active' | 'inactive' | 'pending';
  createdAt: string;
  updatedAt: string;
}
