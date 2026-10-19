import Link from 'next/link';
import { getUsers } from '@/lib/users';
import type { User } from '../types';
import './styles.css';

const PAGE_SIZE = 20;

export default async function UsersPage() {
  const users = await getUsers(PAGE_SIZE);
  return <Link href="/">{users.length}</Link>;
}

export const dynamic = 'force-dynamic';

function Helper({ user }: { user: User }) {
  return <span>{user.name}</span>;
}
