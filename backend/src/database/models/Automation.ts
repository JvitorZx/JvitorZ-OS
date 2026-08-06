export interface Automation {
  id: string;
  projectId?: string;
  name: string;
  description?: string;
  trigger?: string;
  action?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
