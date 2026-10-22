import { getUsers, deleteUser } from './users';
import * as db from './db';
import Button from './button';
import type { User } from './types';
import { Base } from './base';

export async function loadAll() {
  return getUsers();
}

export function remove(id: string) {
  deleteUser(id);
  return db.query(id);
}

export const Page = () => <Button />;

export type Row = { user: User };

export function unrelated() {
  return 1;
}

export class Service extends Base {
  list() {
    return getUsers();
  }

  drop(id: string) {
    deleteUser(id);
  }

  name = 'service';
}

export default Page;
