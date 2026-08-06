export interface LibraryItem {
  id: string;
  projectId?: string;
  title: string;
  type?: 'template' | 'resource' | 'reference';
  content?: string;
  createdAt: string;
  updatedAt: string;
}
