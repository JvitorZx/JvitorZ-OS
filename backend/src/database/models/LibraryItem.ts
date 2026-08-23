export interface LibraryItem {
  id: string;
  projectId?: string | null;
  sourceMessageId?: string | null;
  title: string;
  type?: 'template' | 'resource' | 'reference';
  content?: string;
  createdAt: string;
  updatedAt: string;
}
