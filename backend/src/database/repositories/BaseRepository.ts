export interface BaseRepository<T, K = string> {
  findById(id: K): Promise<T | null>;
  findAll(): Promise<T[]>;
  create(item: T): Promise<T>;
  update(id: K, item: Partial<T>): Promise<T>;
  delete(id: K): Promise<void>;
}
