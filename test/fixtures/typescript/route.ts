import { NextResponse } from 'next/server';
import { db } from '../../lib/db';

export async function GET(request: Request) {
  const rows = await db.query('select 1');
  return NextResponse.json(rows);
}

export async function POST() {
  const { audit } = await import('../../lib/audit');
  audit('post');
  return new Response(null, { status: 204 });
}
