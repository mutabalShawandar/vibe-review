import type { User } from './types';

export interface Repository {
  name: string;
  readonly size?: number;
  find(id: string): User;
  [key: string]: unknown;
}

export class UserService implements Repository {
  name = 'users';
  private cache = new Map<string, User>();
  static instance: UserService;

  constructor(private readonly db: unknown) {}

  async find(id: string): Promise<User> {
    return this.cache.get(id) as User;
  }

  get size() {
    return this.cache.size;
  }

  set size(value: number) {}

  static create() {
    return new UserService({});
  }
}

export abstract class Base {
  abstract run(): void;
}
