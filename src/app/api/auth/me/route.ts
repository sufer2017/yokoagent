import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';

export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json(
      { success: false, message: '未登录' },
      { status: 401 }
    );
  }

  return NextResponse.json({ success: true, data: session });
}
