import { NextResponse } from 'next/server';

const COOKIE_NAME = 'yokoagent_token';

export async function POST() {
  const response = NextResponse.json({ success: true, message: '已退出登录' });
  response.cookies.delete(COOKIE_NAME);
  return response;
}
